// JSON 检索：自动类型推断 + 多条件匹配
import isPlainObject from "lodash/isPlainObject.js";
import { readByKey } from "./paths.js";

export type FilterOp = "=" | "<" | ">" | "<=" | ">=";

export interface FilterQuery {
  key: string;
  op: FilterOp;
  value: string; // 原始字符串，运行时推断类型
}

export interface FilterOptions {
  queries: FilterQuery[];
  /** 在对象 key 中搜索 (用于 dict-key 数据，如 model id)，支持多值 OR 匹配 */
  keyMatch?: string | string[];
  /** 限制搜索路径，支持 * 通配 */
  pathGlob?: string;
  maxDepth?: number;
  limit?: number;
}

export interface FilterResult {
  matches: any[];
  /** 每个 match 附带命中 path，便于调试 */
  paths: string[];
  truncated: boolean;
}

// ---------- 类型推断 ----------

/** 把查询 value 字符串转成合适的运行时类型 */
function coerce(value: string): number | boolean | null | string {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  // 纯数字 (含负数、小数)
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** 比较 query value 与节点实际值 */
function matchQuery(actual: any, q: FilterQuery): boolean {
  const expected = coerce(q.value);
  switch (q.op) {
    case "=":
      // string → substring，其他严格相等
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      // 类型不一致不算等
      if (actual === null || expected === null) return actual === expected;
      if (typeof actual !== typeof expected) return false;
      return actual === expected;
    case "<":
    case ">":
    case "<=":
    case ">=": {
      const a = typeof actual === "number" ? actual : Number(actual);
      const b = typeof expected === "number" ? expected : Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (q.op === "<") return a < b;
      if (q.op === ">") return a > b;
      if (q.op === "<=") return a <= b;
      return a >= b;
    }
  }
}

// ---------- 路径匹配 ----------

/** 简易 glob → 正则，仅支持 * 通配 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]*");
  return new RegExp(`^${escaped}$`);
}

/** 检查路径是否匹配 glob 模式，基于 root 之后路径 */
function pathMatches(p: string, pathRe: RegExp | null): boolean {
  if (!pathRe) return true;
  const sub = p.startsWith("root.") ? p.slice(5) : p === "root" ? "" : p;
  return pathRe.test(sub) || pathRe.test(p);
}

// ---------- 核心检索 ----------

/** 构建 keyMatch 正则: 支持 string 或 string[] (多值 OR) */
function buildKeyMatchRe(keyMatch?: string | string[]): RegExp | null {
  if (!keyMatch) return null;
  const patterns = Array.isArray(keyMatch) ? keyMatch : [keyMatch];
  const valid = patterns.filter(Boolean);
  if (valid.length === 0) return null;
  const escaped = valid.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(escaped, "i");
}

export function filterJSON(data: any, opts: FilterOptions): FilterResult {
  const maxDepth = opts.maxDepth ?? 32;
  const limit = opts.limit ?? 50;
  const queries = opts.queries;
  const pathRe = opts.pathGlob ? globToRegex(opts.pathGlob) : null;
  const keyMatchRe = buildKeyMatchRe(opts.keyMatch);

  const matches: any[] = [];
  const paths: string[] = [];
  let truncated = false;

  /** 递归扫描单个值，返回是否在当前节点命中（用于剪枝） */
  function walk(value: any, path: string, depth: number) {
    if (matches.length >= limit) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) return;

    // 1) key-match 模式：dict-key 命中后，若有 field query 需同时满足
    if (keyMatchRe && isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        if (keyMatchRe.test(k) && pathMatches(`${path}.${k}`, pathRe)) {
          // 有 field query 时，v 也必须满足（v 是 plain object 才检查）
          if (queries.length > 0) {
            if (!isPlainObject(v)) continue;
            const vObj = v as Record<string, any>;
            if (!objectMatchesAllQueries(vObj)) continue;
          }
          pushMatch(v, `${path}.${k}`);
          if (matches.length >= limit) {
            truncated = true;
            return;
          }
        }
      }
    }

    // 2) object 分支：field-query 模式 + 递归子字段
    if (isPlainObject(value)) {
      // keyMatch 启用时跳过 field-query 推送 (由 key-match 分支统一处理)
      if (queries.length > 0 && !keyMatchRe && pathMatches(path, pathRe)) {
        if (objectMatchesAllQueries(value)) {
          pushMatch(value, path);
          if (matches.length >= limit) {
            truncated = true;
            return;
          }
        }
      }
      // 递归子字段
      for (const [k, v] of Object.entries(value)) {
        walk(v, `${path}.${k}`, depth + 1);
        if (matches.length >= limit && truncated) return;
      }
      return;
    }

    // 3) array 递归
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`, depth + 1);
        if (matches.length >= limit && truncated) return;
      }
    }
  }

  function pushMatch(v: any, p: string) {
    matches.push(v);
    paths.push(p);
  }

  /** object 的所有 query 是否同时命中（任一 query 字段必须存在且值匹配） */
  function objectMatchesAllQueries(obj: Record<string, any>): boolean {
    for (const q of queries) {
      // 字段命中：值匹配即 OK；key 存在但值不匹配 → fail
      const actual = readByKey(obj, q.key);
      if (actual === undefined) return false;
      if (!matchQuery(actual, q)) return false;
    }
    return true;
  }

  walk(data, "root", 0);
  return { matches, paths, truncated };
}

// ---------- 递归搜索 (search) ----------

export interface SearchOptions {
  /** 搜索模式 (正则, case-insensitive) */
  pattern: string;
  /** 仅在 key 中搜索 */
  keyOnly?: boolean;
  /** 仅在 value 中搜索 */
  valueOnly?: boolean;
  /** 限制搜索路径, 支持 * 通配 */
  pathGlob?: string;
  maxDepth?: number;
  limit?: number;
}

export interface SearchMatch {
  path: string;
  key?: string;
  /** 仅叶子节点携带 value, 容器节点不重复存储 */
  value?: any;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

/**
 * 递归搜索 JSON key/value, 对标 jq 的 `.. | select(test("pattern"))` 能力。
 */
export function searchJSON(data: any, opts: SearchOptions): SearchResult {
  const { pattern, keyOnly, valueOnly, maxDepth = 32, limit = 50 } = opts;
  const searchRe = new RegExp(pattern, "i");
  const pathRe = opts.pathGlob ? globToRegex(opts.pathGlob) : null;
  const searchKeys = !valueOnly;
  const searchValues = !keyOnly;

  const matches: SearchMatch[] = [];
  let truncated = false;

  function walk(value: any, path: string, parentKey: string | undefined, depth: number) {
    if (matches.length >= limit) { truncated = true; return; }
    if (depth > maxDepth) return;

    // key 匹配
    if (searchKeys && parentKey !== undefined && searchRe.test(parentKey) && pathMatches(path, pathRe)) {
      const isContainer = isPlainObject(value) || Array.isArray(value);
      matches.push({ path, key: parentKey, value: isContainer ? undefined : value });
      if (matches.length >= limit) { truncated = true; return; }
    }

    // 对象递归
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        walk(v, `${path}.${k}`, k, depth + 1);
        if (matches.length >= limit && truncated) return;
      }
      return;
    }

    // 数组递归
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`, undefined, depth + 1);
        if (matches.length >= limit && truncated) return;
      }
      return;
    }

    // 叶子值匹配
    if (searchValues) {
      const strVal = value === null ? "null" : String(value);
      if (searchRe.test(strVal) && pathMatches(path, pathRe)) {
        matches.push({ path, value });
        if (matches.length >= limit) truncated = true;
      }
    }
  }

  walk(data, "root", undefined, 0);
  return { matches, truncated };
}
