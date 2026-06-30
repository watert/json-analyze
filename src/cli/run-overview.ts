// 默认 overview 子命令
import minimist from "minimist";
import { analyzeJSON } from "../analyzer.js";
import { summarizeSchema } from "../summarize.js";
import {
  renderOverviewMarkdown,
  buildOverviewJSON,
  renderOverviewBriefMarkdown,
  renderBatchOverviewFooter,
} from "../overview.js";
import { readJsonFromTarget } from "../io.js";
import { mergeAnalyzeSummaries } from "../batch-summary.js";
import { forEachJsonFile } from "../multi-run.js";
import { aggregateAnalyzeJSONL } from "../jsonl.js";
import { isStdinTarget } from "../input-resolve.js";
import { printHelp } from "./help.js";
import {
  loadJSONLInput,
  outputResult,
  rootTypeOf,
  drillLine,
  onErrorMode,
  resolveTargetsFromArgv,
} from "./shared.js";

export async function runOverview(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "root", "glob", "ext", "on-error"],
    boolean: ["help", "pretty", "jsonl", "no-recurse"],
    alias: { h: "help", f: "format", p: "pretty" },
    default: {
      format: "md",
      "max-depth": 32,
      "max-items": 5000,
      "max-keys": 500,
      "max-files": 100,
      "on-error": "skip",
    },
  });
  if (argv.help) {
    printHelp("help");
    return;
  }
  const format = argv.format as string;
  if (!["md", "json"].includes(format)) throw new Error(`unknown format "${format}", expected "md"|"json"`);
  const analyzeOpts = {
    maxDepth: Number(argv["max-depth"]) || 32,
    maxArrayItems: Number(argv["max-items"]) || 5000,
    maxKeysPerObject: Number(argv["max-keys"]) || 500,
  };
  const fileArg = argv._[0] as string | undefined;

  if (argv.jsonl) {
    const source = await loadJSONLInput(argv);
    const stats = await aggregateAnalyzeJSONL(source);
    const label = fileArg ?? "stdin (JSONL)";
    const f = fileArg ?? "<file>";
    if (format === "md") {
      console.log(`# json-analyze overview — ${label}\n`);
      console.log(`## 1. Snapshot (JSONL 聚合)`);
      console.log(`- 总行数: ${stats.totalLines}，成功解析: ${stats.successfulLines}`);
      console.log(`- 节点数: ${stats.totalNodes}，最大深度: ${stats.maxDepth}`);
      console.log(drillLine(`json-analyze summary ${f} --jsonl`, `json-analyze analyze ${f} --jsonl`));
      console.log(`\n## 2. Structure\n`);
      console.log(`- arrays: ${stats.arraysCount} (${stats.emptyArrays} empty)`);
      console.log(`- objects: ${stats.objectsCount}`);
      console.log(`- mixed: ${stats.mixedFields} · long-text: ${stats.longTextFields}`);
      console.log(drillLine(`json-analyze analyze ${f} --jsonl`, `json-analyze filter ${f} --jsonl key=value`));
    } else {
      outputResult({ mode: "jsonl-overview", stats, drillDown: ["analyze --jsonl", "summary --jsonl"] }, "json", !!argv.pretty);
    }
    return;
  }

  const { targets, omitted } = await resolveTargetsFromArgv(argv);
  const mode = onErrorMode(argv);

  const runOne = (label: string, data: unknown, fileArg?: string) => {
    const schema = analyzeJSON(data, analyzeOpts);
    const summary = summarizeSchema(schema);
    return {
      fileArg,
      meta: { sourceLabel: label, rootType: rootTypeOf(data), analyzeOpts },
      schema,
      summary,
    };
  };

  if (targets.length === 1) {
    const data = await readJsonFromTarget(targets[0]);
    const overviewOpts = runOne(
      isStdinTarget(targets[0]) ? "stdin" : targets[0].path,
      data,
      targets[0].kind === "file" ? targets[0].path : undefined
    );
    if (format === "md") console.log(renderOverviewMarkdown(overviewOpts));
    else outputResult(buildOverviewJSON(overviewOpts), "json", !!argv.pretty);
    return;
  }

  const summaries: ReturnType<typeof summarizeSchema>[] = [];
  const jsonFiles: ReturnType<typeof buildOverviewJSON>[] = [];
  const errors = await forEachJsonFile(targets, mode, (label, data) => {
    const o = runOne(label, data, label);
    summaries.push(o.summary);
    if (format === "md") {
      console.log(renderOverviewBriefMarkdown(o));
      console.log("");
    } else {
      jsonFiles.push(buildOverviewJSON(o));
    }
  });

  const merged = mergeAnalyzeSummaries(summaries);
  if (format === "md") {
    console.log(renderBatchOverviewFooter(summaries.length, errors, omitted, merged));
  } else {
    outputResult({ files: jsonFiles, batch: { merged, errors, omitted } }, "json", !!argv.pretty);
  }
}