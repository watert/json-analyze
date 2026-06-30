// 将 FlatSchemaItem[] 渲染为 Markdown
import { renderGroupedFlatMarkdown, type GroupedRenderOptions } from "./format-grouped.js";
import type { FlatSchemaItem } from "./types.js";

export type AnalyzeMdFormat = "md" | "md-flat" | "json";

/** analyze CLI: 默认 md = 扁平 Markdown + record 下 ### 分组；md-flat = 无分组 */
export function renderAnalyzeMarkdown(
  items: FlatSchemaItem[],
  format: AnalyzeMdFormat | "tree" | "xml" = "md",
  renderOpts?: GroupedRenderOptions
): string {
  if (format === "md-flat") return renderMarkdown(items);
  return renderGroupedFlatMarkdown(items, renderOpts);
}

export function renderMarkdown(items: FlatSchemaItem[]): string {
  const sections: string[] = [];
  for (const item of items) {
    sections.push(renderItem(item));
  }
  return sections.join("\n\n");
}

function renderItem(item: FlatSchemaItem): string {
  const lines: string[] = [];
  const typeLabel = buildTypeLabel(item);
  lines.push(`**${item.path}** — ${typeLabel}`);
  const detail = buildDetailLine(item);
  if (detail) lines.push(detail);
  const extra = buildExtraLine(item);
  if (extra) lines.push(extra);
  return lines.join("\n");
}

/** 逗号分隔字段名，无 markdown 反引号 */
export function formatPlainList(names: string[], max = 40): string {
  const slice = names.slice(0, max);
  const tail = names.length > max ? ` … +${names.length - max}` : "";
  return slice.join(", ") + tail;
}

export function buildTypeLabel(item: FlatSchemaItem): string {
  if (item.type === "record" && item.keysCount != null) return `record[${item.keysCount}]`;
  if (item.type === "array" && item.itemTypes) {
    const total = item.itemTypes.reduce((s, it) => s + it.count, 0);
    return `array[${total}]`;
  }
  if (item.longText && item.originalLength) return `long-text[${item.originalLength}]`;
  return item.type;
}

export function buildDetailLine(item: FlatSchemaItem): string | null {
  const lines: string[] = [];
  if (item.type === "record") {
    if (item.sampleKeys?.length) lines.push(`sample keys: ${formatPlainList(item.sampleKeys, 20)}`);
    if (item.recordOverlap != null) lines.push(`keys overlap (sample): ${(item.recordOverlap * 100).toFixed(0)}%`);
  }
  if (item.type === "object" && item.keys) {
    lines.push(`keys: ${formatPlainList(item.keys, 80)}`);
  }
  if (item.type === "array" && item.itemTypes) {
    if (item.itemTypes.length === 0) lines.push(`items: (empty)`);
    else {
      const parts = item.itemTypes.map((it) => {
        let s = `${it.type}(${it.count})`;
        if (it.samples?.length) s += "=" + it.samples.map((samp) => inlineValue(samp)).join(", ");
        return s;
      });
      lines.push(`items: ${parts.join(", ")}`);
    }
  }
  if (item.type === "mixed" && item.variants) {
    const parts = item.variants.map((v) => {
      let s = `${v.type}(${v.count})`;
      if (v.samples?.length) s += "=" + v.samples.map((samp) => inlineValue(samp)).join(", ");
      return s;
    });
    lines.push(`variants: ${parts.join(", ")}`);
  }
  if (item.sampleValue !== undefined) {
    if (item.longText) lines.push(`length: ${item.originalLength}`);
    else lines.push(`sample: ${inlineValue(item.sampleValue)}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function buildExtraLine(item: FlatSchemaItem): string | null {
  const extras: string[] = [];
  if (item.note) extras.push(`note: ${item.note}`);
  if (item.comment) extras.push(`comment: ${item.comment}`);
  return extras.length > 0 ? extras.join(" | ") : null;
}

export function inlineValue(v: any): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}