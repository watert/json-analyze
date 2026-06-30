// getByPath: 按路径模式提取数据值，支持 [ ] wildcard、数组下标、bracket 转义
// 参考: splitPath from path-utils 做严格解析，避免 hand-rolled 路径解析 bug
import isPlainObject from "lodash/isPlainObject.js";
import { splitPath, subPath } from "./path-utils.js";
import type { GetByPathOptions } from "./types.js";

/**
 * 按路径从 JSON 中提取匹配的数据值。
 * - `root.users[].name` → 所有数组元素(或 dict value)的 name 字段值
 * - `root.users[0]` → 数组第一个元素
 * - `root.data[].tags[]` → 嵌套数组/对象的所有元素
 * - `root["key.with.dots"]` → 转义的特殊 key
 */
export function getByPath(data: any, path: string, opts: GetByPathOptions = {}): any[] {
  const { limit = 100, maxDepth = 64 } = opts;
  const segments = splitPath(path);
  const results: any[] = [];

  function walk(cur: any, segIdx: number, depth: number) {
    if (results.length >= limit || depth > maxDepth) return;
    if (segIdx >= segments.length) {
      results.push(cur);
      return;
    }

    const seg = segments[segIdx];

    if (seg.type === "key") {
      if (cur == null) return;
      if (isPlainObject(cur) && seg.value! in cur) {
        walk(cur[seg.value!], segIdx + 1, depth + 1);
      }
      return;
    }

    if (seg.type === "index") {
      const idx = Number(seg.value);
      if (Array.isArray(cur) && idx >= 0 && idx < cur.length) {
        walk(cur[idx], segIdx + 1, depth + 1);
      }
      return;
    }

    if (seg.type === "wildcard") {
      // [] 同时支持 Array 遍历和 Object(dict) values 遍历
      const items = Array.isArray(cur) ? cur
        : isPlainObject(cur) ? Object.values(cur)
        : null;
      if (!items) return;
      for (const item of items) {
        if (results.length >= limit) break;
        walk(item, segIdx + 1, depth + 1);
      }
    }

    if (seg.type === "globstar") {
      // * 通配 object 所有 key → value, 继续递归
      if (isPlainObject(cur)) {
        for (const [k, v] of Object.entries(cur)) {
          if (results.length >= limit) break;
          walk(v, segIdx + 1, depth + 1);
        }
      }
    }

    if (seg.type === "filter") {
      // [?key~pattern] 或 [?key=pattern] 过滤 object 的 key
      if (!isPlainObject(cur) || !seg.value) return;
      const m = seg.value.match(/^(\w+)([~=])(.+)$/);
      if (!m) return;
      const [, field, op, pattern] = m;
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      for (const [k, v] of Object.entries(cur)) {
        if (results.length >= limit) break;
        const testVal = field === "key" ? k : (v != null && typeof v === "object" && field in v) ? (v as any)[field] : undefined;
        if (testVal != null && re.test(String(testVal))) {
          walk(v, segIdx + 1, depth + 1);
        }
      }
    }
  }

  walk(data, segments[0]?.type === "key" && segments[0]?.value === "root" ? 1 : 0, 0);
  return results;
}

/**
 * 在 object 内按 key 读取值，支持点路径 + 数组下标。
 * 优先整 key 匹配，再逐段拆分。
 */
export function readByKey(obj: any, key: string): any {
  if (obj == null) return undefined;
  if (key in obj) return obj[key];
  const parts = key.split(".");
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    const m = part.match(/^([\w$-]+)(?:\[(\d+)\])?$/);
    if (!m) return undefined;
    const [, k, idx] = m;
    if (isPlainObject(cur) && k in cur) cur = cur[k];
    else return undefined;
    if (idx !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx)];
    }
  }
  return cur;
}

/**
 * 路径解析失败时, 返回最后有效节点的最近 key 提示。
 * 用于 getByPath 返回空时诊断路径问题。
 */
export function getClosestKeys(data: any, path: string, opts: { limit?: number } = {}): {
  lastValidPath: string;
  lastNodeType: string;
  closestKeys: string[];
  searchedKey: string | null;
} | null {
  const { limit = 10 } = opts;
  const segments = splitPath(path);
  // 去掉 root segment
  const startIdx = segments[0]?.type === "key" && segments[0]?.value === "root" ? 1 : 0;

  let cur: any = data;
  let lastPath = "root";
  let searchedKey: string | null = null;

  for (let i = startIdx; i < segments.length; i++) {
    const seg = segments[i];
    const parentPath = lastPath;

    if (seg.type === "key") {
      if (!isPlainObject(cur)) {
        return { lastValidPath: parentPath, lastNodeType: typeof cur, closestKeys: [], searchedKey: seg.value! };
      }
      if (seg.value! in cur) {
        cur = cur[seg.value!];
        lastPath += `.${seg.value!}`;
        continue;
      }
      // key 不存在 → 返回最近 keys
      const allKeys = Object.keys(cur);
      const closest = allKeys
        .map((k) => ({ key: k, score: levenshteinDistance(k, seg.value!) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map((x) => x.key);
      return { lastValidPath: parentPath, lastNodeType: "object", closestKeys: closest, searchedKey: seg.value! };
    }

    if (seg.type === "index") {
      if (!Array.isArray(cur)) {
        return { lastValidPath: parentPath, lastNodeType: isPlainObject(cur) ? "object" : typeof cur, closestKeys: isPlainObject(cur) ? Object.keys(cur).slice(0, limit) : [], searchedKey: `[${seg.value}]` };
      }
      const idx = Number(seg.value);
      if (idx >= 0 && idx < cur.length) {
        cur = cur[idx];
        lastPath += `[${seg.value}]`;
        continue;
      }
      return { lastValidPath: parentPath, lastNodeType: `array[${cur.length}]`, closestKeys: [], searchedKey: `[${seg.value}]` };
    }

    if (seg.type === "wildcard" || seg.type === "globstar" || seg.type === "filter") {
      lastPath += seg.type === "globstar" ? ".*" : seg.type === "filter" ? `[?${seg.value}]` : "[]";
      // wildcard 不消耗 cur, 继续
      // 但 walk 需要展开 — 这里只做路径诊断, 无需展开
      searchedKey = "[]";
      continue;
    }
  }

  return null; // 路径完全匹配, 不应该调用此函数
}

/** Levenshtein 距离, case-insensitive */
function levenshteinDistance(a: string, b: string): number {
  const sa = a.toLowerCase(), sb = b.toLowerCase();
  const m = sa.length, n = sb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
