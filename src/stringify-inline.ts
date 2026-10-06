/**
 * 指定 key 或 path 的数组每个元素一行, 其余结构保持缩进。
 * 两轮占位: 先换成 U+E000 占位符, JSON.stringify 后再换回合法数组。parse 结果不变。
 * 按路径选择性压, 不是按行宽折叠 (json-stringify-pretty-compact 那类)。
 * 未压到的树必须是 plain object, Date / class 直接抛, 避免 Object.entries 弄成 {}。
 * 压中的元素交给 JSON.stringify。元素本身是 undefined / function / symbol, 或数组有空洞, 会抛。
 * auto: 元素数 >= 4、含对象/数组、展开行数 >= 24 且超过压后行数的 1.5 倍才压。命中后不下钻。
 */
import isPlainObject from "lodash/isPlainObject.js";
import { appendPathKey, splitPath } from "./path-utils.js";
import type { PathSegment } from "./types.js";

const MARK_BASE = "\uE000";
const AUTO_MIN_ITEMS = 4;
const AUTO_MIN_PRETTY_LINES = 24;
const AUTO_LINE_RATIO = 1.5;

export interface StringifyInlineOptions {
  /** 这些 key 上的数组每个元素一行, 按 key 名全局匹配 */
  keys?: string[];
  /** 命中这些路径的数组才压。语法同 getByPath, 不支持 [?filter] */
  paths?: string[];
  /** 其余结构的缩进, 默认 2 */
  space?: number;
  /** 按展开行数自动压长数组。与 keys / paths 取并集 */
  auto?: boolean;
}

export interface InlineDecision {
  path: string;
  items: number;
  prettyLines: number;
  inlineLines: number;
  reason: "auto" | "key" | "path";
}

function pickMark(serialized: string): string {
  for (let n = 0; n < 8; n++) {
    const mark = `${MARK_BASE}${n}`;
    if (!serialized.includes(mark)) return mark;
  }
  throw new Error("json inline: 数据里占满了私用区占位符");
}

function compilePatterns(paths: string[]): PathSegment[][] {
  return paths.map((p) => {
    const segs = splitPath(p);
    if (segs.some((s) => s.type === "filter")) {
      throw new Error(`json inline: paths 暂不支持 filter: ${p}`);
    }
    if (segs[0]?.type === "key" && segs[0].value === "root") segs.shift();
    return segs;
  });
}

function concreteSegs(path: string): PathSegment[] {
  const segs = splitPath(path);
  if (segs[0]?.type === "key" && segs[0].value === "root") segs.shift();
  return segs;
}

function segMatch(got: PathSegment, want: PathSegment): boolean {
  if (want.type === "globstar") return got.type === "key";
  if (want.type === "wildcard") return got.type === "index" || got.type === "wildcard";
  if (want.type === "index") return got.type === "index" && got.value === want.value;
  if (want.type === "key") return got.type === "key" && got.value === want.value;
  return false;
}

function pathHit(path: string, patterns: PathSegment[][]): boolean {
  if (patterns.length === 0) return false;
  const got = concreteSegs(path);
  return patterns.some((want) => want.length === got.length && want.every((seg, i) => segMatch(got[i], seg)));
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** 估算 JSON.stringify(value, null, 2) 的行数。空对象 / 空数组是 1 行 */
function estPrettyLines(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    let n = 2;
    for (let i = 0; i < value.length; i++) n += estPrettyLines(value[i]);
    return n;
  }
  if (!isPlainObject(value)) return 1;
  const vals = Object.values(value).filter((v) => v !== undefined);
  if (vals.length === 0) return 1;
  let n = 2;
  for (const v of vals) n += estPrettyLines(v);
  return n;
}

function lineStats(node: unknown[]): { prettyLines: number; inlineLines: number } {
  return {
    prettyLines: estPrettyLines(node),
    inlineLines: node.length === 0 ? 1 : 2 + node.length,
  };
}

/** 标量数组压了也不省行。空洞和非法元素留给显式 keys/paths 去抛 */
function autoStats(node: unknown[]): { prettyLines: number; inlineLines: number } | null {
  if (node.length < AUTO_MIN_ITEMS) return null;
  let compound = false;
  for (let i = 0; i < node.length; i++) {
    if (!Object.hasOwn(node, i)) return null;
    const item = node[i];
    if (item !== null && typeof item === "object") {
      compound = true;
      continue;
    }
    if (!isScalar(item)) return null;
  }
  if (!compound) return null;
  const stats = lineStats(node);
  if (stats.prettyLines < AUTO_MIN_PRETTY_LINES) return null;
  if (stats.prettyLines <= stats.inlineLines * AUTO_LINE_RATIO) return null;
  return stats;
}

function decide(
  node: unknown[],
  key: string | null,
  path: string,
  keys: Set<string>,
  patterns: PathSegment[][],
  auto: boolean,
): InlineDecision | null {
  if (key != null && keys.has(key)) return { path, items: node.length, ...lineStats(node), reason: "key" };
  if (pathHit(path, patterns)) return { path, items: node.length, ...lineStats(node), reason: "path" };
  if (!auto) return null;
  const stats = autoStats(node);
  if (!stats) return null;
  return { path, items: node.length, ...stats, reason: "auto" };
}

function walk(
  node: unknown,
  key: string | null,
  path: string,
  keys: Set<string>,
  patterns: PathSegment[][],
  auto: boolean,
  mark: string,
  slots: string[][],
  decisions: InlineDecision[],
): unknown {
  if (Array.isArray(node)) {
    const hit = decide(node, key, path, keys, patterns, auto);
    if (hit) {
      decisions.push(hit);
      const lines: string[] = [];
      for (let i = 0; i < node.length; i++) {
        if (!Object.hasOwn(node, i)) throw new Error(`json inline: ${path}[${i}] 是数组空洞`);
        const line = JSON.stringify(node[i]);
        if (line === undefined) throw new Error(`json inline: ${path}[${i}] 不是 JSON 值 (${typeof node[i]})`);
        lines.push(line);
      }
      slots.push(lines);
      return `${mark}${slots.length - 1}${mark}`;
    }
    return node.map((item, i) => walk(item, key, `${path}[${i}]`, keys, patterns, auto, mark, slots, decisions));
  }
  if (node && typeof node === "object") {
    if (!isPlainObject(node)) {
      const name = node.constructor?.name || "Object";
      throw new Error(`json inline: ${path} 不是 plain JSON 对象 (${name})`);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = walk(v, k, appendPathKey(path, k), keys, patterns, auto, mark, slots, decisions);
    }
    return out;
  }
  return node;
}

function build(value: unknown, opts: StringifyInlineOptions): { text: string; decisions: InlineDecision[] } {
  const keys = opts.keys ?? [];
  const paths = opts.paths ?? [];
  if (!opts.auto && keys.length === 0 && paths.length === 0) throw new Error("json inline: 需要 keys、paths 或 auto");
  const space = opts.space ?? 2;
  if (!Number.isInteger(space) || space < 0) throw new Error("json inline: space 必须是非负整数");

  const raw = JSON.stringify(value);
  if (raw == null) throw new Error("json inline: 无法序列化");
  const mark = pickMark(raw);
  const slots: string[][] = [];
  const decisions: InlineDecision[] = [];
  let text = JSON.stringify(
    walk(value, null, "root", new Set(keys), compilePatterns(paths), !!opts.auto, mark, slots, decisions),
    null,
    space,
  );
  const pad = " ".repeat(space);

  for (let i = 0; i < slots.length; i++) {
    const token = `"${mark}${i}${mark}"`;
    const idx = text.indexOf(token);
    if (idx < 0) throw new Error(`json inline: 占位符丢失 ${i}`);
    const lineStart = text.lastIndexOf("\n", idx) + 1;
    const leading = (/^[ \t]*/.exec(text.slice(lineStart, idx)) ?? [""])[0];
    const lines = slots[i];
    const inline = lines.length
      ? `[\n${lines.map((line) => leading + pad + line).join(",\n")}\n${leading}]`
      : "[]";
    text = text.slice(0, idx) + inline + text.slice(idx + token.length);
  }
  return { text: `${text}\n`, decisions };
}

/** 指定 key / path 的数组每个元素一行; 其余按 space 缩进。空数组保持 [] */
export function stringifyInlineArrays(value: unknown, opts: StringifyInlineOptions = {}): string {
  return build(value, opts).text;
}

/** 同样的判定, 只返回会被压的数组。顺序与输出里出现的顺序一致 */
export function planInlineArrays(value: unknown, opts: StringifyInlineOptions = {}): InlineDecision[] {
  return build(value, opts).decisions;
}
