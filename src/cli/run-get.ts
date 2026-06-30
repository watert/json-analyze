import minimist from "minimist";
import { getByPath, getClosestKeys } from "../paths.js";
import { parseJSONL } from "../jsonl.js";
import { readJsonFromTarget } from "../io.js";
import { assertSingleInputTarget } from "../input-resolve.js";
import { printHelp } from "./help.js";
import { loadJSONLInput, outputResult, resolveTargetsFromArgv } from "./shared.js";

export async function runGet(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format"],
    boolean: ["help", "pretty", "jsonl"],
    alias: { h: "help", f: "format", p: "pretty" },
    default: { format: "json", limit: 100 },
  });
  if (argv.help) {
    printHelp("get");
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
    let totalValues = 0;
    for await (const parsed of parseJSONL(source)) {
      const values = getByPath(parsed.data, path, { limit });
      if (values.length === 0) continue;
      totalValues += values.length;
      if (format === "md") {
        console.log(`### line ${parsed.line}\n`);
        for (const v of values) {
          console.log(`- \`${typeof v === "object" ? JSON.stringify(v) : String(v)}\``);
        }
        console.log("");
      } else {
        console.log(JSON.stringify({ line: parsed.line, values }));
      }
    }
    if (totalValues === 0) {
      console.error("no match");
      process.exitCode = 2;
    }
    return;
  }

  const resolveArgv = { ...argv, _: file ? [file] : [] };
  const { targets } = await resolveTargetsFromArgv(resolveArgv);
  assertSingleInputTarget(targets, "get");
  const data = await readJsonFromTarget(targets[0]);
  const values = getByPath(data, path, { limit });

  if (values.length === 0) {
    const hint = getClosestKeys(data, path, { limit: 10 });
    if (hint) {
      console.error(`no match for path: ${path}`);
      console.error(`  last valid node: ${hint.lastValidPath} (${hint.lastNodeType})`);
      if (hint.closestKeys.length > 0) {
        console.error(`  closest keys: ${hint.closestKeys.map((k) => `\`${k}\``).join(", ")}`);
      }
      if (hint.searchedKey) console.error(`  searched: \`${hint.searchedKey}\``);
    } else {
      console.error("no match");
    }
    process.exitCode = 2;
    return;
  }

  outputResult(values, format, !!argv.pretty);
}