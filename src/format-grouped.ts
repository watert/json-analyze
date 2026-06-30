// analyze: summary + 大组（record / object 段）全量或 keyNames digest
import { finalizePreamble, renderAnalyzePreamble, type AnalyzePreambleOptions } from "./analyze-preamble.js";
import { DEFAULT_DETAIL_MAX_BYTES, type DetailBudgetOptions, filterSchemaByPathPrefix } from "./analyze-detail-budget.js";
import {
  clusterFlatPaths,
  planGroupCompression,
  recordFieldKeyNames,
  renderDigestFooter,
  renderGroupBudgetNote,
  type CompressUnit,
} from "./format-compress-groups.js";
import { scorePathWeight } from "./analyze-preamble.js";
import { getParent } from "./path-utils.js";
import type { FlatSchemaItem } from "./types.js";
import { buildDetailLine, buildExtraLine, buildTypeLabel } from "./format.js";
import { renderNestedObjectGroup } from "./format-nested-md.js";

const RECORD_TAG = "record";

export interface GroupedRenderOptions extends AnalyzePreambleOptions, DetailBudgetOptions {}

function fieldLabelInRecord(recordPath: string, childPath: string): string {
  const prefix = `${recordPath}[].`;
  if (childPath.startsWith(prefix)) return childPath.slice(prefix.length);
  return (childPath.split(".").pop() ?? childPath).replace(/\[\]/g, "");
}

function renderItemBlock(item: FlatSchemaItem, label?: string): string {
  const lines: string[] = [];
  lines.push(`**${label ?? item.path}** — ${buildTypeLabel(item)}`);
  const detail = buildDetailLine(item);
  if (detail) lines.push(detail);
  const extra = buildExtraLine(item);
  if (extra) lines.push(extra);
  return lines.join("\n");
}

function recordOpenTag(parent: FlatSchemaItem): string {
  const attrs = [`path="${parent.path}"`];
  if (parent.keysCount != null) attrs.push(`keyCount="${parent.keysCount}"`);
  if (parent.recordOverlap != null) attrs.push(`overlap="${(parent.recordOverlap * 100).toFixed(0)}%"`);
  return `<${RECORD_TAG} ${attrs.join(" ")}>`;
}

function recordBlockFull(parent: FlatSchemaItem, kids: FlatSchemaItem[]): string {
  const meta = [buildDetailLine(parent), buildExtraLine(parent)].filter(Boolean).join("\n");
  const body = kids.map((c) => renderItemBlock(c, fieldLabelInRecord(parent.path, c.path))).join("\n\n");
  return `${recordOpenTag(parent)}\n${[meta, body].filter(Boolean).join("\n\n")}\n</${RECORD_TAG}>`;
}

function renderObjectGroupFull(groupPath: string, paths: FlatSchemaItem[]): string {
  return renderNestedObjectGroup(groupPath, paths);
}

export function renderGroupedFlatMarkdown(items: FlatSchemaItem[], opts?: GroupedRenderOptions): string {
  const childrenOf = new Map<string, FlatSchemaItem[]>();
  for (const it of items) {
    const p = getParent(it.path);
    if (!p) continue;
    const arr = childrenOf.get(p) ?? [];
    arr.push(it);
    childrenOf.set(p, arr);
  }

  const recordParents = items.filter((it) => it.type === "record" && (childrenOf.get(it.path)?.length ?? 0) > 0);
  const covered = new Set<string>();
  const recordUnits: CompressUnit[] = [];

  for (const parent of recordParents) {
    const kids = childrenOf.get(parent.path)!;
    for (const k of kids) covered.add(k.path);
    covered.add(parent.path);
    const full = recordBlockFull(parent, kids);
    recordUnits.push({
      path: parent.path,
      node: parent,
      kind: "record",
      keyNames: recordFieldKeyNames(parent.path, kids),
      bytes: new TextEncoder().encode(full).length,
      weight: scorePathWeight(parent, items),
    });
  }

  const flatItems = items.filter((i) => !covered.has(i.path));
  const objectUnits = clusterFlatPaths(flatItems, items);
  const flatByGroup = new Map<string, FlatSchemaItem[]>();
  for (const it of flatItems) {
    if (it.path === "root") continue;
    const top = it.path.replace(/^root\.?/, "").split(".")[0]?.replace(/\[\]/g, "") ?? "";
    const gp = `root.${top}`;
    const arr2 = flatByGroup.get(gp) ?? [];
    arr2.push(it);
    flatByGroup.set(gp, arr2);
  }

  const allUnits = [...recordUnits, ...objectUnits];
  const preamble = renderAnalyzePreamble(items, opts);
  const preambleBytes = new TextEncoder().encode(preamble).length;
  const maxDetail = opts?.maxDetailBytes ?? DEFAULT_DETAIL_MAX_BYTES;
  const drillFile = opts?.drillFile ?? opts?.sourceLabel ?? "<file>";
  const plan = planGroupCompression(allUnits, preambleBytes, maxDetail, drillFile);

  const extra = plan.overBudget ? renderGroupBudgetNote(plan, plan.digestPaths.size) : "";
  const preambleWithNote = finalizePreamble(preamble, extra);

  const detailBlocks: string[] = [];
  const digestUnits: CompressUnit[] = [];

  for (const u of recordUnits) {
    if (plan.digestPaths.has(u.path)) digestUnits.push(u);
    else {
      const kids = childrenOf.get(u.path)!;
      detailBlocks.push(recordBlockFull(u.node, kids));
    }
  }

  for (const u of objectUnits) {
    const paths = flatByGroup.get(u.path) ?? [];
    if (!paths.length) continue;
    if (plan.digestPaths.has(u.path)) digestUnits.push(u);
    else detailBlocks.push(renderObjectGroupFull(u.path, paths));
  }

  const rootOnly = flatItems.filter((i) => i.path === "root" || !i.path.includes("."));
  if (rootOnly.length) detailBlocks.unshift(rootOnly.map((p) => renderItemBlock(p)).join("\n\n"));

  const body = detailBlocks.join("\n\n");
  const footer = renderDigestFooter(plan, digestUnits);
  const sep = body && footer ? "\n\n" : "";
  return `${preambleWithNote}${body}${sep}${footer}`;
}

export { filterSchemaByPathPrefix };