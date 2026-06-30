// 双 JSON 对齐 walk，产出 DiffEvent 流
import isPlainObject from "lodash/isPlainObject.js";
import { getByPath } from "./paths.js";
import { appendPathKey } from "./path-utils.js";

export type DiffEventKind = "keyAdded" | "keyRemoved" | "valueChanged" | "typeChanged";

export interface DiffEvent {
  kind: DiffEventKind;
  path: string;
  key?: string;
  left?: unknown;
  right?: unknown;
  leftType?: string;
  rightType?: string;
  bytes: number;
}

export interface DiffWalkOptions {
  pathPrefix?: string;
  ignorePathGlobs?: string[];
  valueDepth?: number;
  dictKeyOnly?: boolean;
  arrayMode?: "index" | "id";
  maxChanges?: number;
}

const LONG_TEXT = 60;

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (isPlainObject(v)) return "object";
  return typeof v;
}

function isLongText(v: unknown): boolean {
  return typeof v === "string" && v.length > LONG_TEXT;
}

function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (isLongText(a) && isLongText(b)) return (a as string).length === (b as string).length;
  if (typeof a === "object" && a !== null && b !== null) return false;
  return false;
}

export function formatValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (isLongText(v)) return `string(len=${(v as string).length})`;
  if (typeof v === "string") return JSON.stringify(v.length > 80 ? v.slice(0, 77) + "…" : v);
  if (typeof v === "object" && v !== null) return `{${typeName(v)}}`;
  return JSON.stringify(v);
}

function pathIgnored(path: string, globs: string[]): boolean {
  if (!globs.length) return false;
  const sub = path.startsWith("root.") ? path.slice(5) : path === "root" ? "" : path;
  for (const g of globs) {
    const norm = g.trim();
    if (!norm) continue;
    const suffix = norm.replace(/^\*\*\./, "");
    if (suffix && (path.endsWith(suffix) || sub.endsWith(suffix))) return true;
    const reSrc = norm
      .replace(/\*\*/g, "§§")
      .replace(/\./g, "\\.")
      .replace(/\*/g, "[^.\\[\\]]*")
      .replace(/§§/g, ".*");
    const re = new RegExp(`^${reSrc}$`);
    if (re.test(path) || re.test(sub)) return true;
  }
  return false;
}

function estBytes(e: Omit<DiffEvent, "bytes">): number {
  const base = e.path.length + 40;
  if (e.kind === "valueChanged") return base + formatValue(e.left).length + formatValue(e.right).length;
  return base + (e.key?.length ?? 0);
}

function pushEvent(out: DiffEvent[], e: Omit<DiffEvent, "bytes">, max: number): void {
  if (out.length >= max) return;
  out.push({ ...e, bytes: estBytes(e) });
}

function looksLikeIdRecord(obj: Record<string, unknown>): boolean {
  const vals = Object.values(obj);
  if (vals.length === 0) return true;
  let withId = 0;
  for (const v of vals.slice(0, 20)) {
    if (isPlainObject(v) && "id" in (v as Record<string, unknown>)) withId++;
  }
  return withId >= Math.min(3, vals.length);
}

function resolveRoots(left: unknown, right: unknown, prefix: string) {
  const p = prefix?.trim() || "root";
  if (p === "root") return { left, right, base: "root" };
  const l = getByPath(left, p, { limit: 1 })[0];
  const r = getByPath(right, p, { limit: 1 })[0];
  return { left: l, right: r, base: p };
}

function walkPair(
  left: unknown,
  right: unknown,
  path: string,
  depth: number,
  opts: DiffWalkOptions,
  out: DiffEvent[],
): void {
  const maxChanges = opts.maxChanges ?? 2000;
  if (out.length >= maxChanges) return;
  if (pathIgnored(path, opts.ignorePathGlobs ?? [])) return;

  const maxD = opts.valueDepth ?? 4;
  if (depth > maxD) return;

  if (left === undefined && right === undefined) return;
  if (left === undefined && right !== undefined) {
    pushEvent(out, { kind: "valueChanged", path, left: undefined, right }, maxChanges);
    return;
  }
  if (left !== undefined && right === undefined) {
    pushEvent(out, { kind: "valueChanged", path, left, right: undefined }, maxChanges);
    return;
  }

  const tl = typeName(left);
  const tr = typeName(right);
  if (tl !== tr) {
    pushEvent(out, { kind: "typeChanged", path, leftType: tl, rightType: tr }, maxChanges);
    return;
  }

  if (tl !== "object" && tl !== "array") {
    if (!valueEqual(left, right)) {
      pushEvent(out, { kind: "valueChanged", path, left, right }, maxChanges);
    }
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (opts.arrayMode === "id") {
      const toMap = (arr: unknown[]) => {
        const m = new Map<string, unknown>();
        for (const item of arr) {
          if (!isPlainObject(item)) continue;
          const row = item as Record<string, unknown>;
          if (row.id != null) m.set(String(row.id), item);
        }
        return m;
      };
      const lm = toMap(left);
      const rm = toMap(right);
      for (const k of lm.keys()) {
        if (!rm.has(k)) pushEvent(out, { kind: "keyRemoved", path, key: k }, maxChanges);
      }
      for (const k of rm.keys()) {
        if (!lm.has(k)) pushEvent(out, { kind: "keyAdded", path, key: k }, maxChanges);
      }
      for (const k of lm.keys()) {
        if (rm.has(k) && !opts.dictKeyOnly) {
          walkPair(lm.get(k), rm.get(k), appendPathKey(path, k), depth + 1, opts, out);
        }
      }
      return;
    }
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      walkPair(left[i], right[i], `${path}[${i}]`, depth + 1, opts, out);
    }
    return;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const lrec = looksLikeIdRecord(left as Record<string, unknown>);
    const rrec = looksLikeIdRecord(right as Record<string, unknown>);
    const asRecord = lrec && rrec;

    if (asRecord) {
      const lk = new Set(Object.keys(left as object));
      const rk = new Set(Object.keys(right as object));
      for (const k of lk) {
        if (!rk.has(k)) pushEvent(out, { kind: "keyRemoved", path, key: k }, maxChanges);
      }
      for (const k of rk) {
        if (!lk.has(k)) pushEvent(out, { kind: "keyAdded", path, key: k }, maxChanges);
      }
      if (!opts.dictKeyOnly) {
        for (const k of lk) {
          if (rk.has(k)) {
            walkPair(
              (left as Record<string, unknown>)[k],
              (right as Record<string, unknown>)[k],
              appendPathKey(path, k),
              depth + 1,
              opts,
              out,
            );
          }
        }
      }
      return;
    }

    const lk = new Set(Object.keys(left as object));
    const rk = new Set(Object.keys(right as object));
    for (const k of lk) {
      if (!rk.has(k)) pushEvent(out, { kind: "keyRemoved", path, key: k }, maxChanges);
    }
    for (const k of rk) {
      if (!lk.has(k)) pushEvent(out, { kind: "keyAdded", path, key: k }, maxChanges);
    }
    for (const k of lk) {
      if (rk.has(k)) {
        walkPair(
          (left as Record<string, unknown>)[k],
          (right as Record<string, unknown>)[k],
          appendPathKey(path, k),
          depth + 1,
          opts,
          out,
        );
      }
    }
  }
}

export function diffWalk(leftRoot: unknown, rightRoot: unknown, opts: DiffWalkOptions = {}): DiffEvent[] {
  const { left, right, base } = resolveRoots(leftRoot, rightRoot, opts.pathPrefix ?? "root");
  const events: DiffEvent[] = [];
  walkPair(left, right, base, 0, opts, events);
  return events;
}

export const DEFAULT_DIFF_IGNORE = ["**.content", "**.excerpt", "**.excerptNew", "**.avatarUrl", "**.avatarUrlTemplate"];

export function parseIgnorePaths(s?: string): string[] {
  if (!s?.trim()) return [...DEFAULT_DIFF_IGNORE];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}