// 单文件 / stdin JSON 读取
import type { InputTarget } from "./input-resolve.js";
import { isStdinTarget } from "./input-resolve.js";

export async function readJsonFromTarget(target: InputTarget): Promise<unknown> {
  let input: string;
  if (isStdinTarget(target)) {
    const chunks: string[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    input = chunks.join("");
  } else {
    const f = Bun.file(target.path);
    if (!(await f.exists())) throw new Error(`file not found: ${target.path}`);
    input = await f.text();
  }
  if (!input.trim()) throw new Error(`empty input: ${target.path}`);
  try {
    return JSON.parse(input);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON (${target.path}): ${msg}`);
  }
}