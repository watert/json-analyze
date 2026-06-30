// 大组压缩: object/record 组 → keyNames digest + drill（非 flat 截断）
import { getParent } from "./path-utils.js";
import type { FlatSchemaItem } from "./types.js";
import { scorePathWeight } from "./analyze-preamble.js";
import { formatPlainList } from "./format.js";
import { estimateNestedGroupBytes } from "./format-nested-md.js";

export interface CompressUnit {
  path: string;
  node: FlatSchemaItem;
  kind: "record" | "object";
  keyNames: string[];
  bytes: number;
  weight: number;
}

const DIGEST_OVERHEAD = 380;
/** 超预算时至少压成 digest 的大组条数 */
export const MIN_DIGEST_WHEN_OVER_BUDGET = 5;

export function recordFieldKeyNames(recordPath: string, kids: FlatSchemaItem[]): string[] {
  const prefix = `${recordPath}[].`;
  return kids.map((c) => {
    if (c.path.startsWith(prefix)) return c.path.slice(prefix.length).replace(/\[\]/g, "");
    return (c.path.split(".").pop() ?? c.path).replace(/\[\]/g, "");
  });
}

/** 扁平 path 按 root 下第一段聚成 object 大组 */
export function clusterFlatPaths(items: FlatSchemaItem[], schema: FlatSchemaItem[]): CompressUnit[] {
  const bySeg = new Map<string, FlatSchemaItem[]>();
  for (const it of items) {
    if (it.path === "root") continue;
    const segs = it.path.replace(/^root\.?/, "").split(".");
    const top = segs[0]?.replace(/\[\]/g, "") ?? "";
    if (!top) continue;
    const groupPath = `root.${top}`;
    const arr = bySeg.get(groupPath) ?? [];
    arr.push(it);
    bySeg.set(groupPath, arr);
  }

  const units: CompressUnit[] = [];
  for (const [groupPath, paths] of bySeg) {
    const node = schema.find((s) => s.path === groupPath);
    const keyNames =
      node?.type === "object" && node.keys?.length
        ? node.keys
        : [...new Set(paths.map((p) => p.path.replace(/^root\.[^.]+\.?/, "").split(".")[0]?.replace(/\[\]/g, "") ?? "").filter(Boolean))];
    const bytes = estimateNestedGroupBytes(groupPath, paths);
    const weight = node ? scorePathWeight(node, schema) : paths.length * 5;
    if (paths.length < 3 && bytes < 2000) continue;
    units.push({
      path: groupPath,
      node: node ?? { path: groupPath, type: "object", keys: keyNames },
      kind: "object",
      keyNames,
      bytes,
      weight: weight + bytes / 50,
    });
  }
  return units.sort((a, b) => b.weight - a.weight);
}

const DIGEST_TAG = "record-digest";

export function formatGroupDigest(unit: CompressUnit, drillFile: string): string {
  const attrs = [`path="${unit.path}"`];
  if (unit.node.keysCount != null) attrs.push(`keyCount="${unit.node.keysCount}"`);
  if (unit.node.recordOverlap != null) attrs.push(`overlap="${(unit.node.recordOverlap * 100).toFixed(0)}%"`);
  const keysLine = unit.keyNames.length > 0 ? `keyNames: ${formatPlainList(unit.keyNames, 40)}` : "";
  const drill = `json-analyze analyze ${drillFile} --path-prefix '${unit.path}' -f md-flat`;
  const inner = [keysLine, `_drill:_ ${drill}`].filter(Boolean).join("\n");
  return `<${DIGEST_TAG} ${attrs.join(" ")}>\n${inner}\n</${DIGEST_TAG}>`;
}

/** 正文之后：标题 + 说明 + 全部 record-digest */
export function renderDigestFooter(plan: GroupCompressPlan, digestUnits: CompressUnit[]): string {
  if (!plan.overBudget || digestUnits.length === 0) return "";
  const kb = (plan.fullBytes / 1024).toFixed(0);
  const cap = (plan.maxBytes / 1024).toFixed(0);
  const blocks = digestUnits.map((u) => formatGroupDigest(u, plan.drillFile)).join("\n\n");
  const n = digestUnits.length;
  const lines = [
    "## Compressed groups (digest)",
    "",
    `以下 **${n}** 个大组因详情体积（约 ${kb}KB）超过输出上限（${cap}KB），未在正文展开字段级 schema，仅保留 **keyNames**。需要 sample、presence 时用各块内 \`_drill_\` 执行 \`--path-prefix <path> -f md-flat\`。`,
    "",
    blocks,
    "",
  ];
  return lines.join("\n");
}

export interface GroupCompressPlan {
  fullBytes: number;
  maxBytes: number;
  overBudget: boolean;
  digestPaths: Set<string>;
  drillFile: string;
}

/** 按 weight 把大组改为 digest，直到估算 ≤ maxBytes；超预算时至少 MIN 条 digest */
export function planGroupCompression(units: CompressUnit[], preambleBytes: number, maxBytes: number, drillFile: string): GroupCompressPlan {
  const fullBytes = preambleBytes + units.reduce((s, u) => s + u.bytes, 0);
  if (fullBytes <= maxBytes) {
    return { fullBytes, maxBytes, overBudget: false, digestPaths: new Set(), drillFile };
  }

  const ranked = [...units].sort((a, b) => b.weight - a.weight);
  const digest = new Set<string>();
  let bodyEst = units.reduce((s, u) => s + u.bytes, 0);
  const minDigest = Math.min(MIN_DIGEST_WHEN_OVER_BUDGET, ranked.length);

  const take = (u: CompressUnit) => {
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

  return {
    fullBytes,
    maxBytes,
    overBudget: digest.size > 0,
    digestPaths: digest,
    drillFile,
  };
}

export function renderGroupBudgetNote(plan: GroupCompressPlan, digestCount: number): string {
  if (!plan.overBudget) return "";
  const kb = (plan.fullBytes / 1024).toFixed(0);
  const cap = (plan.maxBytes / 1024).toFixed(0);
  return `- **detail budget**: ~${kb}KB → cap **${cap}KB**; **${digestCount}** group(s) compressed (keyNames + _drill_)\n`;
}