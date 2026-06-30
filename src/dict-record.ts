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

export function sampleObjectValues(obj: Record<string, unknown>, n: number): object[] {
  const entries = Object.entries(obj).filter(([, v]) => isPlainObject(v)) as [string, object][];
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
  if (objectEntries.length < cfg.recordMinValues) return null;
  if (objectEntries.length / entries.length < 0.85) return null;

  const samples = sampleObjectValues(obj, cfg.recordSampleSize);
  if (samples.length < 2) return null;
  const overlap = avgKeyOverlap(samples);
  if (overlap < cfg.recordOverlapRatio) return null;

  return {
    samples,
    overlap,
    keysCount: objectEntries.length,
    sampleKeys: objectEntries.slice(0, 5).map(([k]) => k),
  };
}