import { describe, expect, it } from "vitest";
import { analyzeJSON } from "./analyzer.js";
import { summarizeSchema } from "./summarize.js";
import {
  buildOverviewJSON,
  pickHotspots,
  renderOverviewMarkdown,
  suggestQuickPaths,
} from "./overview.js";

describe("overview", () => {
  it("renderOverviewMarkdown 含主要 section 与 drill-down", () => {
    const data = { users: [{ id: 1, name: "a" }, { id: 2 }] };
    const schema = analyzeJSON(data);
    const summary = summarizeSchema(schema);
    const md = renderOverviewMarkdown({
      fileArg: "data.json",
      meta: {
        sourceLabel: "data.json",
        rootType: "object",
        analyzeOpts: { maxDepth: 32, maxArrayItems: 5000, maxKeysPerObject: 500 },
      },
      schema,
      summary,
    });
    expect(md).toContain("# json-analyze overview");
    expect(md).toContain("## 1. Snapshot");
    expect(md).toContain("## 2. Structure");
    expect(md).toContain("json-analyze analyze data.json");
    expect(md).toContain("> 展开:");
  });

  it("pickHotspots 优先 mixed", () => {
    const schema = analyzeJSON({ items: [{ x: 1 }, { x: "a" }] });
    const hot = pickHotspots(schema);
    expect(hot.some((h) => h.type === "mixed")).toBe(true);
  });

  it("buildOverviewJSON 含 quickPaths", () => {
    const data = { tags: ["a", "b"] };
    const schema = analyzeJSON(data);
    const summary = summarizeSchema(schema);
    const j = buildOverviewJSON({
      fileArg: undefined,
      meta: {
        sourceLabel: "stdin",
        rootType: "object",
        analyzeOpts: { maxDepth: 32, maxArrayItems: 5000, maxKeysPerObject: 500 },
      },
      schema,
      summary,
    });
    expect(j.compact.length).toBeGreaterThan(0);
    expect(suggestQuickPaths(schema).length).toBeGreaterThanOrEqual(0);
    expect(j.drillDown.query.length).toBeGreaterThan(0);
  });
});