import { describe, expect, it } from "vitest";
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
    for (let i = 0; i < 30; i++) obj[`204930018105371494${String(i).padStart(2, "0")}`] = { id: i, name: `n${i}` };
    const r = detectHomogeneousRecord(obj, mergeRecordDetectOpts({}));
    expect(r?.keysCount).toBe(30);
  });

  it("小样本高 overlap 可判定 record (>=3)", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 5; i++) obj[`205423555002289833${i}`] = { id: String(i), type: "article", title: `t${i}`, excerpt: "x" };
    const r = detectHomogeneousRecord(obj, mergeRecordDetectOpts({}));
    expect(r?.keysCount).toBe(5);
    expect(r!.overlap).toBeGreaterThan(0.9);
  });

  it("analyzeJSON 不逐 id 展开", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 30; i++) obj[`204930018105371494${String(i).padStart(2, "0")}`] = { id: i, name: `n${i}` };
    const schema = analyzeJSON({ answers: obj });
    expect(schema.find((s) => s.path === "root.answers" && s.type === "record")).toBeDefined();
    expect(schema.filter((s) => /^root\.answers\.204/.test(s.path)).length).toBe(0);
    expect(schema.find((s) => s.path === "root.answers[].id")).toBeDefined();
    expect(summarizeSchema(schema).totalNodes).toBeLessThan(50);
    expect(compactSchema(schema)).toContain("Record<string");
  });

  it("小样本 record: articles / users 不逐 id 展开", () => {
    // 原 629 fixture 依赖 ~/docs 真实文件, 改为同构内联数据 (articles 5 篇小样本, users 11 常规)
    const articles: Record<string, object> = {};
    for (let i = 0; i < 5; i++) articles[`${i}`] = { id: i, title: `t${i}`, excerpt: `e${i}`, content: `c${i}`, url_token: `a${i}` };
    const users: Record<string, object> = {};
    for (let i = 0; i < 11; i++) users[`${10000000 + i}`] = { id: i, name: `n${i}`, url_token: `u${i}` };
    const data = { entities: { articles, users, answers: { a1: { id: 1, n: "x" } } } };
    const schema = analyzeJSON(data);
    expect(schema.find((s) => s.path === "root.entities.articles" && s.type === "record")).toBeDefined();
    expect(schema.filter((s) => /^root\.entities\.articles\.\d+/.test(s.path)).length).toBe(0);
    expect(schema.find((s) => s.path === "root.entities.users" && s.type === "record")).toBeDefined();
  });
});