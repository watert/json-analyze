// 单文件 / stdin JSON 读取
import type { InputTarget } from "./input-resolve.js";
import { isStdinTarget } from "./input-resolve.js";
import { readTextFile } from "./runtime/fs.js";
import { readStdinText } from "./runtime/stdin.js";

export async function readJsonFromTarget(target: InputTarget): Promise<unknown> {
  let input: string;
  if (isStdinTarget(target)) {
    input = await readStdinText();
  } else {
    input = await readTextFile(target.path);
  }
  if (!input.trim()) throw new Error(`empty input: ${target.path}`);
  try {
    return JSON.parse(input);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON (${target.path}): ${msg}`);
  }
}