// 将 FlatSchemaItem[] 渲染为 Markdown 格式
// 每个 item 作为一个独立 section，信息完整、无嵌套、AI 友好
import type { FlatSchemaItem } from "./types.js";

export function renderMarkdown(items: FlatSchemaItem[]): string {
  const sections: string[] = [];
  for (const item of items) {
    sections.push(renderItem(item));
  }
  return sections.join("\n\n");
}

function renderItem(item: FlatSchemaItem): string {
  const lines: string[] = [];

  // 第一行: path + type
  const typeLabel = buildTypeLabel(item);
  lines.push(`**${item.path}** — \`${typeLabel}\``);

  // 第二行: 核心详情 (keys / items / sample / length / comment)
  const detail = buildDetailLine(item);
  if (detail) lines.push(detail);

  // 第三行: 补充信息 (presence / variants)
  const extra = buildExtraLine(item);
  if (extra) lines.push(extra);

  return lines.join("\n");
}

/** 构建类型标签，如 "object" / "array[4]" / "long-text[167]" */
function buildTypeLabel(item: FlatSchemaItem): string {
  if (item.type === "array" && item.itemTypes) {
    const total = item.itemTypes.reduce((s, it) => s + it.count, 0);
    return `array[${total}]`;
  }
  if (item.longText && item.originalLength) {
    return `long-text[${item.originalLength}]`;
  }
  return item.type;
}

/** 构建第二行详情 */
function buildDetailLine(item: FlatSchemaItem): string | null {
  const lines: string[] = [];

  // object: keys
  if (item.type === "object" && item.keys) {
    lines.push(`keys: ${item.keys.map((k) => "`" + k + "`").join(", ")}`);
  }

  // array: itemTypes
  if (item.type === "array" && item.itemTypes) {
    if (item.itemTypes.length === 0) {
      lines.push(`items: (empty)`);
    } else {
      const parts = item.itemTypes.map((it) => {
        let s = `${it.type}(${it.count})`;
        if (it.samples && it.samples.length > 0) {
          s += "=" + it.samples.map((samp) => inlineValue(samp)).join(", ");
        }
        return "`" + s + "`";
      });
      lines.push(`items: ${parts.join(", ")}`);
    }
  }

  // mixed: variants (与 sample 共存)
  if (item.type === "mixed" && item.variants) {
    const parts = item.variants.map((v) => {
      let s = `${v.type}(${v.count})`;
      if (v.samples && v.samples.length > 0) {
        s += "=" + v.samples.map((samp) => inlineValue(samp)).join(", ");
      }
      return "`" + s + "`";
    });
    lines.push(`variants: ${parts.join(", ")}`);
  }

  // 标量 sample (长文本不显示截断内容，只显示 length)
  if (item.sampleValue !== undefined) {
    if (item.longText) {
      lines.push(`length: \`${item.originalLength}\``);
    } else {
      lines.push(`sample: \`${inlineValue(item.sampleValue)}\``);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/** 构建第三行补充信息 */
function buildExtraLine(item: FlatSchemaItem): string | null {
  const extras: string[] = [];

  if (item.note) {
    extras.push(`note: \`${item.note}\``);
  }

  if (item.comment) {
    extras.push(`comment: \`${item.comment}\``);
  }

  return extras.length > 0 ? extras.join(" | ") : null;
}

/** 将标量值转为内联文本，字符串加引号 */
function inlineValue(v: any): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}
