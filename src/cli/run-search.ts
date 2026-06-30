import minimist from "minimist";
import { searchJSONL } from "../jsonl.js";
import { runSearchOnTargets } from "../multi-run.js";
import { printHelp } from "./help.js";
import { loadJSONLInput, onErrorMode, resolveTargetsFromArgv } from "./shared.js";

export async function runSearch(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "path-glob", "root", "glob", "ext", "on-error"],
    boolean: ["help", "pretty", "key-only", "value-only", "jsonl", "no-recurse"],
    alias: { h: "help", f: "format", p: "pretty" },
    default: {
      format: "md",
      "path-glob": "",
      "max-depth": 32,
      limit: 50,
      "max-files": 100,
      "on-error": "skip",
    },
  });
  if (argv.help) {
    printHelp("search");
    return;
  }
  const format = argv.format as string;
  if (!["md", "json"].includes(format)) throw new Error(`unknown format "${format}", expected "md"|"json"`);

  let pattern: string;
  let file: string | undefined;
  if (argv._.length >= 2) {
    pattern = String(argv._[0]);
    file = argv._[1];
  } else if (argv._.length === 1) {
    pattern = String(argv._[0]);
    file = undefined;
  } else {
    throw new Error("missing pattern argument");
  }

  const searchOpts = {
    pattern,
    keyOnly: argv["key-only"],
    valueOnly: argv["value-only"],
    pathGlob: argv["path-glob"] || undefined,
    maxDepth: Number(argv["max-depth"]) || 32,
    limit: Number(argv.limit) || 50,
  };

  if (argv.jsonl) {
    const loadArgv = { ...argv, _: file ? [file] : [] };
    const source = await loadJSONLInput(loadArgv);
    let totalHits = 0;
    for await (const { line, result } of searchJSONL(source, searchOpts)) {
      for (const m of result.matches) {
        if (format === "md") {
          const val =
            m.value !== undefined
              ? ` = \`${typeof m.value === "object" ? JSON.stringify(m.value) : String(m.value)}\``
              : "";
          console.log(`- line ${line}: \`${m.path}\` (key=${m.key ?? "-"})${val}`);
        } else {
          console.log(JSON.stringify({ line, ...m }));
        }
        totalHits++;
      }
    }
    if (totalHits === 0) {
      console.error("no match");
      process.exitCode = 2;
    }
    return;
  }

  const resolveArgv = { ...argv, _: argv.glob ? [] : file ? [file] : [] };
  const { targets } = await resolveTargetsFromArgv(resolveArgv);
  const totalHits = await runSearchOnTargets(targets, onErrorMode(argv), searchOpts, format);
  if (totalHits === 0) {
    console.error("no match");
    process.exitCode = 2;
  }
}