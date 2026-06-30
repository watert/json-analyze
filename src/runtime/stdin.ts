import { Readable } from "node:stream";
import { isBun } from "./is-bun.js";

/** 读取 stdin 全文（UTF-8） */
export async function readStdinText(): Promise<string> {
  if (isBun()) {
    const chunks: string[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    return chunks.join("");
  }
  const parts: Uint8Array[] = [];
  for await (const chunk of Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>) {
    parts.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return new TextDecoder().decode(out);
}

/** stdin 字节流，供 JSONL 等流式读取 */
export function stdinByteStream(): ReadableStream<Uint8Array> {
  if (isBun()) {
    return Bun.stdin.stream();
  }
  return Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
}