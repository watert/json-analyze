// 同质 Record<string, object> 检测: 抽样 value + keys 指纹重合度
import isPlainObject from "lodash/isPlainObject.js";
import type { AnalyzeOptions } from "./types.js";

export interface RecordDetectOptions {
  recordSampleSize?: number;
  recordOverlapRatio?: number;
  recordMinValues?: number;
  recordDetect?: boolean;
}

export type RecordDetectConfig = Required<RecordDetectOptions>;

export const RECORD_DETECT_DEFAULTS: RecordDetectConfig = {
  recordSampleSize: 10,
  recordOverlapRatio: 0.5,
  recordMinValues: 8,
  recordDetect: true,
};

/** 非空 object 才参与抽样与 Jaccard */
const MIN_KEYS_FOR_SAMPLE = 2;

export function mergeRecordDetectOpts(opts: AnalyzeOptions): RecordDetectConfig {
  return { ...RECORD_DETECT_DEFAULTS, ...opts };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : inter / union;
}

/** 动态 entity id（数字 / 长串），区别于 users、answers 等固定 slice 名 */
export function isDynamicRecordKey(key: string): boolean {
  if (/^\d{10,}$/.test(key)) return true;
  if (/^\d+$/.test(key) && key.length >= 6) return true;
  return false;
}

/** Redux entities 下固定 slice 名（非 id map） */
const ENTITY_SLICE_KEYS = new Set([
  "users", "questions", "answers", "articles", "columns", "topics", "roundtables",
  "favlists", "comments", "notifications", "ebooks", "activities", "feeds", "pins",
  "promotions", "drafts", "chats", "posts", "zvideos", "eduCourses", "lineComments", "projects",
]);

/** 父级 key 多为 entities 固定 slice 时，不应折叠成 record */
export function looksLikeEntitySliceBag(objKeys: string[]): boolean {
  if (objKeys.length < 5) return false;
  const sliceLike = objKeys.filter((k) => ENTITY_SLICE_KEYS.has(k)).length;
  return sliceLike / objKeys.length >= 0.4;
}

function isNonemptyObject(v: unknown): v is object {
  if (!isPlainObject(v)) return false;
  return Object.keys(v as object).length >= MIN_KEYS_FOR_SAMPLE;
}

export function avgKeyOverlap(samples: object[]): number {
  const sets = samples.map((o) => new Set(Object.keys(o)));
  if (sets.length < 2) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      sum += jaccard(sets[i], sets[j]);
      n++;
    }
  }
  return sum / n;
}

/** 只从非空 object value 中均匀抽样 */
export function sampleObjectValues(obj: Record<string, unknown>, n: number): object[] {
  const entries = Object.entries(obj).filter(([, v]) => isNonemptyObject(v)) as [string, object][];
  if (entries.length === 0) return [];
  if (entries.length <= n) return entries.map(([, v]) => v);
  const out: object[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(entries.length - 1, Math.floor((i * entries.length) / n));
    out.push(entries[idx][1]);
  }
  return out;
}

export interface RecordDetectResult {
  samples: object[];
  overlap: number;
  keysCount: number;
  sampleKeys: string[];
}

export function detectHomogeneousRecord(
  obj: Record<string, unknown>,
  cfg: RecordDetectConfig
): RecordDetectResult | null {
  if (!cfg.recordDetect) return null;
  const entries = Object.entries(obj);
  const objectEntries = entries.filter(([, v]) => isPlainObject(v)) as [string, object][];
  const nonemptyEntries = objectEntries.filter(([, v]) => Object.keys(v).length >= MIN_KEYS_FOR_SAMPLE);
  if (nonemptyEntries.length < 2) return null;
  if (objectEntries.length / entries.length < 0.85) return null;

  const objKeys = objectEntries.map(([k]) => k);
  if (looksLikeEntitySliceBag(objKeys)) return null;

  const samples = sampleObjectValues(obj, cfg.recordSampleSize);
  if (samples.length < 2) return null;
  const overlap = avgKeyOverlap(samples);

  const count = nonemptyEntries.length;
  const minRequired =
    count >= cfg.recordMinValues
      ? cfg.recordMinValues
      : count >= 3 && overlap >= 0.9
        ? 3
        : cfg.recordMinValues;
  if (count < minRequired) return null;
  if (overlap < cfg.recordOverlapRatio) return null;

  return {
    samples,
    overlap,
    keysCount: objectEntries.length,
    sampleKeys: objectEntries.slice(0, 5).map(([k]) => k),
  };
}