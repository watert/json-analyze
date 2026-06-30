import minimist from "minimist";
import { aggregateAnalyzeJSONL } from "../jsonl.js";
import { runSummaryOnTargets } from "../multi-run.js";
import { printHelp } from "./help.js";
import { loadJSONLInput, outputResult, onErrorMode, resolveTargetsFromArgv } from "./shared.js";

export async function runSummary(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "root", "glob", "ext", "on-error"],
    boolean: ["help", "pretty", "jsonl", "no-recurse"],
    alias: { h: "help", f: "format" },
    default: { format: "md", "max-files": 100, "on-error": "skip" },
  });
  if (argv.help) {
    printHelp("summary");
    return;
  }
  const format = argv.format as string;
  if (!["md", "json"].includes(format)) throw new Error(`unknown format "${format}", expected "md"|"json"`);

  if (argv.jsonl) {
    const source = await loadJSONLInput(argv);
    const stats = await aggregateAnalyzeJSONL(source);
    if (format === "md") {
      console.log(`## Summary (JSONL aggregated)\n`);
      console.log(`- total lines: ${stats.totalLines}`);
      console.log(`- successful lines: ${stats.successfulLines}`);
      console.log(`- total nodes: ${stats.totalNodes}`);
      console.log(`- max depth: ${stats.maxDepth}`);
      console.log(`- arrays: ${stats.arraysCount} (${stats.emptyArrays} empty, ${stats.truncatedArrays} truncated)`);
      console.log(`- objects: ${stats.objectsCount} (${stats.truncatedObjects} truncated)`);
      console.log(`- mixed fields: ${stats.mixedFields}`);
      console.log(`- long-text fields: ${stats.longTextFields}`);
      const leafInfo = Object.entries(stats.leafTypes)
        .map(([k, v]) => `\`${k}\`(${v})`)
        .join(", ");
      if (leafInfo) console.log(`- leaf types: ${leafInfo}`);
    } else {
      outputResult(stats, "json", !!argv.pretty);
    }
    return;
  }

  const { targets } = await resolveTargetsFromArgv(argv);
  await runSummaryOnTargets(targets, onErrorMode(argv), format, !!argv.pretty);
}