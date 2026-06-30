// 默认 Overview 报告: 多 section + drill-down 命令提示
import { splitPath } from "./path-utils.js";
import type { FlatSchemaItem, AnalyzeSummary } from "./types.js";
import { summarizeSchema, compactSchema } from "./summarize.js";
import { truncateForDisplay } from "./display-truncate.js";

export interface OverviewInputMeta {
  sourceLabel: string;
  rootType: string;
  analyzeOpts: { maxDepth: number; maxArrayItems: number; maxKeysPerObject: number };
}

export interface OverviewOptions {
  fileArg?: string;
  meta: OverviewInputMeta;
  schema: FlatSchemaItem[];
  summary: AnalyzeSummary;
}

const FILE_PLACEHOLDER = "<file>";

function fileToken(fileArg?: string): string {
  return fileArg ?? FILE_PLACEHOLDER;
}

function drill(line: string): string {
  return `\n> 展开: ${line}\n`;
}

/** 从 schema 挑选热点 path */
export function pickHotspots(schema: FlatSchemaItem[], limit = 8): FlatSchemaItem[] {
  const scored = schema
    .filter((item) => item.path !== "root")
    .map((item) => {
      let score = 0;
      if (item.type === "mixed") score += 100;
      if (item.type === "circular") score += 90;
      if (item.comment?.startsWith("truncated")) score += 80;
      if (item.type === "long-text" || item.longText) score += 60;
      if (item.type === "array" && item.comment === "empty array") score += 40;
      if (item.type === "object" && item.keys && item.keys.length >= 20) score += 50 + Math.min(item.keys.length, 200);
      if (item.type === "array" && item.itemTypes) {
        const total = item.itemTypes.reduce((s, it) => s + it.count, 0);
        score += 30 + Math.min(total, 500);
      }
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));

  const out: FlatSchemaItem[] = [];
  const seen = new Set<string>();
  for (const { item } of scored) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** 低 presence / optional 字段 */
export function pickOptionalFields(schema: FlatSchemaItem[], limit = 6): FlatSchemaItem[] {
  return schema
    .filter((item) => item.note?.includes("(optional)"))
    .sort((a, b) => (a.presence ?? 0) - (b.presence ?? 0))
    .slice(0, limit);
}

/** 浅层 dict-key 对象 (高 key 数) */
export function pickDictKeyObjects(schema: FlatSchemaItem[], limit = 2): FlatSchemaItem[] {
  return schema
    .filter((item) => {
      if (item.type !== "object" || !item.keys || item.keys.length < 8) return false;
      const depth = splitPath(item.path).length;
      return depth <= 4;
    })
    .sort((a, b) => (b.keys?.length ?? 0) - (a.keys?.length ?? 0))
    .slice(0, limit);
}

function hotspotLine(item: FlatSchemaItem): string {
  const parts: string[] = [`\`${item.path}\``];
  if (item.type === "mixed" && item.variants?.length) {
    parts.push(`mixed (${item.variants.map((v) => v.type).join("|")})`);
  } else if (item.type === "record" && item.keysCount) {
    parts.push(`record ${item.keysCount} keys`);
  } else if (item.type === "object" && item.keys) {
    parts.push(`${item.keys.length} keys`);
  } else if (item.type === "array" && item.itemTypes) {
    const n = item.itemTypes.reduce((s, it) => s + it.count, 0);
    parts.push(`array ~${n} items`);
  } else {
    parts.push(item.type);
  }
  if (item.comment) parts.push(`— ${item.comment}`);
  if (item.note) parts.push(`(${item.note})`);
  return `- ${parts.join(" ")}`;
}

/** 生成 2～3 条建议 drill path */
export function suggestQuickPaths(schema: FlatSchemaItem[]): string[] {
  const paths: string[] = [];
  const arrays = schema
    .filter((item) => item.type === "array" && item.itemTypes && item.itemTypes.length > 0)
    .map((item) => ({
      item,
      total: item.itemTypes!.reduce((s, it) => s + it.count, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const topArray = arrays[0]?.item;
  if (topArray) {
    const child = schema.find(
      (it) =>
        it.path.startsWith(topArray.path.replace(/\[\]$/, "") || topArray.path) &&
        it.path.includes("[]") &&
        (it.type === "string" || it.type === "number" || it.type === "object")
    );
    if (child && child.path !== topArray.path) paths.push(child.path);
    else paths.push(topArray.path.endsWith("[]") ? topArray.path : `${topArray.path}[]`);
  }

  const scalar = schema.find(
    (it) =>
      it.path !== "root" &&
      !["object", "array", "mixed", "circular"].includes(it.type) &&
      splitPath(it.path).length <= 5
  );
  if (scalar && !paths.includes(scalar.path)) paths.push(scalar.path);

  const bigObj = schema.find((it) => it.type === "object" && it.keys && it.keys.length >= 5);
  if (bigObj && !paths.includes(bigObj.path)) paths.push(bigObj.path);

  return paths.slice(0, 3);
}

function formatHotspotSection(schema: FlatSchemaItem[]): string {
  const lines = pickHotspots(schema).map(hotspotLine);
  return lines.length ? lines.join("\n") : "- (无显著热点，结构较规整)";
}

/** 渲染 Markdown overview */
export function renderOverviewMarkdown(opts: OverviewOptions): string {
  const { fileArg, meta, schema, summary } = opts;
  const f = fileToken(fileArg);
  const compact = truncateForDisplay(compactSchema(schema));
  const truncFlags =
    summary.truncatedArrays + summary.truncatedObjects > 0
      ? `是 (${summary.truncatedArrays} 数组 / ${summary.truncatedObjects} 对象节点被采样截断)`
      : "否";

  const sections: string[] = [];
  sections.push(`# json-analyze overview — ${meta.sourceLabel}\n`);

  // §1 Snapshot
  sections.push(`## 1. Snapshot`);
  sections.push(`- 根类型: \`${meta.rootType}\``);
  sections.push(`- schema 节点数: ${summary.totalNodes}，最大深度: ${summary.maxDepth}`);
  sections.push(
    `- 规模护栏: max-depth=${meta.analyzeOpts.maxDepth}, max-items=${meta.analyzeOpts.maxArrayItems}, max-keys=${meta.analyzeOpts.maxKeysPerObject}`
  );
  sections.push(`- 分析截断: ${truncFlags}`);
  sections.push(
    drill(
      `\`json-analyze summary ${f}\` · 调护栏 \`json-analyze analyze ${f} --max-depth 16 --max-items 1000\``
    )
  );

  // §2 Structure
  sections.push(`## 2. Structure (提炼)`);
  sections.push("```");
  sections.push(compact);
  sections.push("```");
  sections.push("");
  sections.push("**热点路径**");
  sections.push(formatHotspotSection(schema));

  const dictObjs = pickDictKeyObjects(schema);
  if (dictObjs.length > 0) {
    sections.push("");
    sections.push("**dict-key 对象**");
    for (const obj of dictObjs) {
      if (obj.type === "record") {
        const sample = (obj.sampleKeys ?? []).slice(0, 3).map((k) => `\`${k}\``).join(", ");
        sections.push(`- \`${obj.path}\` — record ${obj.keysCount ?? 0} keys (例: ${sample})`);
      } else {
        const sample = obj.keys!.slice(0, 3).map((k) => `\`${k}\``).join(", ");
        const more = obj.keys!.length > 3 ? ` … +${obj.keys!.length - 3}` : "";
        sections.push(`- \`${obj.path}\` — ${obj.keys!.length} keys (例: ${sample}${more})`);
      }
    }
  }
  sections.push(
    drill(
      `\`json-analyze analyze ${f}\` 全量 flat schema · \`json-analyze analyze ${f} --list-keys\` · \`json-analyze explore root ${f} --keys\``
    )
  );

  // §3 Data quality
  sections.push(`## 3. Data quality`);
  const mixed = schema.filter((it) => it.type === "mixed").slice(0, 5);
  if (mixed.length) {
    sections.push(`- mixed 字段: ${mixed.map((it) => `\`${it.path}\``).join(", ")}${summary.mixedFields > 5 ? ` …共 ${summary.mixedFields}` : ""}`);
  } else {
    sections.push("- mixed 字段: 无");
  }
  const optional = pickOptionalFields(schema);
  if (optional.length) {
    sections.push(`- 可选字段嫌疑 (低 presence):`);
    for (const it of optional) sections.push(`  - \`${it.path}\` — ${it.note}`);
  } else {
    sections.push("- 可选字段嫌疑: 无");
  }
  sections.push(`- 空数组: ${summary.emptyArrays} · long-text 字段: ${summary.longTextFields}`);
  sections.push(drill(`\`json-analyze explore '<path>' ${f}\` · \`json-analyze explore '<path>' ${f} --cardinality\``));

  // §4 Quick paths
  sections.push(`## 4. Quick paths`);
  const quick = suggestQuickPaths(schema);
  if (quick.length === 0) {
    sections.push("- (暂无自动建议，请用 search/filter)");
  } else {
    for (const p of quick) {
      sections.push(`- \`${p}\``);
      sections.push(`  - \`json-analyze get '${p}' ${f} --limit 10\``);
      sections.push(`  - \`json-analyze explore '${p}' ${f}\``);
    }
  }
  sections.push(drill(`\`json-analyze get '<path>' ${f}\``));

  // §5 Search & filter
  sections.push(`## 5. Search & filter`);
  sections.push("- 不确定键在哪一层时用 `search` 递归 grep；知道字段条件时用 `filter`。");
  sections.push(`- 例: \`json-analyze search deepseek ${f}\` · \`json-analyze filter ${f} id=foo\` · \`json-analyze filter ${f} --key-match pattern\``);
  sections.push(drill(`\`json-analyze search <pattern> ${f}\` · \`json-analyze filter ${f} key=value\``));

  // §6 Compare
  sections.push(`## 6. Compare`);
  if (dictObjs.length >= 1 && dictObjs[0].type === "record" && (dictObjs[0].sampleKeys?.length ?? 0) >= 2) {
    const k0 = dictObjs[0].sampleKeys![0];
    const k1 = dictObjs[0].sampleKeys![1];
    const p0 = `${dictObjs[0].path}.${k0}`;
    const p1 = `${dictObjs[0].path}.${k1}`;
    sections.push(`- 检测到并列 dict-key，可对比两条路径，例如:`);
    sections.push(`  \`json-analyze compare '${p0}' '${p1}' ${f} --fields 'id,name'\``);
  } else {
    sections.push("- 多实体并列时用 `compare` 拉表格:");
    sections.push(`  \`json-analyze compare 'path1' 'path2' ${f}\``);
  }
  sections.push(drill(`\`json-analyze compare <path1> <path2> ${f} --fields 'a,b'\``));

  return sections.join("\n");
}

export interface OverviewJSON {
  meta: OverviewInputMeta;
  compact: string;
  summary: AnalyzeSummary;
  hotspots: Array<{ path: string; type: string; hint?: string }>;
  optionalFields: Array<{ path: string; note?: string }>;
  quickPaths: string[];
  drillDown: Record<string, string[]>;
}

/** JSON 形态 overview (供 --format json) */
export function buildOverviewJSON(opts: OverviewOptions): OverviewJSON {
  const { meta, schema, summary } = opts;
  const f = fileToken(opts.fileArg);
  return {
    meta,
    compact: compactSchema(schema),
    summary,
    hotspots: pickHotspots(schema).map((it) => ({
      path: it.path,
      type: it.type,
      hint: it.comment ?? it.note,
    })),
    optionalFields: pickOptionalFields(schema).map((it) => ({ path: it.path, note: it.note })),
    quickPaths: suggestQuickPaths(schema),
    drillDown: {
      snapshot: [`json-analyze summary ${f}`, `json-analyze analyze ${f}`],
      structure: [`json-analyze analyze ${f}`, `json-analyze analyze ${f} --list-keys`],
      quality: [`json-analyze explore '<path>' ${f}`],
      query: [`json-analyze search <pattern> ${f}`, `json-analyze filter ${f} key=value`],
      compare: [`json-analyze compare <path1> <path2> ${f}`],
    },
  };
}

/** 多文件时每文件短报告 */
export function renderOverviewBriefMarkdown(opts: OverviewOptions): string {
  const { meta, schema, summary } = opts;
  const compact = truncateForDisplay(compactSchema(schema));
  const hot = pickHotspots(schema, 3).map(hotspotLine).join("\n");
  const lines = [
    `### ${meta.sourceLabel}`,
    `- 根: \`${meta.rootType}\` · 节点 ${summary.totalNodes} · 深度 ${summary.maxDepth}`,
    "```",
    compact,
    "```",
  ];
  if (hot) lines.push(hot);
  return lines.join("\n");
}

export function renderBatchOverviewFooter(
  fileCount: number,
  errors: string[],
  omitted: number,
  merged?: { mixedFields: number; maxDepth: number }
): string {
  const parts = [`## Batch`, `- 已处理文件: ${fileCount}`];
  if (omitted > 0) parts.push(`- 因 --max-files 省略: ${omitted}`);
  if (errors.length) {
    parts.push(`- 解析失败 (已 skip): ${errors.length}`);
    for (const e of errors.slice(0, 5)) parts.push(`  - ${e}`);
    if (errors.length > 5) parts.push(`  - … +${errors.length - 5}`);
  }
  if (merged) {
    parts.push(`- 聚合: max depth ${merged.maxDepth}, mixed 合计 ${merged.mixedFields}`);
  }
  parts.push(
    drill(`\`json-analyze filter <dir> key=value\` · \`json-analyze search <pat> <dir>\``)
  );
  return parts.join("\n");
}