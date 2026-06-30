import minimist from "minimist";
import { getFieldValues, getPathCardinality, getObjectKeys } from "../explorer.js";
import { parseJSONL } from "../jsonl.js";
import { readJsonFromTarget } from "../io.js";
import { assertSingleInputTarget } from "../input-resolve.js";
import { printHelp } from "./help.js";
import { loadJSONLInput, outputResult, resolveTargetsFromArgv } from "./shared.js";

export async function runExplore(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format"],
    boolean: ["help", "cardinality", "no-distinct", "keys", "jsonl"],
    alias: { h: "help", f: "format" },
    default: { format: "md", limit: 100 },
  });
  if (argv.help) {
    printHelp("explore");
    return;
  }

  let path: string;
  let file: string | undefined;
  if (argv._.length >= 2) {
    path = String(argv._[0]);
    file = argv._[1];
  } else if (argv._.length === 1) {
    path = String(argv._[0]);
    file = undefined;
  } else {
    throw new Error("missing path argument");
  }

  const format = argv.format as string;
  if (!["md", "json"].includes(format)) throw new Error(`unknown format "${format}", expected "md"|"json"`);
  const limit = Number(argv.limit) || 100;

  if (argv.jsonl) {
    const loadArgv = { ...argv, _: file ? [file] : [] };
    const source = await loadJSONLInput(loadArgv);
    for await (const parsed of parseJSONL(source)) {
      if (argv.keys) {
        const r = getObjectKeys(parsed.data, path, { limit });
        console.log(JSON.stringify({ line: parsed.line, ...r }));
      } else if (argv.cardinality) {
        const r = getPathCardinality(parsed.data, path);
        console.log(JSON.stringify({ line: parsed.line, ...r }));
      } else {
        const r = getFieldValues(parsed.data, path, { limit, distinct: !argv["no-distinct"] });
        console.log(JSON.stringify({ line: parsed.line, ...r }));
      }
    }
    return;
  }

  const resolveArgv = { ...argv, _: file ? [file] : [] };
  const { targets } = await resolveTargetsFromArgv(resolveArgv);
  assertSingleInputTarget(targets, "explore");
  const data = await readJsonFromTarget(targets[0]);

  if (argv.keys) {
    const result = getObjectKeys(data, path, { limit });
    if (format === "md") {
      const truncatedNote = result.truncated ? ` (truncated, ${result.total} total)` : "";
      console.log(`**${path}** — keys: ${result.keys.length}${truncatedNote}`);
      for (let i = 0; i < result.keys.length; i++) {
        console.log(`  ${i + 1}. \`${result.keys[i]}\``);
      }
    } else {
      outputResult(result, "json", true);
    }
    return;
  }

  if (argv.cardinality) {
    const card = getPathCardinality(data, path);
    if (format === "md") {
      console.log(`**${path}** — distinct: \`${card.distinct}\`, total: \`${card.total}\`, truncated: \`${card.truncated}\``);
    } else {
      outputResult(card, "json", true);
    }
    return;
  }

  const result = getFieldValues(data, path, { limit, distinct: !argv["no-distinct"] });
  if (format === "md") {
    console.log(
      `**${path}** — total visited: \`${result.totalVisited}\`, distinct: \`${result.distinct}\`, truncated: \`${result.truncated}\``
    );
    console.log("");
    for (let i = 0; i < result.values.length; i++) {
      const v = result.values[i];
      console.log(`${i + 1}. \`${typeof v === "object" ? JSON.stringify(v) : String(v)}\``);
    }
  } else {
    outputResult(result, "json", true);
  }
}