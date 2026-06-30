// 摘要与压缩: summarizeSchema / compactSchema
import { getParent, splitPath, countPathDepth } from "./path-utils.js";
import type { FlatSchemaItem, AnalyzeSummary, PathSegment } from "./types.js";

/**
 * 从 schema 数组生成高层摘要，供 AI 先读摘要再决定钻哪。
 */
export function summarizeSchema(schema: FlatSchemaItem[]): AnalyzeSummary {
  const summary: AnalyzeSummary = {
    totalNodes: schema.length,
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

  for (const item of schema) {
    // 深度计算
    const depth = countPathDepth(item.path);
    if (depth > summary.maxDepth) summary.maxDepth = depth;

    switch (item.type) {
      case "array":
        summary.arraysCount++;
        if (item.comment === "empty array") summary.emptyArrays++;
        if (item.comment?.startsWith("truncated")) summary.truncatedArrays++;
        break;
      case "object":
        summary.objectsCount++;
        if (item.comment?.startsWith("truncated")) summary.truncatedObjects++;
        break;
      case "mixed":
        summary.mixedFields++;
        break;
      case "long-text":
        summary.longTextFields++;
        break;
      default:
        // 标量类型统计
        summary.leafTypes[item.type] = (summary.leafTypes[item.type] || 0) + 1;
    }
  }

  return summary;
}

/**
 * 将 schema 压缩为紧凑的类型字符串，如:
 * `root: { users: [ { id: number, name: string, tags: [string]?, active?: boolean } ] }`
 * 极省 token，适合直接嵌入 AI 上下文。
 */
export function compactSchema(schema: FlatSchemaItem[]): string {
  // 构建 path → children 映射
  const childrenMap = new Map<string, FlatSchemaItem[]>();
  for (const item of schema) {
    if (item.path === "root") continue;
    const parent = getParent(item.path);
    if (parent) {
      const list = childrenMap.get(parent) || [];
      list.push(item);
      childrenMap.set(parent, list);
    }
  }

  if (schema.length === 0) return "{}";
  return formatNode(schema[0], childrenMap);
}

function formatNode(node: FlatSchemaItem, childrenMap: Map<string, FlatSchemaItem[]>): string {
  if (node.type === "record") {
    const children = childrenMap.get(node.path) || [];
    const inner = children.map((ch) => formatField(ch, childrenMap));
    const n = node.keysCount ?? "?";
    const body = inner.length ? `{ ${inner.join(", ")} }` : "object";
    return `Record<string, ${body}> (${n} keys)`;
  }
  if (node.type === "object") {
    const children = childrenMap.get(node.path) || [];
    const fields = children.map((ch) => formatField(ch, childrenMap));
    return `{ ${fields.join(", ")} }`;
  }
  if (node.type === "array") {
    const children = childrenMap.get(node.path) || [];
    if (children.length === 0) return `[${typeFromItemTypes(node)}]`;
    // 合并子节点类型
    const innerTypes = children.map((ch) => formatField(ch, childrenMap));
    // 去重
    const unique = [...new Set(innerTypes)];
    return unique.length === 1 ? `[${unique[0]}]` : `[${unique.join(" | ")}]`;
  }
  return node.type;
}

function formatField(node: FlatSchemaItem, childrenMap: Map<string, FlatSchemaItem[]>): string {
  const segs = splitPath(node.path);
  const lastName = segs[segs.length - 1];
  const name = lastName.type === "key" && lastName.value
    ? lastName.value
    : lastName.type === "wildcard"
      ? "[]"
      : node.path;

  const optional = node.presence !== undefined && node.note?.includes("optional") ? "?" : "";
  const typeStr = node.type === "mixed"
    ? `mixed(${node.variants?.map((v) => v.type).join("|") ?? "?"})`
    : formatNode(node, childrenMap);

  return `${name}${optional}: ${typeStr}`;
}

function typeFromItemTypes(node: FlatSchemaItem): string {
  if (!node.itemTypes || node.itemTypes.length === 0) return "";
  if (node.itemTypes.length === 1) return node.itemTypes[0].type;
  return node.itemTypes.map((t) => t.type).join(" | ");
}
