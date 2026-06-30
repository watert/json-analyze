import { describe, expect, it } from "bun:test";
import { analyzeJSON } from "./analyzer.js";
import {
  detectHomogeneousRecord,
  avgKeyOverlap,
  mergeRecordDetectOpts,
  looksLikeEntitySliceBag,
  sampleObjectValues,
} from "./dict-record.js";
import { summarizeSchema, compactSchema } from "./summarize.js";

describe("dict-record", () => {
  it("avgKeyOverlap 同质 keys 高", () => {
    expect(avgKeyOverlap([{ id: 1, name: "x" }, { id: 2, name: "y" }])).toBe(1);
  });

  it("空 object 不参与抽样", () => {
    const bag: Record<string, object> = {
      users: { id: 1, name: "a", extra: 1 },
      answers: { id: 2, name: "b", extra: 2 },
      columns: {},
      topics: {},
      feeds: {},
      pins: {},
      drafts: {},
      chats: {},
      posts: {},
    };
    const samples = sampleObjectValues(bag, 10);
    expect(samples.every((s) => Object.keys(s).length >= 2)).toBe(true);
    expect(avgKeyOverlap(samples)).toBe(1);
    expect(looksLikeEntitySliceBag(["users", "questions", "answers", "articles", "columns"])).toBe(true);
    expect(detectHomogeneousRecord(bag, mergeRecordDetectOpts({}))).toBeNull();
  });

  it("动态 id map 可判定 record", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 30; i++) obj[`${2049300181053714940 + i}`] = { id: i, name: `n${i}` };
    const r = detectHomogeneousRecord(obj, mergeRecordDetectOpts({}));
    expect(r?.keysCount).toBe(30);
  });

  it("analyzeJSON 不逐 id 展开", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 30; i++) obj[`204930018105371494${i}`] = { id: i, name: `n${i}` };
    const schema = analyzeJSON({ answers: obj });
    expect(schema.find((s) => s.path === "root.answers" && s.type === "record")).toBeDefined();
    expect(schema.filter((s) => /^root\.answers\.204/.test(s.path)).length).toBe(0);
    expect(schema.find((s) => s.path === "root.answers[].id")).toBeDefined();
    expect(summarizeSchema(schema).totalNodes).toBeLessThan(50);
    expect(compactSchema(schema)).toContain("Record<string");
  });
});