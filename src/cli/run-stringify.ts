// stringify: 把指定数组重排成每元素一行, 写到 stdout
import minimist from "minimist";
import { readJsonFromTarget } from "../io.js";
import { assertSingleInputTarget } from "../input-resolve.js";
import { stringifyInlineArrays } from "../stringify-inline.js";
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
    boolean: ["help"],
    alias: { h: "help" },
  });
  if (argv.help) {
    printHelp("stringify");
    return;
  }
  const space = argv.space === undefined ? undefined : Number(argv.space);
  const { targets } = await resolveTargetsFromArgv(argv);
  assertSingleInputTarget(targets, "stringify");
  const data = await readJsonFromTarget(targets[0]);
  process.stdout.write(stringifyInlineArrays(data, {
    keys: asList(argv.keys),
    paths: asList(argv.paths),
    space,
  }));
}
