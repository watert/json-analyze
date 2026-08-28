// analyze 子命令
import minimist from "minimist";
import { analyzeJSON } from "../analyzer.js";
import { renderAnalyzeMarkdown } from "../format.js";
import { renderTreeMarkdown } from "../format-tree.js";
import { globToRegex } from "../filter.js";
import { splitPath } from "../path-utils.js";
import { readJsonFromTarget } from "../io.js";
import { runAnalyzeOnTargets } from "../multi-run.js";
import {
  analyzeJSONL,
  collectJSONLForMergedAnalyze,
  DEFAULT_JSONL_MERGE_MAX_LINES,
} from "../jsonl.js";
import { printHelp } from "./help.js";
import {
  loadJSONLInput,
  outputResult,
  onErrorMode,
  resolveTargetsFromArgv,
} from "./shared.js";

export async function runAnalyze(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "path-glob", "path-prefix", "root", "glob", "ext", "on-error"],
    boolean: ["help", "pretty", "list-keys", "fold", "jsonl", "per-line", "no-recurse"],
    alias: { h: "help", f: "format", p: "pretty" },
    default: {
      format: "md",
      "max-depth": 32,
      "max-items": 5000,
      "max-keys": 500,
      "key-depth": 1,
      "max-files": 100,
      "on-error": "skip",
      "top-summary": 10,
      "max-detail-bytes": 51200,
      "max-lines": DEFAULT_JSONL_MERGE_MAX_LINES,
    },
  });
  if (argv.help) {
    printHelp("analyze");
    return;
  }
  const format = argv.format as string;
  const analyzeFormats = ["md", "md-flat", "tree", "xml", "json"];
  if (!analyzeFormats.includes(format)) throw new Error(`unknown format "${format}", expected ${analyzeFormats.join("|")}`);
  const mdOut = format !== "json";
  // tree / xml: 两层级语义 tag 输出（format-tree.ts），xml 为 tree 的同义别名
  const treeLike = format === "tree" || format === "xml";
  const analyzeOpts = {
    maxDepth: Number(argv["max-depth"]) || 32,
    maxArrayItems: Number(argv["max-items"]) || 5000,
    maxKeysPerObject: Number(argv["max-keys"]) || 500,
  };

  if (argv.jsonl) {
    const source = await loadJSONLInput(argv);
    if (argv["per-line"]) {
      for await (const { line, result: schema } of analyzeJSONL(source, analyzeOpts)) {
        if (format === "md" || treeLike) {
          console.log(`### line ${line}\n`);
          if (treeLike) console.log(renderTreeMarkdown(schema));
          else console.log(renderAnalyzeMarkdown(schema, format as "md" | "md-flat"));
          console.log("");
        } else {
          console.log(JSON.stringify({ line, schema }));
        }
      }
      return;
    }
    const maxLines = Number(argv["max-lines"]) || DEFAULT_JSONL_MERGE_MAX_LINES;
    const { items, totalLines } = await collectJSONLForMergedAnalyze(source, { maxLines });
    if (items.length === 0) {
      console.error("empty JSONL");
      process.exitCode = 2;
      return;
    }
    if (totalLines > 10_000) {
      console.error(
        `warn: JSONL merge loaded ${totalLines} lines into memory (cap ${maxLines}). Use --per-line for streaming.`
      );
    }
    const schema = analyzeJSON(items, analyzeOpts);
    if (mdOut) {
      console.log(`> JSONL: ${totalLines} lines treated as one array of items (merge mode, max-lines ${maxLines})\n`);
      if (treeLike) console.log(renderTreeMarkdown(schema));
      else console.log(renderAnalyzeMarkdown(schema, format as "md" | "md-flat"));
    } else {
      outputResult({ totalLines, items: items.length, schema }, "json", !!argv.pretty);
    }
    return;
  }

  const { targets } = await resolveTargetsFromArgv(argv);
  const mode = onErrorMode(argv);
  if (argv["list-keys"] && targets.length > 1) {
    throw new Error("analyze --list-keys 仅支持单文件输入");
  }

  if (argv["list-keys"]) {
    const data = await readJsonFromTarget(targets[0]);
    const schema = analyzeJSON(data, analyzeOpts);
    const keyDepth = Number(argv["key-depth"]) || 1;
    const pathGlob = argv["path-glob"] as string | undefined;
    const fold = !!argv.fold;
    const globRe = pathGlob ? globToRegex(pathGlob) : null;

    let objects = schema.filter((item) => {
      if (item.type !== "object" || !item.keys) return false;
      const depth = splitPath(item.path).length;
      if (depth > keyDepth + 1) return false;
      if (globRe) {
        const sub = item.path.startsWith("root.") ? item.path.slice(5) : item.path;
        return globRe.test(sub) || globRe.test(item.path);
      }
      return true;
    });

    if (fold) {
      const minDepth = Math.min(...objects.map((o) => splitPath(o.path).length));
      objects = objects.filter((o) => splitPath(o.path).length === minDepth);
    }

    if (format === "md" || treeLike) {
      for (const obj of objects) {
        const depth = splitPath(obj.path).length;
        const indent = "  ".repeat(Math.max(0, depth - 1));
        const keyList = fold
          ? `\`${obj.keys!.length} keys\``
          : obj.keys!.map((k) => `\`${k}\``).join(", ");
        console.log(`${indent}**${obj.path}** — ${keyList}`);
      }
    } else {
      outputResult(objects.map((o) => ({ path: o.path, keys: fold ? o.keys!.length : o.keys })), "json", !!argv.pretty);
    }
    return;
  }

  const renderOpts =
    format === "md-flat"
      ? undefined
      : {
          top: Number(argv["top-summary"]) || 10,
          maxDetailBytes: Number(argv["max-detail-bytes"]) || 51200,
          pathPrefix: argv["path-prefix"] as string | undefined,
        };
  await runAnalyzeOnTargets(targets, mode, analyzeOpts, format, !!argv.pretty, undefined, renderOpts);
}