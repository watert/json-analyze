/**
 * 指定 key 或 path 的数组每个元素一行, 其余结构保持缩进。
 * 两轮占位: 先换成 U+E000 占位符, JSON.stringify 后再换回合法数组。parse 结果不变。
 * 按路径选择性压, 不是按行宽折叠 (json-stringify-pretty-compact 那类)。
 * 未压到的树必须是 plain object, Date / class 直接抛, 避免 Object.entries 弄成 {}。
 * 压中的元素交给 JSON.stringify。元素本身是 undefined / function / symbol, 或数组有空洞, 会抛。
 */
import isPlainObject from "lodash/isPlainObject.js";
import { appendPathKey, splitPath } from "./path-utils.js";
import type { PathSegment } from "./types.js";

const MARK_BASE = "\uE000";

export interface StringifyInlineOptions {
  /** 这些 key 上的数组每个元素一行, 按 key 名全局匹配 */
  keys?: string[];
  /** 命中这些路径的数组才压。语法同 getByPath, 不支持 [?filter] */
  paths?: string[];
  /** 其余结构的缩进, 默认 2 */
  space?: number;
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

function walk(
  node: unknown,
  key: string | null,
  path: string,
  keys: Set<string>,
  patterns: PathSegment[][],
  mark: string,
  slots: string[][],
): unknown {
  if (Array.isArray(node) && ((key != null && keys.has(key)) || pathHit(path, patterns))) {
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
  if (Array.isArray(node)) {
    return node.map((item, i) => walk(item, key, `${path}[${i}]`, keys, patterns, mark, slots));
  }
  if (node && typeof node === "object") {
    if (!isPlainObject(node)) {
      const name = node.constructor?.name || "Object";
      throw new Error(`json inline: ${path} 不是 plain JSON 对象 (${name})`);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = walk(v, k, appendPathKey(path, k), keys, patterns, mark, slots);
    }
    return out;
  }
  return node;
}

/** 指定 key / path 的数组每个元素一行; 其余按 space 缩进。空数组保持 [] */
export function stringifyInlineArrays(value: unknown, opts: StringifyInlineOptions = {}): string {
  const keys = opts.keys ?? [];
  const paths = opts.paths ?? [];
  if (keys.length === 0 && paths.length === 0) throw new Error("json inline: 需要 keys 或 paths");
  const space = opts.space ?? 2;
  if (!Number.isInteger(space) || space < 0) throw new Error("json inline: space 必须是非负整数");

  const raw = JSON.stringify(value);
  if (raw == null) throw new Error("json inline: 无法序列化");
  const mark = pickMark(raw);
  const slots: string[][] = [];
  let text = JSON.stringify(walk(value, null, "root", new Set(keys), compilePatterns(paths), mark, slots), null, space);
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
  return `${text}\n`;
}
