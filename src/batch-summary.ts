// 多文件 summary 聚合
import type { AnalyzeSummary } from "./types.js";

export function mergeAnalyzeSummaries(items: AnalyzeSummary[]): AnalyzeSummary {
  const leafTypes: Record<string, number> = {};
  let maxDepth = 0;
  const out: AnalyzeSummary = {
    totalNodes: 0,
    maxDepth: 0,
    arraysCount: 0,
    objectsCount: 0,
    mixedFields: 0,
    longTextFields: 0,
    emptyArrays: 0,
    leafTypes,
    truncatedArrays: 0,
    truncatedObjects: 0,
  };
  for (const s of items) {
    out.totalNodes += s.totalNodes;
    out.arraysCount += s.arraysCount;
    out.objectsCount += s.objectsCount;
    out.mixedFields += s.mixedFields;
    out.longTextFields += s.longTextFields;
    out.emptyArrays += s.emptyArrays;
    out.truncatedArrays += s.truncatedArrays;
    out.truncatedObjects += s.truncatedObjects;
    if (s.maxDepth > maxDepth) maxDepth = s.maxDepth;
    for (const [k, v] of Object.entries(s.leafTypes)) {
      leafTypes[k] = (leafTypes[k] || 0) + v;
    }
  }
  out.maxDepth = maxDepth;
  return out;
}