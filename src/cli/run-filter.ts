import minimist from "minimist";
import { filterJSONL } from "../jsonl.js";
import { runFilterOnTargets } from "../multi-run.js";
import { printHelp } from "./help.js";
import {
  loadJSONLInput,
  parseQueries,
  QUERY_TOKEN_RE,
  onErrorMode,
  resolveTargetsFromArgv,
} from "./shared.js";

export async function runFilter(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "key-match", "path-glob", "root", "glob", "ext", "on-error"],
    boolean: ["help", "pretty", "jsonl", "no-recurse"],
    alias: { h: "help", f: "format", p: "pretty" },
    default: {
      format: "json",
      "key-match": "",
      "path-glob": "",
      "max-depth": 32,
      limit: 50,
      "max-files": 100,
      "on-error": "skip",
    },
  });
  if (argv.help) {
    printHelp("filter");
    return;
  }
  const format = argv.format as string;
  if (!["md", "json"].includes(format)) throw new Error(`unknown format "${format}", expected "md"|"json"`);

  const hasKeyMatch = rawArgv.some((a) => a === "--key-match" || a.startsWith("--key-match="));
  const explicitKeyMatch = (argv["key-match"] as string) || undefined;
  let keyMatch: string | undefined = explicitKeyMatch;
  let file: string | undefined;
  let queryTokens: string[];

  const posArgs = argv._.map(String);
  const queryLike = posArgs.filter((t) => QUERY_TOKEN_RE.test(t));
  const nonQuery = posArgs.filter((t) => !QUERY_TOKEN_RE.test(t));

  if (!keyMatch && hasKeyMatch) {
    file = nonQuery[0];
    if (nonQuery.length > 1) keyMatch = nonQuery.slice(1).join(" ");
    queryTokens = queryLike;
  } else if (queryLike.length > 0) {
    file = nonQuery.length > 0 ? nonQuery[0] : undefined;
    queryTokens = queryLike;
  } else if (nonQuery.length >= 1) {
    file = nonQuery[0];
    queryTokens = [];
  } else {
    queryTokens = [];
  }
  const queries = parseQueries(queryTokens, !!keyMatch);

  const filterOpts = {
    queries,
    keyMatch,
    pathGlob: argv["path-glob"] || undefined,
    maxDepth: Number(argv["max-depth"]) || 32,
    limit: Number(argv.limit) || 50,
  };

  if (argv.jsonl) {
    const loadArgv = { ...argv, _: file ? [file] : [] };
    const source = await loadJSONLInput(loadArgv);
    let totalHits = 0;
    for await (const { line, result } of filterJSONL(source, filterOpts)) {
      for (let i = 0; i < result.matches.length; i++) {
        const m = result.matches[i];
        if (format === "md") {
          const body = JSON.stringify(m, null, 2);
          console.log(`### match @line=${line}, path=${result.paths[i]}\n\n\`\`\`json\n${body}\n\`\`\`\n`);
        } else {
          console.log(JSON.stringify({ line, path: result.paths[i], match: m }));
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
  const totalHits = await runFilterOnTargets(targets, onErrorMode(argv), filterOpts, format, !!argv.pretty);
  if (totalHits === 0) {
    console.error("no match");
    process.exitCode = 2;
  }
}