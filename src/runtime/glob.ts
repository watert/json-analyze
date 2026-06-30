import { join } from "node:path";
import { glob } from "tinyglobby";
import { isBun } from "./is-bun.js";

/** 在 cwd 下扫描 glob，yield 相对 cwd 的路径（与 bun.Glob.scan 一致） */
export async function scanGlob(
  pattern: string,
  cwd: string,
  onlyFiles: boolean
): Promise<string[]> {
  if (isBun()) {
    const { Glob } = await import("bun");
    const g = new Glob(pattern);
    const out: string[] = [];
    for await (const rel of g.scan({ cwd, onlyFiles })) {
      out.push(rel.replace(/\\/g, "/"));
    }
    return out;
  }
  const entries = await glob(pattern, {
    cwd,
    onlyFiles,
    absolute: false,
    dot: false,
  });
  return entries.map((e) => e.replace(/\\/g, "/"));
}

/** 目录内收集；recurse 用双星号 glob，否则单层 */
export async function collectFilesInDir(
  dir: string,
  exts: string[],
  recurse: boolean
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ext of exts) {
    const e = ext.replace(/^\./, "");
    const pattern = recurse ? `**/*.${e}` : `*.${e}`;
    const rels = await scanGlob(pattern, dir, true);
    for (const rel of rels) {
      const full = join(dir, rel);
      if (!seen.has(full)) {
        seen.add(full);
        out.push(full);
      }
    }
  }
  return out;
}