// CLI 共享: 输入、输出、query 解析
import minimist from "minimist";
import {
  resolveInputTargets,
  resolveOptsFromArgv,
} from "../input-resolve.js";
import type { FilterQuery } from "../filter.js";
import type { JSONLSource } from "../jsonl.js";
import { jsonlSourceFromFile, jsonlSourceFromStdin } from "../runtime/jsonl-source.js";

export const QUERY_TOKEN_RE = /^([\w$.\-[\]]+)(<=|>=|<|>|=)(.+)$/;

/** JSONL: file 或 stdin → JSONLSource */
export async function loadJSONLInput(argv: minimist.ParsedArgs): Promise<JSONLSource> {
  const file = argv._[0];
  if (file) {
    return jsonlSourceFromFile(String(file));
  }
  return jsonlSourceFromStdin();
}

export function outputResult(payload: unknown, format: string, pretty: boolean) {
  if (format === "md") {
    if (Array.isArray(payload)) {
      console.log(
        payload
          .map((it, i) => {
            const body = pretty ? JSON.stringify(it, null, 2) : JSON.stringify(it);
            return `### match #${i + 1}\n\n\`\`\`json\n${body}\n\`\`\``;
          })
          .join("\n\n")
      );
    } else {
      console.log(pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
    }
    return;
  }
  if (format === "json") {
    console.log(pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
    return;
  }
  throw new Error(`unknown format: ${format}`);
}

export function parseQueries(tokens: string[], lenient = false): FilterQuery[] {
  if (tokens.length === 0) return [];
  const queries: FilterQuery[] = [];
  for (const tok of tokens) {
    const m = tok.match(QUERY_TOKEN_RE);
    if (!m) {
      if (lenient) continue;
      throw new Error(
        `invalid query token: "${tok}" (expect key<op>value, e.g. id=k2p6, cost.input<=1)`
      );
    }
    const [, key, op, rawVal] = m;
    queries.push({ key, op: op as FilterQuery["op"], value: rawVal });
  }
  return queries;
}

export function rootTypeOf(data: unknown): string {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  return typeof data;
}

export function drillLine(...cmds: string[]): string {
  return `\n> 展开: ${cmds.map((c) => `\`${c}\``).join(" · ")}\n`;
}

function emitResolveWarnings(warnings: string[]) {
  for (const w of warnings) console.error(`warn: ${w}`);
}

export function onErrorMode(argv: Record<string, unknown>): "skip" | "fail" {
  return argv["on-error"] === "fail" ? "fail" : "skip";
}

export async function resolveTargetsFromArgv(argv: Record<string, unknown>) {
  const spec = argv.glob ? undefined : (argv._ as string[] | undefined)?.[0];
  const r = await resolveInputTargets(spec, resolveOptsFromArgv(argv));
  emitResolveWarnings(r.warnings);
  return r;
}