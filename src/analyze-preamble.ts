// analyze 输出顶部: 按权重排序的重量级 path 摘要
import type { FlatSchemaItem } from "./types.js";
import { summarizeSchema } from "./summarize.js";

function descendantCount(path: string, schema: FlatSchemaItem[]): number {
  const dot = path + ".";
  const arr = path + "[].";
  return schema.filter((x) => x.path !== path && (x.path.startsWith(dot) || x.path.startsWith(arr))).length;
}

/** 容器节点权重（record / 大 object / 大 array） */
export function scorePathWeight(item: FlatSchemaItem, schema: FlatSchemaItem[]): number {
  if (item.path === "root") return 0;
  let w = 0;
  const desc = descendantCount(item.path, schema);
  w += desc * 4;

  if (item.type === "record") {
    w += (item.keysCount ?? 0) * 25;
    if (item.recordOverlap != null && item.recordOverlap < 0.7) w += 40;
  } else if (item.type === "object" && item.keys) {
    w += item.keys.length * 3;
    if (item.comment?.startsWith("truncated")) w += 200;
  } else if (item.type === "array" && item.itemTypes) {
    const n = item.itemTypes.reduce((s, it) => s + it.count, 0);
    w += n * 2;
    if (item.comment?.startsWith("truncated")) w += 150;
  } else if (item.type === "mixed") {
    w += 120;
  } else if (item.longText || item.type === "long-text") {
    w += 30 + (item.originalLength ?? 0) / 200;
  }

  return w;
}

export function pickHeaviestPaths(schema: FlatSchemaItem[], limit = 10): { item: FlatSchemaItem; weight: number }[] {
  const candidates = schema.filter(
    (it) =>
      it.path !== "root" &&
      (it.type === "record" ||
        (it.type === "object" && (it.keys?.length ?? 0) >= 3) ||
        (it.type === "array" && (it.itemTypes?.reduce((s, t) => s + t.count, 0) ?? 0) > 0) ||
        it.type === "mixed")
  );

  const scored = candidates
    .map((item) => ({ item, weight: scorePathWeight(item, schema) }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.item.path.localeCompare(b.item.path));

  const out: { item: FlatSchemaItem; weight: number }[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (seen.has(row.item.path)) continue;
    seen.add(row.item.path);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function describeHeavy(item: FlatSchemaItem, schema: FlatSchemaItem[]): string {
  const parts: string[] = [];
  if (item.type === "record") {
    parts.push(`record`);
    if (item.keysCount != null) parts.push(`keyCount=${item.keysCount}`);
    if (item.recordOverlap != null) parts.push(`overlap=${(item.recordOverlap * 100).toFixed(0)}%`);
  } else if (item.type === "object" && item.keys) {
    parts.push(`object`);
    parts.push(`${item.keys.length} keys`);
  } else if (item.type === "array" && item.itemTypes) {
    const n = item.itemTypes.reduce((s, it) => s + it.count, 0);
    parts.push(`array[${n}]`);
  } else {
    parts.push(item.type);
  }
  const desc = descendantCount(item.path, schema);
  if (desc > 0) parts.push(`schemaNodes≈${desc}`);
  return parts.join(", ");
}

export interface AnalyzePreambleOptions {
  top?: number;
  sourceLabel?: string;
}

/** Markdown 摘要块，置于 analyze 正文之前 */
export function renderAnalyzePreamble(schema: FlatSchemaItem[], opts: AnalyzePreambleOptions = {}): string {
  const top = opts.top ?? 10;
  const summary = summarizeSchema(schema);
  const heaviest = pickHeaviestPaths(schema, top);

  const lines: string[] = ["## Analyze summary", ""];
  if (opts.sourceLabel) lines.push(`- **source**: \`${opts.sourceLabel}\``);
  lines.push(
    `- **schema**: ${summary.totalNodes} nodes, depth ${summary.maxDepth}, objects ${summary.objectsCount}, arrays ${summary.arraysCount}, mixed ${summary.mixedFields}`
  );
  lines.push("");
  lines.push(`### Top ${heaviest.length} paths by weight`);
  lines.push("");
  for (const { item, weight } of heaviest) {
    lines.push(`- \`${item.path}\` — ${describeHeavy(item, schema)} _(weight ${Math.round(weight)})_`);
  }
  lines.push("");
  return lines.join("\n");
}

export function finalizePreamble(preamble: string, extraLines: string): string {
  const note = extraLines.trim();
  if (!note) return `${preamble}---\n\n`;
  return `${preamble}${note}\n\n---\n\n`;
}