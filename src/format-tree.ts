// 两层级 schema 输出: 父 object/record 包一层，子字段一层 (tree | xml)
import { getParent } from "./path-utils.js";
import type { FlatSchemaItem } from "./types.js";
import { buildDetailLine, buildExtraLine, buildTypeLabel } from "./format.js";

export type TreeFormat = "tree" | "xml";

export interface TwoLevelSection {
  parent: FlatSchemaItem;
  children: FlatSchemaItem[];
}

/** 容器节点与其直接子字段 (最多两层展示) */
export function groupSchemaTwoLevels(items: FlatSchemaItem[]): { sections: TwoLevelSection[]; orphans: FlatSchemaItem[] } {
  const covered = new Set<string>();
  const sections: TwoLevelSection[] = [];

  for (const it of items) {
    if (it.type !== "object" && it.type !== "record" && it.type !== "array") continue;
    const children = items.filter((c) => c.path !== it.path && getParent(c.path) === it.path);
    if (!children.length) continue;
    for (const c of children) covered.add(c.path);
    covered.add(it.path);
    sections.push({ parent: it, children });
  }

  const orphans = items.filter((i) => !covered.has(i.path));
  return { sections, orphans };
}

function tagName(path: string): string {
  const segs = path.replace(/^root\.?/, "").split(".");
  const last = segs[segs.length - 1] ?? "root";
  return last.replace(/\[\]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "node";
}

function renderFieldBlock(item: FlatSchemaItem, indent: string): string {
  const typeLabel = buildTypeLabel(item);
  const detail = buildDetailLine(item);
  const extra = buildExtraLine(item);
  const lines = [`${indent}**${item.path}** — \`${typeLabel}\``];
  if (detail) lines.push(`${indent}${detail.split("\n").join(`\n${indent}`)}`);
  if (extra) lines.push(`${indent}${extra}`);
  return lines.join("\n");
}

export function renderTreeMarkdown(items: FlatSchemaItem[]): string {
  const { sections, orphans } = groupSchemaTwoLevels(items);
  const blocks: string[] = [];

  for (const { parent, children } of sections) {
    const head = `### ${parent.path} — \`${buildTypeLabel(parent)}\``;
    const meta = [buildDetailLine(parent), buildExtraLine(parent)].filter(Boolean).join("\n");
    const body = children.map((c) => renderFieldBlock(c, "  ")).join("\n\n");
    blocks.push([head, meta, body].filter(Boolean).join("\n\n"));
  }

  if (orphans.length) blocks.push(orphans.map((c) => renderFieldBlock(c, "")).join("\n\n"));
  return blocks.join("\n\n");
}

export function renderXmlMarkdown(items: FlatSchemaItem[]): string {
  const { sections, orphans } = groupSchemaTwoLevels(items);
  const chunks: string[] = [];

  for (const { parent, children } of sections) {
    const pTag = tagName(parent.path);
    const attrs = [`type="${buildTypeLabel(parent)}"`];
    if (parent.keysCount != null) attrs.push(`keysCount="${parent.keysCount}"`);
    if (parent.recordOverlap != null) attrs.push(`overlap="${(parent.recordOverlap * 100).toFixed(0)}%"`);
    const childXml = children
      .map((c) => {
        const inner = buildDetailLine(c) ?? buildExtraLine(c) ?? "";
        const sample =
          c.sampleValue !== undefined && !c.longText
            ? ` sample="${String(c.sampleValue).replace(/"/g, "'")}"`
            : "";
        const name = c.path.split(".").pop() ?? c.path;
        return `  <field name="${name}" type="${buildTypeLabel(c)}"${sample}>${inner ? `\n    ${inner}\n  ` : ""}</field>`;
      })
      .join("\n");
    chunks.push(`<${pTag} ${attrs.join(" ")}>\n${childXml}\n</${pTag}>`);
  }

  if (orphans.length) {
    chunks.push(
      `<orphan>\n${orphans.map((c) => `  <field name="${c.path}" type="${buildTypeLabel(c)}"/>`).join("\n")}\n</orphan>`
    );
  }
  return chunks.join("\n\n");
}

export function renderGroupedMarkdown(items: FlatSchemaItem[], format: TreeFormat): string {
  return format === "xml" ? renderXmlMarkdown(items) : renderTreeMarkdown(items);
}