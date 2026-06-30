// 交互式探索工具: getFieldValues / getPathCardinality / findPathsByType / getObjectKeys
import isPlainObject from "lodash/isPlainObject.js";
import { getByPath } from "./paths.js";
import type { FlatSchemaItem, FieldValueResult, CardinalityResult } from "./types.js";

/**
 * 获取指定路径的所有实际值（去重 + 计数）。
 * 适用于 Agent 追问"这个字段有什么不同值"、"字段 X 的取值分布"。
 */
export function getFieldValues(
  data: any,
  path: string,
  opts: { limit?: number; distinct?: boolean; maxDepth?: number } = {}
): FieldValueResult {
  const { limit = 100, distinct = true, maxDepth = 64 } = opts;
  const rawValues = getByPath(data, path, { limit: limit * 3, maxDepth });
  const totalVisited = rawValues.length;

  let values: any[];
  if (distinct) {
    const seen = new Set<string>();
    values = [];
    for (const v of rawValues) {
      const key = stableKey(v);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(v);
        if (values.length >= limit) break;
      }
    }
  } else {
    values = rawValues.slice(0, limit);
  }

  return {
    values,
    distinct: distinct ? values.length : totalVisited,
    totalVisited,
    truncated: values.length >= limit,
  };
}

/**
 * 获取路径的基数（去重值数 / 总值数）。
 */
export function getPathCardinality(
  data: any,
  path: string,
  opts: { maxDepth?: number; maxItems?: number } = {}
): CardinalityResult {
  const { maxDepth = 64, maxItems = 10000 } = opts;
  const values = getByPath(data, path, { limit: maxItems, maxDepth });
  const seen = new Set<string>();
  for (const v of values) {
    seen.add(stableKey(v));
  }
  return {
    distinct: seen.size,
    total: values.length,
    truncated: values.length >= maxItems,
  };
}

/**
 * 从 schema 数组中筛选指定类型的节点。
 * 用于 Agent 快速定位: 找出所有 mixed 字段 / 所有 long-text 字段 / 所有 object 等。
 */
export function findPathsByType(schema: FlatSchemaItem[], type: string): FlatSchemaItem[] {
  return schema.filter((item) => item.type === type);
}

/** 稳定的 key 表示，用于去重 */
function stableKey(v: any): string {
  if (v === null) return "__null__";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * 获取对象节点的 key 列表。
 * 路径指向 object 时返回其 keys，指向 object 数组时返回所有对象的 key 并集。
 * 用于 Agent 快速了解 dict-key 结构（如 provider 列表）。
 */
export function getObjectKeys(
  data: any,
  path: string,
  opts: { limit?: number; maxDepth?: number } = {}
): { keys: string[]; total: number; truncated: boolean } {
  const { limit = 500, maxDepth = 64 } = opts;
  const values = getByPath(data, path, { limit: 1, maxDepth });
  if (values.length === 0) return { keys: [], total: 0, truncated: false };

  const keySet = new Set<string>();
  let total = 0;
  let truncated = false;

  for (const v of values) {
    if (isPlainObject(v)) {
      const ks = Object.keys(v);
      total += ks.length;
      for (const k of ks) {
        keySet.add(k);
        if (keySet.size >= limit) { truncated = true; break; }
      }
    }
    if (truncated) break;
  }

  return { keys: [...keySet].slice(0, limit), total, truncated };
}
