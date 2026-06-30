// 多文件批处理: analyze / filter / search / summary
import { analyzeJSON } from "./analyzer.js";
import { filterJSON, searchJSON, type FilterOptions, type SearchOptions } from "./filter.js";
import { filterSchemaByPathPrefix } from "./analyze-detail-budget.js";
import { renderAnalyzeMarkdown, type AnalyzeMdFormat } from "./format.js";
import type { GroupedRenderOptions } from "./format-grouped.js";
import { readJsonFromTarget } from "./io.js";
import { isStdinTarget, type InputTarget } from "./input-resolve.js";
import { mergeAnalyzeSummaries } from "./batch-summary.js";
import { truncateForDisplay } from "./display-truncate.js";
import { compactSchema, summarizeSchema } from "./summarize.js";
import type { AnalyzeOptions } from "./types.js";

export type AnalyzeRenderOpts = GroupedRenderOptions & { pathPrefix?: string };

export async function forEachJsonFile(
  targets: InputTarget[],
  mode: "skip" | "fail",
  fn: (label: string, data: unknown) => void | Promise<void>
): Promise<string[]> {
  const errors: string[] = [];
  for (const t of targets) {
    try {
      const data = await readJsonFromTarget(t);
      const label = isStdinTarget(t) ? "stdin" : t.path;
      await fn(label, data);
    } catch (e: unknown) {
      const msg = `${t.path}: ${e instanceof Error ? e.message : String(e)}`;
      if (mode === "fail") throw new Error(msg);
      errors.push(msg);
      console.error(`skip: ${msg}`);
    }
  }
  return errors;
}

export async function runAnalyzeOnTargets(
  targets: InputTarget[],
  mode: "skip" | "fail",
  analyzeOpts: AnalyzeOptions,
  format: string,
  pretty: boolean,
  listKeysHandler?: (schema: ReturnType<typeof analyzeJSON>, label: string) => void,
  renderOpts?: AnalyzeRenderOpts
): Promise<void> {
  const multi = targets.length > 1;
  await forEachJsonFile(targets, mode, (label, data) => {
    const schema = analyzeJSON(data, analyzeOpts);
    const mdLike = format === "md" || format === "md-flat";
    if (multi && mdLike) console.log(`## ${label}\n`);
    if (listKeysHandler) {
      listKeysHandler(schema, label);
      return;
    }
    if (mdLike) {
      if (renderOpts?.pathPrefix) {
        console.log(renderAnalyzeMarkdown(filterSchemaByPathPrefix(schema, renderOpts.pathPrefix), "md-flat"));
        return;
      }
      if (format === "md-flat") {
        console.log(renderAnalyzeMarkdown(schema, "md-flat"));
        return;
      }
      const opts: GroupedRenderOptions = {
        top: renderOpts?.top ?? 10,
        sourceLabel: renderOpts?.sourceLabel ?? label,
        drillFile: renderOpts?.drillFile ?? label,
        maxDetailBytes: renderOpts?.maxDetailBytes,
      };
      console.log(renderAnalyzeMarkdown(schema, "md", opts));
    } else console.log(JSON.stringify(multi ? { file: label, schema } : schema, null, pretty ? 2 : 0));
    if (multi && mdLike) console.log("");
  });
}

export async function runFilterOnTargets(
  targets: InputTarget[],
  mode: "skip" | "fail",
  filterOpts: FilterOptions,
  format: string,
  pretty: boolean
): Promise<number> {
  let totalHits = 0;
  const multi = targets.length > 1;
  await forEachJsonFile(targets, mode, (label, data) => {
    const result = filterJSON(data, filterOpts);
    for (let i = 0; i < result.matches.length; i++) {
      totalHits++;
      const m = result.matches[i];
      const p = result.paths[i];
      if (format === "md") {
        const body = pretty ? JSON.stringify(m, null, 2) : JSON.stringify(m);
        const head = multi ? `### ${label} @ ${p}\n\n` : `### match @ ${p}\n\n`;
        console.log(`${head}\`\`\`json\n${body}\n\`\`\`\n`);
      } else {
        console.log(JSON.stringify({ file: multi ? label : undefined, path: p, match: m }));
      }
    }
  });
  return totalHits;
}

export async function runSearchOnTargets(
  targets: InputTarget[],
  mode: "skip" | "fail",
  searchOpts: SearchOptions,
  format: string
): Promise<number> {
  let totalHits = 0;
  const multi = targets.length > 1;
  await forEachJsonFile(targets, mode, (label, data) => {
    const result = searchJSON(data, searchOpts);
    for (const m of result.matches) {
      totalHits++;
      if (format === "md") {
        const val =
          m.value !== undefined
            ? ` = \`${typeof m.value === "object" ? JSON.stringify(m.value) : String(m.value)}\``
            : "";
        const prefix = multi ? `${label}: ` : "";
        console.log(`- ${prefix}\`${m.path}\` (key=${m.key ?? "-"})${val}`);
      } else {
        console.log(JSON.stringify({ file: multi ? label : undefined, ...m }));
      }
    }
  });
  return totalHits;
}

export async function runSummaryOnTargets(
  targets: InputTarget[],
  mode: "skip" | "fail",
  format: string,
  pretty: boolean
): Promise<void> {
  const summaries: ReturnType<typeof summarizeSchema>[] = [];
  const compacts: string[] = [];
  await forEachJsonFile(targets, mode, (label, data) => {
    const schema = analyzeJSON(data);
    summaries.push(summarizeSchema(schema));
    const c = truncateForDisplay(compactSchema(schema)); compacts.push(targets.length > 1 ? `${label}: ${c}` : c);
  });
  const summary = mergeAnalyzeSummaries(summaries);
  const singleCompact = compacts[0] ?? "";

  if (format === "md") {
    if (targets.length > 1) {
      console.log(`## Structure (per file)\n\n${compacts.map((c) => `- ${c}`).join("\n")}\n`);
      console.log(`## Summary (aggregated ${summaries.length} files)\n`);
    } else {
      console.log(`## Structure\n\n\`${truncateForDisplay(singleCompact)}\`\n`);
      console.log(`## Summary\n`);
    }
    console.log(`- total nodes: ${summary.totalNodes}`);
    console.log(`- max depth: ${summary.maxDepth}`);
    console.log(`- arrays: ${summary.arraysCount} (${summary.emptyArrays} empty, ${summary.truncatedArrays} truncated)`);
    console.log(`- objects: ${summary.objectsCount} (${summary.truncatedObjects} truncated)`);
    console.log(`- mixed fields: ${summary.mixedFields}`);
    console.log(`- long-text fields: ${summary.longTextFields}`);
    const leafInfo = Object.entries(summary.leafTypes)
      .map(([k, v]) => `\`${k}\`(${v})`)
      .join(", ");
    if (leafInfo) console.log(`- leaf types: ${leafInfo}`);
  } else {
    outputResultJson({ compact: singleCompact, summary, files: summaries.length }, pretty);
  }
}

function outputResultJson(payload: unknown, pretty: boolean) {
  console.log(JSON.stringify(payload, null, pretty ? 2 : 0));
}