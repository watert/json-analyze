import { describe, expect, it } from "vitest";
import { analyzeJSON } from "./analyzer.js";
import { finalizePreamble, pickHeaviestPaths, renderAnalyzePreamble } from "./analyze-preamble.js";

describe("analyze-preamble", () => {
  it("record 大 map 排在前列", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 30; i++) obj[`id${i}`] = { id: i, name: `n${i}` };
    const schema = analyzeJSON({ users: obj, id: 1 });
    const top = pickHeaviestPaths(schema, 5);
    expect(top[0].item.path).toBe("root.users");
  });

  it("preamble 含 Top paths 与分隔线", () => {
    const schema = analyzeJSON({ a: { b: 1 } });
    const md = finalizePreamble(renderAnalyzePreamble(schema, { top: 3 }), "");
    expect(md).toContain("## Analyze summary");
    expect(md).toContain("Top");
    expect(md).toContain("---");
  });
});
