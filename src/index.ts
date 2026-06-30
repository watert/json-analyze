// JSON Schema Analyzer 入口导出
export { analyzeJSON } from "./analyzer.js";
export { getParent } from "./path-utils.js";
export { renderMarkdown } from "./format.js";
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
export { splitPath } from "./path-utils.js";
export {
  parseJSONL,
  analyzeJSONL,
  filterJSONL,
  searchJSONL,
  aggregateAnalyzeJSONL,
  collectFilterJSONL,
  collectSearchJSONL,
} from "./jsonl.js";

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
} from "./jsonl.js";
