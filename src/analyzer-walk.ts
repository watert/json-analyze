// analyze 递归遍历上下文 (单对象传参，避免 10+  positional args)
import { mergeRecordDetectOpts, type RecordDetectConfig } from "./dict-record.js";
import type { AnalyzeOptions, FlatSchemaItem } from "./types.js";

export const ANALYZE_WALK_DEFAULTS = {
  maxDepth: 32,
  maxArrayItems: 5000,
  maxKeysPerObject: 500,
  sampleCount: 3,
} as const;

/** 一次 analyze 遍历的共享状态与护栏 */
export interface AnalyzeWalkCtx {
  result: FlatSchemaItem[];
  seen: Set<object>;
  maxDepth: number;
  maxArrayItems: number;
  maxKeysPerObject: number;
  sampleCount: number;
  recordCfg: RecordDetectConfig;
}

export function createAnalyzeWalkCtx(opts: AnalyzeOptions = {}): AnalyzeWalkCtx {
  const limits = { ...ANALYZE_WALK_DEFAULTS, ...opts };
  return {
    result: [],
    seen: new Set(),
    maxDepth: limits.maxDepth,
    maxArrayItems: limits.maxArrayItems,
    maxKeysPerObject: limits.maxKeysPerObject,
    sampleCount: limits.sampleCount,
    recordCfg: mergeRecordDetectOpts(opts),
  };
}

export interface WalkValueParams {
  ctx: AnalyzeWalkCtx;
  value: unknown;
  path: string;
  depth?: number;
}

export interface WalkArrayObjectsParams {
  ctx: AnalyzeWalkCtx;
  objects: object[];
  path: string;
  depth: number;
}

export interface WalkArrayArraysParams {
  ctx: AnalyzeWalkCtx;
  arrays: unknown[][];
  path: string;
  depth: number;
}

export interface WalkMergedValuesParams {
  ctx: AnalyzeWalkCtx;
  values: unknown[];
  path: string;
  depth: number;
  presence: number;
  total: number;
}

export interface WalkMixedParams {
  ctx: AnalyzeWalkCtx;
  values: unknown[];
  path: string;
  presence: number;
  total: number;
}