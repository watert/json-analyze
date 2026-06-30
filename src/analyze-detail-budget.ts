// 详情区体积: 超预算 digest record，仍超则截断 flat
import type { FlatSchemaItem } from "./types.js";
import { scorePathWeight } from "./analyze-preamble.js";
import { buildDetailLine, buildExtraLine } from "./format.js";

/** 默认总输出约 50KB（含 summary） */
export const DEFAULT_DETAIL_MAX_BYTES = 50 * 1024;

export interface DetailBudgetOptions {
  maxDetailBytes?: number;
  drillFile?: string;
}

export interface DetailBudgetPlan {
  fullBytes: number;
  maxBytes: number;
  overBudget: boolean;
  digestRecordPaths: Set<string>;
  drillFile: string;
  /** flat 区允许的最大字节（digest 后由 render 截断） */
  maxFlatBytes: number;
}

export function formatRecordDigest(path: string, parent: FlatSchemaItem, drillFile: string): string {
  const attrs = [`path="${path}"`, `digest="true"`];
  if (parent.keysCount != null) attrs.push(`keyCount="${parent.keysCount}"`);
  if (parent.recordOverlap != null) attrs.push(`overlap="${(parent.recordOverlap * 100).toFixed(0)}%"`);
  const meta = [buildDetailLine(parent), buildExtraLine(parent)].filter(Boolean).join("\n");
  const drill = `json-analyze analyze ${drillFile} --path-prefix '${path}' -f md-flat`;
  return `<record ${attrs.join(" ")}>\n${meta}\n_drill:_ \`${drill}\`\n</record>`;
}

export function filterSchemaByPathPrefix(schema: FlatSchemaItem[], prefix: string): FlatSchemaItem[] {
  const base = prefix.replace(/\[\]$/, "");
  return schema.filter((it) => {
    if (it.path === base || it.path === prefix) return true;
    return it.path.startsWith(base + ".") || it.path.startsWith(base + "[].");
  });
}

const DIGEST_BYTES = 320;

export function planDetailBudget(
  recordPaths: string[],
  schema: FlatSchemaItem[],
  blockBytes: Map<string, number>,
  preambleBytes: number,
  flatRestBytes: number,
  maxBytes: number,
  drillFile: string
): DetailBudgetPlan {
  const fullBytes = preambleBytes + [...blockBytes.values()].reduce((a, b) => a + b, 0) + flatRestBytes;
  if (fullBytes <= maxBytes) {
    return {
      fullBytes,
      maxBytes,
      overBudget: false,
      digestRecordPaths: new Set(),
      drillFile,
      maxFlatBytes: flatRestBytes,
    };
  }

  const ranked = recordPaths
    .map((path) => ({
      path,
      weight: scorePathWeight(schema.find((s) => s.path === path)!, schema),
      bytes: blockBytes.get(path) ?? 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  const digest = new Set<string>();
  let recordEst = [...blockBytes.values()].reduce((a, b) => a + b, 0);

  for (const r of ranked) {
    recordEst -= Math.max(0, r.bytes - DIGEST_BYTES);
    digest.add(r.path);
    const bodyEst = recordEst + flatRestBytes;
    if (preambleBytes + bodyEst <= maxBytes) break;
  }

  const recordAfter = [...blockBytes.entries()].reduce((sum, [p, b]) => {
    return sum + (digest.has(p) ? DIGEST_BYTES : b);
  }, 0);
  let maxFlatBytes = Math.max(0, maxBytes - preambleBytes - recordAfter - 400);

  return {
    fullBytes,
    maxBytes,
    overBudget: true,
    digestRecordPaths: digest,
    drillFile,
    maxFlatBytes,
  };
}

export function truncateFlatMarkdown(flat: string, maxBytes: number, drillFile: string): string {
  const enc = new TextEncoder();
  if (enc.encode(flat).length <= maxBytes) return flat;
  const blocks = flat.split("\n\n");
  const out: string[] = [];
  let used = 0;
  for (const b of blocks) {
    const n = enc.encode(b).length + (out.length ? 2 : 0);
    if (used + n > maxBytes - 120) break;
    out.push(b);
    used += n;
  }
  const omitted = blocks.length - out.length;
  const drill = `json-analyze analyze ${drillFile} -f md-flat`;
  out.push(`_… ${omitted} path block(s) omitted (flat budget); full:_ \`${drill}\``);
  return out.join("\n\n");
}

export function renderBudgetNote(plan: DetailBudgetPlan): string {
  if (!plan.overBudget) return "";
  const kb = (plan.fullBytes / 1024).toFixed(0);
  const cap = (plan.maxBytes / 1024).toFixed(0);
  return `- **detail budget**: ~${kb}KB raw → cap **${cap}KB** (${plan.digestRecordPaths.size} record digest, flat truncated if needed)\n`;
}