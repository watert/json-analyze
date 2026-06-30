// 两层级 schema 输出: 语义 tag 包裹 + 子字段 (非裸 XML 文档)
import { getParent } from "./path-utils.js";
import type { FlatSchemaItem } from "./types.js";
import { buildDetailLine, buildExtraLine, buildTypeLabel } from "./format.js";

export type TreeFormat = "tree" | "xml";

export interface TwoLevelSection {
  parent: FlatSchemaItem;
  children: FlatSchemaItem[];
}

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

export function semanticTagFromPath(path: string): string {
  const tail = path.replace(/^root\.?/, "").split(".").pop() ?? "root";
  const base = tail.replace(/\[\]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return base || "node";
}

function fieldSummary(item: FlatSchemaItem): string {
  const parts: string[] = [buildTypeLabel(item)];
  const detail = buildDetailLine(item);
  if (detail) parts.push(detail.replace(/\n/g, "; "));
  const extra = buildExtraLine(item);
  if (extra) parts.push(extra);
  return parts.join(" — ");
}

function renderFieldInTag(item: FlatSchemaItem, indent: string): string {
  const tag = semanticTagFromPath(item.path);
  const name = item.path.split(".").pop() ?? item.path;
  const summary = fieldSummary(item);
  return `${indent}<${tag} path="${item.path}" name="${name}">${summary}</${tag}>`;
}

export function renderTreeMarkdown(items: FlatSchemaItem[]): string {
  const { sections, orphans } = groupSchemaTwoLevels(items);
  const blocks: string[] = [];

  for (const { parent, children } of sections) {
    const pTag = semanticTagFromPath(parent.path);
    const head = `### ${parent.path}`;
    const pMeta = [buildTypeLabel(parent), buildDetailLine(parent), buildExtraLine(parent)].filter(Boolean).join("\n");
    const inner = children.map((c) => renderFieldInTag(c, "  ")).join("\n");
    blocks.push(`${head}\n\n<${pTag} type="${buildTypeLabel(parent)}" path="${parent.path}">\n${pMeta ? `${pMeta}\n` : ""}${inner}\n</${pTag}>`);
  }

  if (orphans.length) blocks.push(orphans.map((c) => renderFieldInTag(c, "")).join("\n"));
  return blocks.join("\n\n");
}

export function renderXmlMarkdown(items: FlatSchemaItem[]): string {
  return renderTreeMarkdown(items);
}

export function renderGroupedMarkdown(items: FlatSchemaItem[], _format: TreeFormat): string {
  return renderTreeMarkdown(items);
}