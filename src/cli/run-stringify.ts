// stringify: 把指定数组重排成每元素一行, 写到 stdout
import minimist from "minimist";
import { readJsonFromTarget } from "../io.js";
import { assertSingleInputTarget } from "../input-resolve.js";
import { planInlineArrays, stringifyInlineArrays } from "../stringify-inline.js";
import { printHelp } from "./help.js";
import { resolveTargetsFromArgv } from "./shared.js";

function asList(value: unknown): string[] {
  if (value == null || value === true || value === false) return [];
  const raw = Array.isArray(value) ? value.map(String) : [String(value)];
  const out: string[] = [];
  for (const item of raw) {
    const parts = item.includes("[") ? [item] : item.split(",");
    for (const part of parts) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export async function runStringify(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["keys", "paths", "space"],
    boolean: ["help", "auto", "dry-run"],
    alias: { h: "help" },
  });
  if (argv.help) {
    printHelp("stringify");
    return;
  }
  const space = argv.space === undefined ? undefined : Number(argv.space);
  const opts = {
    keys: asList(argv.keys),
    paths: asList(argv.paths),
    space,
    auto: !!argv.auto,
  };
  const { targets } = await resolveTargetsFromArgv(argv);
  assertSingleInputTarget(targets, "stringify");
  const data = await readJsonFromTarget(targets[0]);
  if (argv["dry-run"]) {
    const decisions = planInlineArrays(data, opts);
    if (decisions.length === 0) {
      console.log("没有数组被压");
      return;
    }
    for (const d of decisions) {
      console.log(`压 ${d.path}  原因=${d.reason}  元素=${d.items}  展开=${d.prettyLines}  压后=${d.inlineLines}`);
    }
    return;
  }
  process.stdout.write(stringifyInlineArrays(data, opts));
}
