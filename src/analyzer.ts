// JSON Schema Analyzer 核心实现
// v2: 循环引用检测、规模控制、非标准JSON类型、路径转义
import dayjs from "dayjs";
import isPlainObject from "lodash/isPlainObject.js";
import { appendPathKey, appendArrayFieldKey, appendInnerArray } from "./path-utils.js";
import type { FlatSchemaItem, ItemTypeEntry, VariantEntry, AnalyzeOptions } from "./types.js";

const DEFAULTS: Required<AnalyzeOptions> = {
  maxDepth: 32,
  maxArrayItems: 5000,
  maxKeysPerObject: 500,
  sampleCount: 3,
};

/** 将任意 JSON 数据转换为扁平化 schema 数组 */
export function analyzeJSON(data: any, opts: AnalyzeOptions = {}): FlatSchemaItem[] {
  const { maxDepth, maxArrayItems, maxKeysPerObject, sampleCount } = { ...DEFAULTS, ...opts };
  const result: FlatSchemaItem[] = [];
  const seen = new Set<object>();
  analyzeValue(data, "root", result, seen, 0, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
  return result;
}

/** 递归分析单个值 */
function analyzeValue(
  value: any,
  path: string,
  result: FlatSchemaItem[],
  seen: Set<object>,
  depth: number,
  maxDepth: number,
  maxArrayItems: number,
  maxKeysPerObject: number,
  sampleCount: number
) {
  if (depth > maxDepth) {
    result.push({ path, type: typeof value, sampleValue: inlineRepr(value), comment: "max depth reached" });
    return;
  }

  // 循环引用检测
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      result.push({ path, type: "circular", comment: "circular reference" });
      return;
    }
    seen.add(value);
  }

  if (Array.isArray(value)) {
    const node = createArrayNode(value, path, sampleCount, maxArrayItems);
    result.push(node);

    if (value.length > 0) {
      const slice = value.length > maxArrayItems ? value.slice(0, maxArrayItems) : value;
      const truncated = value.length > maxArrayItems;
      if (truncated) node.comment = `truncated (${value.length} items → sampled ${maxArrayItems})`;

      // 展开数组内的对象字段
      const objects = slice.filter(isPlainObject);
      if (objects.length > 0) {
        processArrayObjects(objects, path, result, seen, depth, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
      }

      // 展开数组内的嵌套数组
      const arrays = slice.filter(Array.isArray) as any[][];
      if (arrays.length > 0) {
        processArrayArrays(arrays, path, result, seen, depth, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
      }
    }
  } else if (isPlainObject(value)) {
    const allKeys = Object.keys(value);
    const truncKeys = allKeys.length > maxKeysPerObject;
    const keys = truncKeys ? allKeys.slice(0, maxKeysPerObject) : allKeys;
    const node: FlatSchemaItem = { path, type: "object", keys };
    if (truncKeys) node.comment = `truncated keys (${allKeys.length} → ${maxKeysPerObject})`;
    result.push(node);

    for (const key of keys) {
      analyzeValue(value[key], appendPathKey(path, key), result, seen, depth + 1, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
    }
  } else {
    // 标量 / 非标准类型叶子节点
    const { type, sampleValue, longText, originalLength } = analyzeScalar(value, sampleCount);
    const node: FlatSchemaItem = { path, type, sampleValue };
    if (longText) {
      node.longText = true;
      node.originalLength = originalLength;
    }
    result.push(node);
  }
}

/** 构造数组节点 (itemTypes 统计) */
function createArrayNode(value: any[], path: string, sampleCount: number, _maxItems: number): FlatSchemaItem {
  const node: FlatSchemaItem = { path, type: "array" };

  if (value.length === 0) {
    node.comment = "empty array";
    node.itemTypes = [];
    return node;
  }

  node.itemTypes = collectItemTypes(value, sampleCount);
  return node;
}

/** 统计数组元素的类型分布，收集样本 */
function collectItemTypes(items: any[], sampleCount: number): ItemTypeEntry[] {
  const map = new Map<string, { count: number; samples: any[] }>();
  for (const item of items) {
    const t = getRawType(item);
    const entry = map.get(t) ?? { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < sampleCount && shouldCollectSample(t)) {
      entry.samples.push(item);
    }
    map.set(t, entry);
  }
  return Array.from(map.entries()).map(([type, data]) => {
    const entry: ItemTypeEntry = { type, count: data.count };
    if (data.samples.length > 0) entry.samples = data.samples;
    return entry;
  });
}

/** 处理数组内所有对象的字段展开 */
function processArrayObjects(
  objects: any[],
  path: string,
  result: FlatSchemaItem[],
  seen: Set<object>,
  depth: number,
  maxDepth: number,
  maxArrayItems: number,
  maxKeysPerObject: number,
  sampleCount: number
) {
  const allKeys = new Set<string>();
  for (const obj of objects) {
    Object.keys(obj).forEach((k) => allKeys.add(k));
  }

  for (const key of allKeys) {
    const fieldPath = appendArrayFieldKey(path, key);
    const fieldValues = objects
      .filter((obj) => key in obj)
      .map((obj) => obj[key]);
    const presence = fieldValues.length;
    const total = objects.length;

    // 注意: 从 seen 中暂时移除当前值避免嵌套对象/数组被误判循环
    // 实际做法: analyzeMergedValues 内部会正确递归
    const types = new Set(fieldValues.map(getRawType));
    if (types.size > 1) {
      pushMixedNode(fieldValues, fieldPath, presence, total, result, sampleCount);
    } else {
      analyzeMergedValues(fieldValues, fieldPath, result, seen, depth, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount, presence, total);
    }
  }
}

/** 处理数组内的嵌套数组 */
function processArrayArrays(
  arrays: any[][],
  path: string,
  result: FlatSchemaItem[],
  seen: Set<object>,
  depth: number,
  maxDepth: number,
  maxArrayItems: number,
  maxKeysPerObject: number,
  sampleCount: number
) {
  const allItems = arrays.flat();
  const innerPath = appendInnerArray(path);
  const node: FlatSchemaItem = { path: innerPath, type: "array", note: "inner array" };

  if (allItems.length === 0) {
    node.comment = "empty array";
    node.itemTypes = [];
  } else {
    node.itemTypes = collectItemTypes(allItems, sampleCount);

    const innerObjects = allItems.filter(isPlainObject);
    if (innerObjects.length > 0) {
      processArrayObjects(innerObjects, innerPath, result, seen, depth + 1, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
    }

    const innerArrays = allItems.filter(Array.isArray) as any[][];
    if (innerArrays.length > 0) {
      processArrayArrays(innerArrays, innerPath, result, seen, depth + 1, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
    }
  }

  result.push(node);
}

/** 处理同类型多值(对象/数组/标量)的合并分析，附加 presence/note */
function analyzeMergedValues(
  values: any[],
  path: string,
  result: FlatSchemaItem[],
  seen: Set<object>,
  depth: number,
  maxDepth: number,
  maxArrayItems: number,
  maxKeysPerObject: number,
  sampleCount: number,
  presence: number,
  total: number
) {
  const firstValue = values[0];
  const type = getRawType(firstValue);
  const note = buildNote(presence, total);

  if (type === "object") {
    // 循环引用检测
    if (values.some((v) => typeof v === "object" && v !== null && seen.has(v))) {
      result.push({ path, type: "circular", presence, note, comment: "circular reference in merged values" });
      return;
    }

    const allKeys = new Set<string>();
    for (const obj of values) {
      if (isPlainObject(obj)) Object.keys(obj).forEach((k) => allKeys.add(k));
    }

    const keysArr = Array.from(allKeys);
    const truncKeys = keysArr.length > maxKeysPerObject;
    const keys = truncKeys ? keysArr.slice(0, maxKeysPerObject) : keysArr;
    const objNode: FlatSchemaItem = { path, type: "object", keys, presence, note };
    if (truncKeys) objNode.comment = `truncated keys (${keysArr.length} → ${maxKeysPerObject})`;
    result.push(objNode);

    for (const key of keys) {
      const fieldPath = appendPathKey(path, key);
      const fieldValues = values
        .filter((v) => isPlainObject(v) && key in v)
        .map((v) => v[key]);
      const fieldPresence = fieldValues.length;
      const fieldTypes = new Set(fieldValues.map(getRawType));
      if (fieldTypes.size > 1) {
        pushMixedNode(fieldValues, fieldPath, fieldPresence, values.length, result, sampleCount);
      } else {
        analyzeMergedValues(fieldValues, fieldPath, result, seen, depth + 1, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount, fieldPresence, values.length);
      }
    }
  } else if (type === "array") {
    const node: FlatSchemaItem = { path, type: "array", presence, note };
    const allItems = values.filter(Array.isArray).flat();

    if (allItems.length === 0) {
      node.comment = "empty array";
      node.itemTypes = [];
    } else {
      node.itemTypes = collectItemTypes(allItems, sampleCount);

      const innerObjects = allItems.filter(isPlainObject);
      if (innerObjects.length > 0) {
        processArrayObjects(innerObjects, appendInnerArray(path), result, seen, depth + 1, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
      }

      const innerArrays = allItems.filter(Array.isArray) as any[][];
      if (innerArrays.length > 0) {
        processArrayArrays(innerArrays, appendInnerArray(path), result, seen, depth + 1, maxDepth, maxArrayItems, maxKeysPerObject, sampleCount);
      }
    }

    result.push(node);
  } else {
    // 标量
    const { type, sampleValue, longText, originalLength } = analyzeScalar(firstValue, sampleCount);
    const node: FlatSchemaItem = { path, type, sampleValue, presence, note };
    if (longText) {
      node.longText = true;
      node.originalLength = originalLength;
    }
    result.push(node);
  }
}

/** 生成 mixed 节点 */
function pushMixedNode(
  values: any[],
  path: string,
  presence: number,
  total: number,
  result: FlatSchemaItem[],
  sampleCount: number
) {
  const map = new Map<string, { count: number; samples: any[] }>();
  for (const v of values) {
    const t = getRawType(v);
    const entry = map.get(t) ?? { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < sampleCount && shouldCollectSample(t)) {
      entry.samples.push(v);
    }
    map.set(t, entry);
  }

  const variants: VariantEntry[] = Array.from(map.entries()).map(([type, data]) => {
    const entry: VariantEntry = { type, count: data.count };
    if (data.samples.length > 0) entry.samples = data.samples;
    return entry;
  });

  result.push({
    path,
    type: "mixed",
    sampleValue: values[0],
    presence,
    note: buildNote(presence, total),
    variants,
  });
}

/** 标量分析：日期识别、长文本截断、非标准类型 */
function analyzeScalar(value: any, _sampleCount: number): {
  type: string;
  sampleValue: any;
  longText?: boolean;
  originalLength?: number;
} {
  if (value === null) return { type: "null", sampleValue: null };
  if (value === undefined) return { type: "undefined", sampleValue: null };
  if (typeof value === "boolean") return { type: "boolean", sampleValue: value };
  if (typeof value === "number") return { type: "number", sampleValue: value };
  if (typeof value === "bigint") return { type: "bigint", sampleValue: String(value) };
  if (typeof value === "symbol") return { type: "symbol", sampleValue: value.toString() };

  // Date 对象
  if (value instanceof Date) {
    return { type: "date-object", sampleValue: value.toISOString() };
  }

  // string
  const str = value as string;

  // 日期识别约束：长度>=8 且含日期分隔符
  // 日期识别: 至少 4-2-2 格式 + dayjs 校验, 避免 "1234-5678" 误判
  if (str.length >= 8 && /[-/T\s]/.test(str) && /^\d{4}-\d{2}-\d{2}/.test(str) && dayjs(str).isValid()) {
    return { type: "date", sampleValue: str };
  }

  // 长文本截断
  if (str.length > 60) {
    const truncated =
      str.slice(0, 30) + `...(${str.length - 60} chars)...` + str.slice(-30);
    return {
      type: "long-text",
      sampleValue: truncated,
      longText: true,
      originalLength: str.length,
    };
  }

  return { type: "string", sampleValue: str };
}

/** 获取原始类型(不做日期/长文本细分，含非标准类型) */
function getRawType(value: any): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date-object";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (isPlainObject(value)) return "object";
  return typeof value;
}

/** 判断是否应收集样本(标量/日期/长文本/date-object/bigint) */
function shouldCollectSample(type: string): boolean {
  return ["string", "number", "boolean", "date", "long-text", "date-object", "bigint"].includes(type);
}

/** 构建 note 文本 */
function buildNote(presence: number, total: number): string {
  return presence < total
    ? `present in ${presence}/${total} objects (optional)`
    : `present in ${presence}/${total} objects`;
}

/** 非标准类型的简短表示（用于 maxDepth 截断时） */
function inlineRepr(value: any): any {
  if (value === null) return null;
  if (value === undefined) return "undefined";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return `[array: ${value.length} items]`;
  if (isPlainObject(value)) return `{object: ${Object.keys(value).length} keys}`;
  return String(value);
}
