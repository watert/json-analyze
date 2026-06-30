import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { JSONLSource } from "../jsonl.js";
import { pathExists } from "./fs.js";
import { stdinByteStream } from "./stdin.js";
import { isBun } from "./is-bun.js";

/** 本地 JSON 文件 → JSONLSource（流式读） */
export async function jsonlSourceFromFile(path: string): Promise<JSONLSource> {
  if (!(await pathExists(path))) throw new Error(`file not found: ${path}`);
  if (isBun()) {
    return Bun.file(path);
  }
  const nodeStream = createReadStream(path);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

export function jsonlSourceFromStdin(): JSONLSource {
  return stdinByteStream();
}