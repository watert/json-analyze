import { describe, expect, it } from "bun:test";
import { analyzeJSON } from "./analyzer.js";
import { detectHomogeneousRecord, avgKeyOverlap, mergeRecordDetectOpts } from "./dict-record.js";
import { summarizeSchema, compactSchema } from "./summarize.js";

describe("dict-record", () => {
  it("avgKeyOverlap 同质 keys 高", () => {
    expect(avgKeyOverlap([{ id: 1, name: "x" }, { id: 2, name: "y" }])).toBe(1);
  });

  it("detectHomogeneousRecord 小对象不触发", () => {
    expect(detectHomogeneousRecord({ a: { x: 1 }, b: { x: 2 } }, mergeRecordDetectOpts({ recordMinValues: 8 }))).toBeNull();
  });

  it("analyzeJSON 不逐 id 展开", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 30; i++) obj[`k${i}`] = { id: i, name: `n${i}` };
    const schema = analyzeJSON({ entities: obj });
    expect(schema.find((s) => s.path === "root.entities" && s.type === "record")).toBeDefined();
    expect(schema.filter((s) => /^root\.entities\.k\d+$/.test(s.path)).length).toBe(0);
    expect(schema.find((s) => s.path === "root.entities[].id")).toBeDefined();
    expect(summarizeSchema(schema).totalNodes).toBeLessThan(50);
    expect(compactSchema(schema)).toContain("Record<string");
  });
});