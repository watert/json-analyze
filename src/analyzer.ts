// JSON Schema Analyzer 核心实现
import dayjs from "dayjs";
import isPlainObject from "lodash/isPlainObject.js";
import {
  createAnalyzeWalkCtx,
  type WalkArrayArraysParams,
  type WalkArrayObjectsParams,
  type WalkMergedValuesParams,
  type WalkMixedParams,
  type WalkValueParams,
} from "./analyzer-walk.js";
import { appendPathKey, appendArrayFieldKey, appendInnerArray } from "./path-utils.js";
import { detectHomogeneousRecord, mergeObjectSamplesToBag } from "./dict-record.js";
import type { FlatSchemaItem, ItemTypeEntry, VariantEntry, AnalyzeOptions } from "./types.js";

/** 将任意 JSON 数据转换为扁平化 schema 数组 */
export function analyzeJSON(data: unknown, opts: AnalyzeOptions = {}): FlatSchemaItem[] {
  const ctx = createAnalyzeWalkCtx(opts);
  walkValue({ ctx, value: data, path: "root", depth: 0 });
  return ctx.result;
}

function walkValue({ ctx, value, path, depth = 0 }: WalkValueParams): void {
  const { maxDepth, maxArrayItems, maxKeysPerObject, sampleCount, recordCfg, result, seen } = ctx;

  if (depth > maxDepth) {
    result.push({ path, type: typeof value, sampleValue: inlineRepr(value), comment: "max depth reached" });
    return;
  }

  if (value && typeof value === "object") {
    if (seen.has(value as object)) {
      result.push({ path, type: "circular", comment: "circular reference" });
      return;
    }
    seen.add(value as object);
  }

  if (Array.isArray(value)) {
    const node = createArrayNode(value, path, sampleCount, maxArrayItems);
    result.push(node);

    if (value.length > 0) {
      const slice = value.length > maxArrayItems ? value.slice(0, maxArrayItems) : value;
      if (value.length > maxArrayItems) node.comment = `truncated (${value.length} items → sampled ${maxArrayItems})`;

      const objects = slice.filter(isPlainObject) as object[];
      if (objects.length > 0) walkArrayObjects({ ctx, objects, path, depth });

      const arrays = slice.filter(Array.isArray) as unknown[][];
      if (arrays.length > 0) walkArrayArrays({ ctx, arrays, path, depth });
    }
    return;
  }

  if (isPlainObject(value)) {
    const recordHit = detectHomogeneousRecord(value as Record<string, unknown>, recordCfg);
    if (recordHit) {
      result.push({
        path,
        type: "record",
        keysCount: recordHit.keysCount,
        sampleKeys: recordHit.sampleKeys,
        recordOverlap: recordHit.overlap,
        itemTypes: [{ type: "object", count: recordHit.keysCount }],
        comment: `homogeneous record (sampled ${recordHit.samples.length}, keys overlap ${(recordHit.overlap * 100).toFixed(0)}%)`,
      });
      if (recordHit.scalarValueType) {
        result.push({
          path: appendArrayFieldKey(path, recordHit.scalarValueType),
          type: recordHit.scalarValueType,
          comment: `record scalar field (homogeneous)`,
        });
      } else {
        walkArrayObjects({ ctx, objects: recordHit.samples as object[], path, depth });
      }
      return;
    }

    const allKeys = Object.keys(value as object);
    const truncKeys = allKeys.length > maxKeysPerObject;
    const keys = truncKeys ? allKeys.slice(0, maxKeysPerObject) : allKeys;
    const node: FlatSchemaItem = { path, type: "object", keys };
    if (truncKeys) node.comment = `truncated keys (${allKeys.length} → ${maxKeysPerObject})`;
    result.push(node);

    for (const key of keys) {
      walkValue({ ctx, value: (value as Record<string, unknown>)[key], path: appendPathKey(path, key), depth: depth + 1 });
    }
    return;
  }

  const { type, sampleValue, longText, originalLength } = analyzeScalar(value, sampleCount);
  const node: FlatSchemaItem = { path, type, sampleValue };
  if (longText) {
    node.longText = true;
    node.originalLength = originalLength;
  }
  result.push(node);
}

function walkArrayObjects({ ctx, objects, path, depth }: WalkArrayObjectsParams): void {
  const allKeys = new Set<string>();
  for (const obj of objects) Object.keys(obj).forEach((k) => allKeys.add(k));

  for (const key of allKeys) {
    const fieldPath = appendArrayFieldKey(path, key);
    const fieldValues = objects.filter((obj) => key in obj).map((obj) => (obj as Record<string, unknown>)[key]);
    const presence = fieldValues.length;
    const total = objects.length;
    const types = new Set(fieldValues.map(getRawType));
    if (types.size > 1) {
      walkMixed({ ctx, values: fieldValues, path: fieldPath, presence, total });
    } else {
      walkMergedValues({ ctx, values: fieldValues, path: fieldPath, depth, presence, total });
    }
  }
}

function walkArrayArrays({ ctx, arrays, path, depth }: WalkArrayArraysParams): void {
  const { sampleCount } = ctx;
  const allItems = arrays.flat();
  const innerPath = appendInnerArray(path);
  const node: FlatSchemaItem = { path: innerPath, type: "array", note: "inner array" };

  if (allItems.length === 0) {
    node.comment = "empty array";
    node.itemTypes = [];
  } else {
    node.itemTypes = collectItemTypes(allItems, sampleCount);
    const innerObjects = allItems.filter(isPlainObject);
    if (innerObjects.length > 0) walkArrayObjects({ ctx, objects: innerObjects as object[], path: innerPath, depth: depth + 1 });
    const innerArrays = allItems.filter(Array.isArray) as unknown[][];
    if (innerArrays.length > 0) walkArrayArrays({ ctx, arrays: innerArrays, path: innerPath, depth: depth + 1 });
  }
  ctx.result.push(node);
}

function walkMergedValues({ ctx, values, path, depth, presence, total }: WalkMergedValuesParams): void {
  const { maxDepth, maxArrayItems, maxKeysPerObject, sampleCount, result, seen } = ctx;
  const firstValue = values[0];
  const type = getRawType(firstValue);
  const note = buildNote(presence, total);

  if (type === "object") {
    if (values.some((v) => typeof v === "object" && v !== null && seen.has(v as object))) {
      result.push({ path, type: "circular", presence, note, comment: "circular reference in merged values" });
      return;
    }

    const plain = values.filter(isPlainObject) as object[];
    const mergedBag = mergeObjectSamplesToBag(plain);
    const recordHit = detectHomogeneousRecord(mergedBag, ctx.recordCfg);
    if (recordHit && Object.keys(mergedBag).length >= 2) {
      result.push({
        path,
        type: "record",
        keysCount: recordHit.keysCount,
        sampleKeys: recordHit.sampleKeys,
        recordOverlap: recordHit.overlap,
        presence,
        note,
        itemTypes: [{ type: "object", count: recordHit.keysCount }],
        comment: `homogeneous record (merged ${plain.length} samples, keys overlap ${(recordHit.overlap * 100).toFixed(0)}%)`,
      });
      walkArrayObjects({ ctx, objects: recordHit.samples as object[], path, depth });
      return;
    }

    const allKeys = new Set<string>();
    for (const obj of plain) Object.keys(obj as object).forEach((k) => allKeys.add(k));
    const keysArr = Array.from(allKeys);
    const truncKeys = keysArr.length > maxKeysPerObject;
    const keys = truncKeys ? keysArr.slice(0, maxKeysPerObject) : keysArr;
    const objNode: FlatSchemaItem = { path, type: "object", keys, presence, note };
    if (truncKeys) objNode.comment = `truncated keys (${keysArr.length} → ${maxKeysPerObject})`;
    result.push(objNode);

    for (const key of keys) {
      const fieldPath = appendPathKey(path, key);
      const fieldValues = values.filter((v) => isPlainObject(v) && key in (v as object)).map((v) => (v as Record<string, unknown>)[key]);
      const fieldPresence = fieldValues.length;
      if (new Set(fieldValues.map(getRawType)).size > 1) {
        walkMixed({ ctx, values: fieldValues, path: fieldPath, presence: fieldPresence, total: values.length });
      } else {
        walkMergedValues({ ctx, values: fieldValues, path: fieldPath, depth: depth + 1, presence: fieldPresence, total: values.length });
      }
    }
    return;
  }

  if (type === "array") {
    const node: FlatSchemaItem = { path, type: "array", presence, note };
    const allItems = values.filter(Array.isArray).flat();
    if (allItems.length === 0) {
      node.comment = "empty array";
      node.itemTypes = [];
    } else {
      node.itemTypes = collectItemTypes(allItems, sampleCount);
      const innerObjects = allItems.filter(isPlainObject);
      if (innerObjects.length > 0) walkArrayObjects({ ctx, objects: innerObjects, path: appendInnerArray(path), depth: depth + 1 });
      const innerArrays = allItems.filter(Array.isArray) as unknown[][];
      if (innerArrays.length > 0) walkArrayArrays({ ctx, arrays: innerArrays, path: appendInnerArray(path), depth: depth + 1 });
    }
    result.push(node);
    return;
  }

  const scalar = analyzeScalar(firstValue, sampleCount);
  const node: FlatSchemaItem = { path, type: scalar.type, sampleValue: scalar.sampleValue, presence, note };
  if (scalar.longText) {
    node.longText = true;
    node.originalLength = scalar.originalLength;
  }
  result.push(node);
}

function walkMixed({ ctx, values, path, presence, total }: WalkMixedParams): void {
  const { sampleCount, result } = ctx;
  const map = new Map<string, { count: number; samples: unknown[] }>();
  for (const v of values) {
    const t = getRawType(v);
    const entry = map.get(t) ?? { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < sampleCount && shouldCollectSample(t)) entry.samples.push(v);
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

function createArrayNode(value: unknown[], path: string, sampleCount: number, maxItems: number): FlatSchemaItem {
  const node: FlatSchemaItem = { path, type: "array" };
  if (value.length === 0) {
    node.comment = "empty array";
    node.itemTypes = [];
    return node;
  }
  node.itemTypes = collectItemTypes(value, sampleCount);
  if (value.length > maxItems) node.comment = `truncated (${value.length} items → sampled ${maxItems})`;
  return node;
}

function collectItemTypes(items: unknown[], sampleCount: number): ItemTypeEntry[] {
  const map = new Map<string, { count: number; samples: unknown[] }>();
  for (const item of items) {
    const t = getRawType(item);
    const entry = map.get(t) ?? { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < sampleCount && shouldCollectSample(t)) entry.samples.push(item);
    map.set(t, entry);
  }
  return Array.from(map.entries()).map(([type, data]) => {
    const entry: ItemTypeEntry = { type, count: data.count };
    if (data.samples.length > 0) entry.samples = data.samples;
    return entry;
  });
}

function analyzeScalar(value: unknown, _sampleCount: number): {
  type: string;
  sampleValue: unknown;
  longText?: boolean;
  originalLength?: number;
} {
  if (value === null) return { type: "null", sampleValue: null };
  if (value === undefined) return { type: "undefined", sampleValue: null };
  if (typeof value === "boolean") return { type: "boolean", sampleValue: value };
  if (typeof value === "number") return { type: "number", sampleValue: value };
  if (typeof value === "bigint") return { type: "bigint", sampleValue: String(value) };
  if (typeof value === "symbol") return { type: "symbol", sampleValue: value.toString() };
  if (value instanceof Date) return { type: "date-object", sampleValue: value.toISOString() };

  const str = value as string;
  if (str.length >= 8 && /[-/T\s]/.test(str) && /^\d{4}-\d{2}-\d{2}/.test(str) && dayjs(str).isValid()) {
    return { type: "date", sampleValue: str };
  }
  if (str.length > 60) {
    return {
      type: "long-text",
      sampleValue: str.slice(0, 30) + `...(${str.length - 60} chars)...` + str.slice(-30),
      longText: true,
      originalLength: str.length,
    };
  }
  return { type: "string", sampleValue: str };
}

function getRawType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date-object";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (isPlainObject(value)) return "object";
  return typeof value;
}

function shouldCollectSample(type: string): boolean {
  return ["string", "number", "boolean", "date", "long-text", "date-object", "bigint"].includes(type);
}

function buildNote(presence: number, total: number): string {
  return presence < total
    ? `present in ${presence}/${total} objects (optional)`
    : `present in ${presence}/${total} objects`;
}

function inlineRepr(value: unknown): unknown {
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