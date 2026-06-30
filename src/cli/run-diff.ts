import minimist from "minimist";
import { diffJSON } from "../diff.js";
import { readJsonFile } from "../runtime/fs.js";
import { printHelp } from "./help.js";
import { outputResult } from "./shared.js";

export async function runDiff(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "labels", "path-prefix", "ignore-paths", "array-mode", "left", "right"],
    boolean: ["help", "dict-key-only", "pretty"],
    alias: { h: "help", f: "format" },
    default: {
      format: "md",
      "path-prefix": "root",
      "array-mode": "id",
      "max-detail-bytes": 51200,
      "value-depth": 4,
      "max-changes": 2000,
    },
  });
  if (argv.help) {
    printHelp("diff");
    return;
  }

  let leftPath = argv.left as string | undefined;
  let rightPath = argv.right as string | undefined;
  const positional = argv._.map(String);
  if (!leftPath && positional.length >= 2) {
    leftPath = positional[0];
    rightPath = positional[1];
  }
  if (!leftPath || !rightPath) throw new Error("diff requires two files: json-analyze diff <fileA> <fileB>");

  const left = await readJsonFile(leftPath);
  const right = await readJsonFile(rightPath);

  const labelStr = argv.labels as string | undefined;
  const labels = labelStr ? labelStr.split(",").map((s) => s.trim()) : [];
  const format = argv.format as string;
  if (!["md", "md-flat", "json"].includes(format)) throw new Error(`unknown format "${format}"`);

  const out = diffJSON(left, right, {
    leftFile: leftPath,
    rightFile: rightPath,
    leftLabel: labels[0],
    rightLabel: labels[1],
    format: format as "md" | "md-flat" | "json",
    pathPrefix: argv["path-prefix"] as string,
    maxDetailBytes: Number(argv["max-detail-bytes"]) || 51200,
    ignorePaths: argv["ignore-paths"] as string | undefined,
    dictKeyOnly: !!argv["dict-key-only"],
    arrayMode: (argv["array-mode"] as "index" | "id") || "id",
    valueDepth: Number(argv["value-depth"]) || 4,
    maxChanges: Number(argv["max-changes"]) || 2000,
  });

  if (format === "json") outputResult(out, "json", !!argv.pretty);
  else console.log(out);
}