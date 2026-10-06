// JSON Schema Analyzer 入口导出
export { analyzeJSON } from "./analyzer.js";
export { getParent } from "./path-utils.js";
export { renderMarkdown, renderAnalyzeMarkdown } from "./format.js";
export { renderGroupedFlatMarkdown } from "./format-grouped.js";
export { renderAnalyzePreamble, pickHeaviestPaths } from "./analyze-preamble.js";
export { filterJSON, searchJSON } from "./filter.js";
export { getByPath, readByKey, getClosestKeys } from "./paths.js";
export { getFieldValues, getPathCardinality, findPathsByType, getObjectKeys } from "./explorer.js";
export { summarizeSchema, compactSchema } from "./summarize.js";
export {
  renderOverviewMarkdown,
  buildOverviewJSON,
  pickHotspots,
  suggestQuickPaths,
} from "./overview.js";
export type { OverviewOptions, OverviewInputMeta, OverviewJSON } from "./overview.js";
export {
  resolveInputTargets,
  assertSingleInputTarget,
  resolveOptsFromArgv,
  isStdinTarget,
} from "./input-resolve.js";
export type { InputTarget, ResolveInputOptions, ResolveInputResult } from "./input-resolve.js";
export { readJsonFromTarget } from "./io.js";
export { mergeAnalyzeSummaries } from "./batch-summary.js";
export {
  diffJSON,
  diffWalk,
  parseIgnorePaths,
  DEFAULT_DIFF_IGNORE,
} from "./diff.js";
export type { DiffJSONOptions } from "./diff.js";
export { splitPath } from "./path-utils.js";
export {
  parseJSONL,
  analyzeJSONL,
  filterJSONL,
  searchJSONL,
  aggregateAnalyzeJSONL,
  collectFilterJSONL,
  collectSearchJSONL,
  collectJSONLForMergedAnalyze,
  DEFAULT_JSONL_MERGE_MAX_LINES,
} from "./jsonl.js";
export { stringifyInlineArrays } from "./stringify-inline.js";
export type { StringifyInlineOptions } from "./stringify-inline.js";

export type { FilterQuery, FilterOptions, FilterResult, FilterOp, SearchOptions, SearchMatch, SearchResult } from "./filter.js";
export type {
  FlatSchemaItem,
  ItemTypeEntry,
  VariantEntry,
  AnalyzeOptions,
  AnalyzeSummary,
  GetByPathOptions,
  FieldValueResult,
  CardinalityResult,
  PathSegment,
} from "./types.js";
export type {
  JSONLSource,
  ParsedLine,
  JSONLErrorMode,
  ParseOptions,
  LineResult,
  AggregatedStats,
  CollectJSONLMergedOptions,
  CollectJSONLMergedResult,
} from "./jsonl.js";
