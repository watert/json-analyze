// diff Markdown / JSON 渲染与 50KB digest 预算
import { DEFAULT_DETAIL_MAX_BYTES } from "./analyze-detail-budget.js";
import { MIN_DIGEST_WHEN_OVER_BUDGET } from "./format-compress-groups.js";
import { formatPlainList } from "./format.js";
import type { DiffGroup, DiffJSONResult, DiffSummaryRow } from "./diff-summarize.js";
import { formatValue, type DiffEvent } from "./diff-walk.js";

const DIGEST_OVERHEAD = 420;

export interface DiffFormatOptions {
  leftFile: string;
  rightFile: string;
  leftLabel: string;
  rightLabel: string;
  pathPrefix: string;
  maxDetailBytes?: number;
  ignoreNote?: string;
}

export interface DiffCompressUnit {
  path: string;
  group: DiffGroup;
  bytes: number;
  weight: number;
}

export interface DiffCompressPlan {
  fullBytes: number;
  maxBytes: number;
  overBudget: boolean;
  digestPaths: Set<string>;
  leftFile: string;
  rightFile: string;
}

function estimateGroupBytes(g: DiffGroup, listLimit: number): number {
  let b = 200 + g.path.length;
  b += Math.min(g.added.length, listLimit) * 24;
  b += Math.min(g.removed.length, listLimit) * 24;
  b += Math.min(g.valueChanges.length, listLimit) * 80;
  b += g.typeChanges.length * 60;
  return b;
}

export function planDiffBudget(
  groups: DiffGroup[],
  preambleBytes: number,
  maxBytes: number,
  leftFile: string,
  rightFile: string,
): DiffCompressPlan {
  const units: DiffCompressUnit[] = groups.map((g) => ({
    path: g.path,
    group: g,
    bytes: estimateGroupBytes(g, 200),
    weight: g.weight,
  }));
  const fullBytes = preambleBytes + units.reduce((s, u) => s + u.bytes, 0);
  if (fullBytes <= maxBytes) {
    return { fullBytes, maxBytes, overBudget: false, digestPaths: new Set(), leftFile, rightFile };
  }

  const ranked = [...units].sort((a, b) => b.weight - a.weight);
  const digest = new Set<string>();
  let bodyEst = units.reduce((s, u) => s + u.bytes, 0);
  const minDigest = Math.min(MIN_DIGEST_WHEN_OVER_BUDGET, ranked.length);

  const take = (u: DiffCompressUnit) => {
    if (digest.has(u.path)) return;
    bodyEst -= Math.max(0, u.bytes - DIGEST_OVERHEAD);
    digest.add(u.path);
  };

  for (const u of ranked) {
    const under = preambleBytes + bodyEst <= maxBytes;
    if (under && digest.size >= minDigest) break;
    if (!under || digest.size < minDigest) take(u);
  }
  for (const u of ranked) {
    if (preambleBytes + bodyEst <= maxBytes) break;
    take(u);
  }

  return { fullBytes, maxBytes, overBudget: digest.size > 0, digestPaths: digest, leftFile, rightFile };
}

export function formatDiffDigest(g: DiffGroup, plan: DiffCompressPlan): string {
  const sampleAdded = formatPlainList(g.added.slice(0, 8), 8);
  const sampleRemoved = formatPlainList(g.removed.slice(0, 8), 8);
  const drill = `json-analyze diff ${plan.leftFile} ${plan.rightFile} --path-prefix '${g.path}' -f md-flat`;
  const attrs = [
    `path="${g.path}"`,
    `added="${g.added.length}"`,
    `removed="${g.removed.length}"`,
    `valueChanges="${g.valueChanges.length}"`,
  ].join(" ");
  return `<diff-digest ${attrs}>
sampleAdded: ${sampleAdded || "—"}
sampleRemoved: ${sampleRemoved || "—"}
_drill:_ \`${drill}\`
</diff-digest>`;
}

function renderDiffGroupBody(g: DiffGroup, listLimit: number): string {
  const lines: string[] = [`<diff-group path="${g.path}" kind="${g.kind}">`];
  if (g.added.length) lines.push(`+ added (${g.added.length}): ${formatPlainList(g.added, listLimit)}`);
  if (g.removed.length) lines.push(`- removed (${g.removed.length}): ${formatPlainList(g.removed, listLimit)}`);
  for (const e of g.valueChanges.slice(0, listLimit)) {
    lines.push(`<diff-change path="${e.path}" left="${formatValue(e.left)}" right="${formatValue(e.right)}" />`);
  }
  for (const e of g.typeChanges.slice(0, 20)) {
    lines.push(`<diff-type path="${e.path}" left="${e.leftType}" right="${e.rightType}" />`);
  }
  lines.push("</diff-group>");
  return lines.join("\n");
}

export function renderDiffMarkdown(
  summary: DiffSummaryRow[],
  groups: DiffGroup[],
  opts: DiffFormatOptions,
  truncated: boolean,
): string {
  const maxBytes = opts.maxDetailBytes ?? DEFAULT_DETAIL_MAX_BYTES;
  const preamble: string[] = [
    `# json-analyze diff — ${opts.leftLabel} ↔ ${opts.rightLabel}`,
    "",
    "## 1. Snapshot",
    `- 文件: \`${opts.leftFile}\` ↔ \`${opts.rightFile}\``,
    `- scope: \`${opts.pathPrefix}\``,
    opts.ignoreNote ? `- 忽略: ${opts.ignoreNote}` : "",
    truncated ? "- 变更收集: **已截断**（提高 --max-changes）" : "",
    "",
    "## 2. Summary",
    "| metric | left | right | Δ |",
    "|--------|------|-------|---|",
    ...summary.map((r) => `| ${r.metric} | ${r.left} | ${r.right} | ${r.delta} |`),
    "",
  ].filter(Boolean);

  const preambleBytes = preamble.join("\n").length;
  const plan = planDiffBudget(groups, preambleBytes, maxBytes, opts.leftFile, opts.rightFile);

  if (plan.overBudget) {
    const kb = (plan.fullBytes / 1024).toFixed(0);
    const cap = (plan.maxBytes / 1024).toFixed(0);
    preamble.push(
      `估算详情约 **${kb}KB**，超过上限 **${cap}KB**；已将 **${plan.digestPaths.size}** 组压成 digest。`,
      "",
    );
  }

  const body: string[] = ["## 3. Changes by group", ""];
  const digestBlocks: string[] = [];

  for (const g of groups) {
    if (plan.digestPaths.has(g.path)) {
      digestBlocks.push(formatDiffDigest(g, plan));
      continue;
    }
    body.push(renderDiffGroupBody(g, 40));
    body.push("");
  }

  const out = [...preamble, ...body];
  if (digestBlocks.length) {
    out.push(
      "## Compressed diff groups (digest)",
      "",
      `以下 **${digestBlocks.length}** 组未展开明细，用 \`_drill_\` 缩小 scope 再 diff。`,
      "",
      digestBlocks.join("\n\n"),
      "",
    );
  }
  return out.join("\n");
}

export function renderDiffFlat(events: DiffEvent[]): string {
  return events
    .map((e) => {
      if (e.kind === "valueChanged") return `${e.path}\t${formatValue(e.left)}\t=>\t${formatValue(e.right)}`;
      if (e.kind === "typeChanged") return `${e.path}\ttype\t${e.leftType}\t=>\t${e.rightType}`;
      return `${e.path}\t${e.kind}\t${e.key ?? ""}`;
    })
    .join("\n");
}

export function buildDiffJSON(
  summary: DiffSummaryRow[],
  groups: DiffGroup[],
  labels: [string, string],
  pathPrefix: string,
  events: DiffEvent[],
  truncated: boolean,
): DiffJSONResult {
  return {
    labels,
    pathPrefix,
    summary,
    groups: groups.map((g) => ({
      path: g.path,
      added: g.added,
      removed: g.removed,
      valueChanges: g.valueChanges.map((e) => ({ path: e.path, left: e.left, right: e.right })),
      typeChanges: g.typeChanges.map((e) => ({ path: e.path, leftType: e.leftType, rightType: e.rightType })),
    })),
    truncated,
    totalEvents: events.length,
  };
}