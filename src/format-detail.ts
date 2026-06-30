// analyze 默认输出: 紧凑 MD + 语义 tag，控制体积
import { countPathDepth, getParent } from "./path-utils.js";
import type { FlatSchemaItem } from "./types.js";
import { buildTypeLabel } from "./format.js";
import { semanticTagFromPath } from "./format-tree.js";

const CONTAINER = new Set(["object", "record", "array"]);
const MAX_EMIT_DEPTH = 5;

function childName(path: string): string {
  return (path.split(".").pop() ?? path).replace(/\[\]/g, "");
}

function shortScalar(item: FlatSchemaItem): string {
  const t = buildTypeLabel(item);
  if (item.longText && item.originalLength) return `long-text[${item.originalLength}]`;
  if (item.sampleValue !== undefined && !item.longText) {
    const v = item.sampleValue;
    const s = typeof v === "string" ? (v.length > 24 ? `"${v.slice(0, 20)}…"` : `"${v}"`) : String(v);
    return `${t}=${s}`;
  }
  if (item.type === "mixed" && item.variants?.length) {
    return `mixed ${item.variants.map((v) => `${v.type}(${v.count})`).join(",")}`;
  }
  return t;
}

function objectKeysBrief(item: FlatSchemaItem): string {
  if (!item.keys?.length) return "object";
  if (item.keys.length <= 8) return `object(${item.keys.join(",")})`;
  return `object(${item.keys.length} keys)`;
}

function nodeHead(item: FlatSchemaItem): string {
  if (item.type === "record" && item.keysCount != null) {
    const o = item.recordOverlap != null ? ` ~${(item.recordOverlap * 100).toFixed(0)}%` : "";
    return `record[${item.keysCount}]${o}`;
  }
  if (item.type === "object") return objectKeysBrief(item);
  if (item.type === "array" && item.itemTypes) {
    const n = item.itemTypes.reduce((s, it) => s + it.count, 0);
    const inner = item.itemTypes.map((it) => `${it.type}(${it.count})`).join(",");
    return `array[${n}] ${inner}`;
  }
  return shortScalar(item);
}

function indexChildren(items: FlatSchemaItem[]): Map<string, FlatSchemaItem[]> {
  const m = new Map<string, FlatSchemaItem[]>();
  for (const it of items) {
    const p = getParent(it.path);
    if (!p) continue;
    const arr = m.get(p) ?? [];
    arr.push(it);
    m.set(p, arr);
  }
  return m;
}

function shouldExpand(path: string, node: FlatSchemaItem, depth: number): boolean {
  if (depth > MAX_EMIT_DEPTH) return false;
  if (node.type === "record") return true;
  if (depth <= 2) return true;
  if (depth === 3 && path.startsWith("root.entities.")) return true;
  return depth <= 4 && CONTAINER.has(node.type);
}

function renderNode(
  path: string,
  node: FlatSchemaItem,
  childrenOf: Map<string, FlatSchemaItem[]>,
  depth: number
): string {
  const tag = semanticTagFromPath(path);
  const kids = (childrenOf.get(path) ?? []).filter((k) => countPathDepth(k.path) <= MAX_EMIT_DEPTH + 1);

  if (node.type === "record") {
    const fields = kids.map((c) => `${childName(c.path)} ${buildTypeLabel(c)}`).join("; ");
    return `<${tag} ${nodeHead(node)}>\n  ${fields}\n</${tag}>`;
  }

  if (!shouldExpand(path, node, depth)) {
    return `<${tag} ${nodeHead(node)}/>`;
  }

  const leafKids = kids.filter((k) => !CONTAINER.has(k.type) || !(childrenOf.get(k.path)?.length));
  const nestKids = kids.filter((k) => CONTAINER.has(k.type) && (childrenOf.get(k.path)?.length ?? 0) > 0);

  const parts: string[] = [];
  if (leafKids.length) {
    const line = leafKids.map((c) => `${childName(c.path)} ${shortScalar(c)}`).join("; ");
    parts.push(`  ${line}`);
  }
  for (const nk of nestKids) {
    if (!shouldExpand(nk.path, nk, depth + 1)) {
      parts.push(`  <${semanticTagFromPath(nk.path)} ${nodeHead(nk)}/>`);
    } else {
      parts.push(renderNode(nk.path, nk, childrenOf, depth + 1).split("\n").map((l, i) => (i === 0 ? "  " + l : "  " + l)).join("\n"));
    }
  }

  if (!parts.length) return `<${tag} ${nodeHead(node)}/>`;
  return `<${tag} ${nodeHead(node)}>\n${parts.join("\n")}\n</${tag}>`;
}

export function renderDetailMarkdown(items: FlatSchemaItem[]): string {
  const byPath = new Map(items.map((i) => [i.path, i]));
  const childrenOf = indexChildren(items);
  const root = byPath.get("root");
  if (!root) return "";
  return renderNode("root", root, childrenOf, 0);
}