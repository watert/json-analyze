// 解析 CLI 输入: 单文件 / 目录 / glob → InputTarget[]
import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { collectFilesInDir, scanGlob } from "./runtime/glob.js";

export interface InputTarget {
  path: string;
  kind: "file" | "stdin";
}

export interface ResolveInputOptions {
  /** JSONL 模式默认只收集 .jsonl */
  jsonl?: boolean;
  /** 扩展名，默认 json 或 jsonl */
  ext?: string[];
  /** 最多文件数，默认 100 */
  maxFiles?: number;
  /** 目录不递归 */
  noRecurse?: boolean;
  /** 与 --glob 联用 */
  root?: string;
  /** 显式 glob，优先于 spec */
  glob?: string;
  cwd?: string;
}

export interface ResolveInputResult {
  targets: InputTarget[];
  /** 因 max-files 未纳入的数量 */
  omitted: number;
  warnings: string[];
}

const GLOB_META = /[*?[{]/;
const DEFAULT_MAX_FILES = 100;

function defaultExts(jsonl?: boolean): string[] {
  return jsonl ? ["jsonl"] : ["json"];
}

function extMatches(filePath: string, exts: string[]): boolean {
  const lower = filePath.toLowerCase();
  return exts.some((e) => lower.endsWith(`.${e.replace(/^\./, "")}`));
}

/** 目录内收集文件 */
async function collectFromDir(
  dir: string,
  exts: string[],
  recurse: boolean,
  maxFiles: number,
  out: string[],
  omitted: { n: number }
): Promise<void> {
  const paths = await collectFilesInDir(dir, exts, recurse);
  for (const full of paths) {
    if (out.length >= maxFiles) {
      omitted.n++;
      continue;
    }
    if (extMatches(full, exts)) out.push(full);
  }
}

/** glob 从 cwd 或 root 扫描 */
async function collectFromGlob(
  pattern: string,
  base: string,
  exts: string[],
  maxFiles: number,
  out: string[],
  omitted: { n: number }
): Promise<void> {
  const rels = await scanGlob(pattern, base, true);
  for (const rel of rels) {
    if (out.length >= maxFiles) {
      omitted.n++;
      continue;
    }
    const full = resolve(base, rel);
    if (extMatches(full, exts)) out.push(full);
  }
}

/**
 * 将位置参数解析为待处理文件列表；无 spec 且无 glob → stdin 单 target。
 */
export async function resolveInputTargets(
  spec: string | undefined,
  opts: ResolveInputOptions = {}
): Promise<ResolveInputResult> {
  const exts = opts.ext?.length ? opts.ext.map((e) => e.replace(/^\./, "")) : defaultExts(opts.jsonl);
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const cwd = opts.cwd ?? process.cwd();
  const warnings: string[] = [];
  const omitted = { n: 0 };

  if (opts.glob) {
    const base = resolve(cwd, opts.root ?? ".");
    const paths: string[] = [];
    await collectFromGlob(opts.glob, base, exts, maxFiles, paths, omitted);
    paths.sort();
    if (paths.length === 0) {
      throw new Error(`no files matched glob "${opts.glob}" under ${base} (ext: ${exts.join(",")})`);
    }
    if (omitted.n > 0) {
      warnings.push(`max-files ${maxFiles}: omitted ${omitted.n} additional file(s)`);
    }
    return {
      targets: paths.map((p) => ({ path: p, kind: "file" as const })),
      omitted: omitted.n,
      warnings,
    };
  }

  if (!spec) {
    return { targets: [{ path: "<stdin>", kind: "stdin" }], omitted: 0, warnings: [] };
  }

  const abs = resolve(cwd, spec);

  if (GLOB_META.test(spec)) {
    const scanCwd = spec.includes("/") || spec.includes("\\") ? dirname(abs) : cwd;
    const relPattern =
      spec.includes("/") || spec.includes("\\") ? relative(scanCwd, abs).replace(/\\/g, "/") : spec;
    const paths: string[] = [];
    await collectFromGlob(relPattern, scanCwd, exts, maxFiles, paths, omitted);
    paths.sort();
    if (paths.length === 0) {
      throw new Error(`no files matched pattern "${spec}" (ext: ${exts.join(",")})`);
    }
    if (omitted.n > 0) warnings.push(`max-files ${maxFiles}: omitted ${omitted.n} additional file(s)`);
    return {
      targets: paths.map((p) => ({ path: p, kind: "file" })),
      omitted: omitted.n,
      warnings,
    };
  }

  if (!existsSync(abs)) {
    throw new Error(`input not found: ${spec}`);
  }

  const st = statSync(abs);
  if (st.isDirectory()) {
    const paths: string[] = [];
    await collectFromDir(abs, exts, !opts.noRecurse, maxFiles, paths, omitted);
    paths.sort();
    if (paths.length === 0) {
      throw new Error(`no .${exts.join("/.")} files under directory: ${spec}`);
    }
    if (omitted.n > 0) warnings.push(`max-files ${maxFiles}: omitted ${omitted.n} additional file(s)`);
    return {
      targets: paths.map((p) => ({ path: p, kind: "file" })),
      omitted: omitted.n,
      warnings,
    };
  }

  if (!extMatches(abs, exts)) {
    warnings.push(`file extension may not match expected (${exts.join(",")}): ${spec}`);
  }
  return { targets: [{ path: abs, kind: "file" }], omitted: 0, warnings };
}

/** get / explore / compare 仅允许单文件或 stdin */
export function assertSingleInputTarget(targets: InputTarget[], command: string): void {
  if (targets.length <= 1) return;
  throw new Error(
    `${command} 仅支持单文件输入 (当前 ${targets.length} 个文件)。请逐文件调用，或使用 filter/search 扫描目录。`
  );
}

export function isStdinTarget(t: InputTarget): boolean {
  return t.kind === "stdin";
}

/** 从 minimist argv 提取 resolve 选项 */
export function resolveOptsFromArgv(argv: Record<string, unknown>): ResolveInputOptions {
  const extRaw = argv.ext as string | undefined;
  const ext = extRaw ? extRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return {
    jsonl: !!argv.jsonl,
    ext,
    maxFiles: argv["max-files"] !== undefined ? Number(argv["max-files"]) || DEFAULT_MAX_FILES : DEFAULT_MAX_FILES,
    noRecurse: !!argv["no-recurse"],
    root: (argv.root as string) || undefined,
    glob: (argv.glob as string) || undefined,
  };
}