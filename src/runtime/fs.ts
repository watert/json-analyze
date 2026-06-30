import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { isBun } from "./is-bun.js";

export async function pathExists(path: string): Promise<boolean> {
  if (isBun()) {
    return Bun.file(path).exists();
  }
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(path: string): Promise<string> {
  if (isBun()) {
    const f = Bun.file(path);
    if (!(await f.exists())) throw new Error(`file not found: ${path}`);
    return f.text();
  }
  try {
    return await readFile(path, "utf8");
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : "";
    if (code === "ENOENT") throw new Error(`file not found: ${path}`);
    throw e;
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  const text = await readTextFile(path);
  try {
    return JSON.parse(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON (${path}): ${msg}`);
  }
}