// JSONL 流式协议: 逐行解析 + 流式 analyze / filter / search
// 输入: 文件 / ReadableStream / AsyncIterable / string, 零依赖手写行拆分
import { analyzeJSON } from "./analyzer.js";
import { filterJSON, searchJSON } from "./filter.js";
import type { FlatSchemaItem } from "./types.js";
import type { AnalyzeOptions } from "./types.js";
import type { FilterOptions, FilterResult } from "./filter.js";
import type { SearchOptions, SearchResult } from "./filter.js";
import { countPathDepth } from "./path-utils.js";

// ---------- 输入源类型 ----------

/** JSONL 数据源: 文件 / 流 / 异步可迭代 / 字符串均可 */
export type JSONLSource = string | AsyncIterable<string> | ReadableStream<Uint8Array> | { stream(): ReadableStream<Uint8Array> };

/** 单行解析结果 */
export interface ParsedLine {
  /** 1-indexed 行号 (跳过空行) */
  line: number;
  /** 原始行文本 (不含行尾换行) */
  raw: string;
  /** 解析后的 JSON 数据 */
  data: unknown;
}

/** JSONL 错误模式 */
export type JSONLErrorMode = "skip" | "ignore" | "throw";

/** 解析时的回调配置 */
export interface ParseOptions {
  /** 出错处理: skip=警告+跳过, ignore=静默跳过, throw=抛错 (默认 skip) */
  errorMode?: JSONLErrorMode;
  /** 自定义错误回调 (覆盖 errorMode 的 stderr 输出) */
  onError?: (line: number, raw: string, err: Error) => void;
  /** 最大行字节数 (超过抛错, 0=无限, 默认 0) */
  maxLineBytes?: number;
}

/** 分析 / 过滤 / 搜索行的输出包装 (带行号) */
export interface LineResult<T> {
  line: number;
  result: T;
}

// ---------- 字节流 → 行流 (跨 chunk 安全) ----------

/** ReadableStream<Uint8Array> → AsyncIterable<string>, 按 \n 切分并处理 CRLF */
function linesFromByteStream(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoderStream();
  const decoded = stream.pipeThrough(decoder);
  // 闭包持有跨 chunk 的行 buffer
  const buf: { value: string } = { value: "" };
  const splitter = new TransformStream<string, string>({
    transform(chunk, ctrl) {
      buf.value += chunk;
      let idx: number;
      while ((idx = buf.value.indexOf("\n")) >= 0) {
        const line = buf.value.slice(0, idx);
        // 兼容 CRLF
        const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
        ctrl.enqueue(clean);
        buf.value = buf.value.slice(idx + 1);
      }
    },
    flush(ctrl) {
      // 收尾: 残留非空行也要吐
      if (buf.value.length > 0) {
        const tail = buf.value.endsWith("\r") ? buf.value.slice(0, -1) : buf.value;
        ctrl.enqueue(tail);
        buf.value = "";
      }
    },
  });
  return decoded.pipeThrough(splitter);
}

// ---------- 各种 source → AsyncIterable<string> ----------

/** AsyncIterable<string> → AsyncIterable<string>, 按 \n 切分, 跨 chunk 缓冲 */
function linesFromAsyncIterable(src: AsyncIterable<string>): AsyncIterable<string> {
  const buf: { value: string } = { value: "" };
  const iter = src[Symbol.asyncIterator]();
  const self: AsyncIterator<string> = {
    async next(): Promise<IteratorResult<string>> {
      while (true) {
        const idx = buf.value.indexOf("\n");
        if (idx >= 0) {
          const line = buf.value.slice(0, idx);
          const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
          buf.value = buf.value.slice(idx + 1);
          return { value: clean, done: false };
        }
        // buffer 中没完整行了, 拉下一 chunk
        const r = await iter.next();
        if (r.done) {
          if (buf.value.length > 0) {
            const tail = buf.value.endsWith("\r") ? buf.value.slice(0, -1) : buf.value;
            buf.value = "";
            return { value: tail, done: false };
          }
          return { value: undefined as any, done: true };
        }
        buf.value += r.value;
      }
    },
  };
  return {
    [Symbol.asyncIterator]() { return self; },
  };
}

/** 归一化各种 source 到 AsyncIterable<string> */
function toLineIterable(source: JSONLSource): AsyncIterable<string> {
  if (typeof source === "string") {
    // 字符串: 按 \n 切, 转异步可迭代; 先统一处理 CRLF/孤立的 \r
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    return (async function* () {
      for (const l of lines) yield l;
    })();
  }
  if (source instanceof ReadableStream) {
    return linesFromByteStream(source);
  }
  // BunFile-like: 有 stream() 方法
  if (typeof (source as any).stream === "function" && !(source as any)[Symbol.asyncIterator]) {
    return linesFromByteStream((source as any).stream());
  }
  // AsyncIterable<string>
  if ((source as any)[Symbol.asyncIterator]) {
    return linesFromAsyncIterable(source as AsyncIterable<string>);
  }
  throw new Error("unsupported JSONLSource type");
}

// ---------- 核心: 解析 ----------

/** 流式解析 JSONL, 逐行 yield ParsedLine */
export async function* parseJSONL(source: JSONLSource, opts: ParseOptions = {}): AsyncGenerator<ParsedLine> {
  const errorMode = opts.errorMode ?? "skip";
  const onError = opts.onError;
  const maxBytes = opts.maxLineBytes ?? 0;
  const lines = toLineIterable(source);
  let lineNo = 0;
  for await (const raw of lines) {
    lineNo++;
    // 跳过空行 (含纯空白)
    if (raw.trim().length === 0) continue;
    // 行字节数限制
    if (maxBytes > 0 && raw.length > maxBytes) {
      const err = new Error(`line ${lineNo} exceeds maxLineBytes (${raw.length} > ${maxBytes})`);
      if (errorMode === "throw") throw err;
      if (onError) onError(lineNo, raw, err);
      else if (errorMode === "skip") console.error(`[jsonl] ${err.message}`);
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e: any) {
      const err = new Error(`line ${lineNo} invalid JSON: ${e.message}`);
      if (errorMode === "throw") throw err;
      if (onError) onError(lineNo, raw, err);
      else if (errorMode === "skip") console.error(`[jsonl] ${err.message}`);
      continue;
    }
    yield { line: lineNo, raw, data };
  }
}

// ---------- 流式 analyze ----------

/** 流式逐行 analyze: 每行进、每行出一份 schema */
export async function* analyzeJSONL(
  source: JSONLSource,
  opts: AnalyzeOptions & ParseOptions = {}
): AsyncGenerator<LineResult<FlatSchemaItem[]>> {
  const { errorMode: _e, onError: _o, maxLineBytes: _m, ...analyzeOpts } = opts;
  for await (const parsed of parseJSONL(source, opts)) {
    const schema = analyzeJSON(parsed.data, analyzeOpts);
    yield { line: parsed.line, result: schema };
  }
}

// ---------- 流式 filter ----------

/** 流式逐行 filter: 每行进、命中行立即 yield 结果 */
export async function* filterJSONL(
  source: JSONLSource,
  opts: FilterOptions & ParseOptions
): AsyncGenerator<LineResult<FilterResult>> {
  const { errorMode: _e, onError: _o, maxLineBytes: _m, ...filterOpts } = opts;
  for await (const parsed of parseJSONL(source, opts)) {
    const result = filterJSON(parsed.data, filterOpts);
    if (result.matches.length > 0) {
      yield { line: parsed.line, result };
    }
  }
}

// ---------- 流式 search ----------

/** 流式逐行 search: 每行进、命中行立即 yield 结果 */
export async function* searchJSONL(
  source: JSONLSource,
  opts: SearchOptions & ParseOptions
): AsyncGenerator<LineResult<SearchResult>> {
  const { errorMode: _e, onError: _o, maxLineBytes: _m, ...searchOpts } = opts;
  for await (const parsed of parseJSONL(source, opts)) {
    const result = searchJSON(parsed.data, searchOpts);
    if (result.matches.length > 0) {
      yield { line: parsed.line, result };
    }
  }
}

/** analyze --jsonl 默认合并模式: 全量载入内存前的行数上限 */
export const DEFAULT_JSONL_MERGE_MAX_LINES = 50_000;

export interface CollectJSONLMergedOptions extends ParseOptions {
  /** 最多载入行数, 超出抛错 (默认 50000) */
  maxLines?: number;
}

export interface CollectJSONLMergedResult {
  items: unknown[];
  totalLines: number;
  truncated: boolean;
}

/** 解析 JSONL 为数组, 供合并 analyze (非流式内存模型, 受 maxLines 约束) */
export async function collectJSONLForMergedAnalyze(
  source: JSONLSource,
  opts: CollectJSONLMergedOptions = {}
): Promise<CollectJSONLMergedResult> {
  const maxLines = opts.maxLines ?? DEFAULT_JSONL_MERGE_MAX_LINES;
  const items: unknown[] = [];
  let totalLines = 0;
  for await (const parsed of parseJSONL(source, opts)) {
    totalLines++;
    if (totalLines > maxLines) {
      throw new Error(
        `JSONL merge exceeds --max-lines ${maxLines} (loaded ${maxLines} lines). Use --per-line for streaming per-row schema, or raise --max-lines.`
      );
    }
    items.push(parsed.data);
  }
  return { items, totalLines, truncated: false };
}

// ---------- 聚合工具 ----------

/** 聚合多行 schema 的统计结果 */
export interface AggregatedStats {
  totalLines: number;
  successfulLines: number;
  totalNodes: number;
  maxDepth: number;
  arraysCount: number;
  objectsCount: number;
  mixedFields: number;
  longTextFields: number;
  emptyArrays: number;
  leafTypes: Record<string, number>;
  truncatedArrays: number;
  truncatedObjects: number;
}

/** 将 analyzeJSONL 多行结果累加为一份 stats (不合并 schema, 只数 count) */
export async function aggregateAnalyzeJSONL(
  source: JSONLSource,
  opts: AnalyzeOptions & ParseOptions = {}
): Promise<AggregatedStats> {
  const stats: AggregatedStats = {
    totalLines: 0,
    successfulLines: 0,
    totalNodes: 0,
    maxDepth: 0,
    arraysCount: 0,
    objectsCount: 0,
    mixedFields: 0,
    longTextFields: 0,
    emptyArrays: 0,
    leafTypes: {},
    truncatedArrays: 0,
    truncatedObjects: 0,
  };
  for await (const { result: schema } of analyzeJSONL(source, opts)) {
    stats.totalLines++;
    stats.successfulLines++;
    stats.totalNodes += schema.length;
    for (const item of schema) {
      const depth = countPathDepth(item.path);
      if (depth > stats.maxDepth) stats.maxDepth = depth;
      switch (item.type) {
        case "array":
          stats.arraysCount++;
          if (item.comment === "empty array") stats.emptyArrays++;
          if (item.comment?.startsWith("truncated")) stats.truncatedArrays++;
          break;
        case "object":
          stats.objectsCount++;
          if (item.comment?.startsWith("truncated")) stats.truncatedObjects++;
          break;
        case "mixed":
          stats.mixedFields++;
          break;
        case "long-text":
          stats.longTextFields++;
          break;
        default:
          stats.leafTypes[item.type] = (stats.leafTypes[item.type] || 0) + 1;
      }
    }
  }
  return stats;
}

/** 收集 filterJSONL 所有命中 (扁平化, 附行号) */
export async function collectFilterJSONL(
  source: JSONLSource,
  opts: FilterOptions & ParseOptions
): Promise<Array<{ line: number; match: any; path: string }>> {
  const out: Array<{ line: number; match: any; path: string }> = [];
  for await (const { line, result } of filterJSONL(source, opts)) {
    for (let i = 0; i < result.matches.length; i++) {
      out.push({ line, match: result.matches[i], path: result.paths[i] });
    }
  }
  return out;
}

/** 收集 searchJSONL 所有命中 (扁平化, 附行号) */
export async function collectSearchJSONL(
  source: JSONLSource,
  opts: SearchOptions & ParseOptions
): Promise<Array<{ line: number; match: SearchResult["matches"][number] }>> {
  const out: Array<{ line: number; match: SearchResult["matches"][number] }> = [];
  for await (const { line, result } of searchJSONL(source, opts)) {
    for (const m of result.matches) {
      out.push({ line, match: m });
    }
  }
  return out;
}