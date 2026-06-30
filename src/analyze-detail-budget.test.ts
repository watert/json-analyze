import { describe, expect, it } from "bun:test";
import { analyzeJSON } from "./analyzer.js";
import { filterSchemaByPathPrefix, planDetailBudget } from "./analyze-detail-budget.js";
import { renderGroupedFlatMarkdown } from "./format-grouped.js";

describe("analyze-detail-budget", () => {
  it("超预算时输出含 digest 与 drill", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 40; i++) obj[`id${i}`] = { id: i, name: `n${i}`, bio: "x".repeat(50) };
    const schema = analyzeJSON({ users: obj, meta: { a: 1 } });
    const out = renderGroupedFlatMarkdown(schema, {
      maxDetailBytes: 400,
      drillFile: "data.json",
      sourceLabel: "data.json",
      top: 3,
    });
    expect(out).toContain("<record-digest");
    expect(out).toContain("## Compressed groups (digest)");
    expect(out).toContain("--path-prefix");
    expect(out).not.toContain('digest="true"');
  });

  it("filterSchemaByPathPrefix", () => {
    const schema = analyzeJSON({ users: { a: { id: 1 } } });
    const sub = filterSchemaByPathPrefix(schema, "root.users");
    expect(sub.some((s) => s.path === "root.users")).toBe(true);
    expect(sub.every((s) => s.path.startsWith("root.users"))).toBe(true);
  });

  it("planDetailBudget 未超则不 digest", () => {
    const schema = analyzeJSON({ id: 1 });
    const plan = planDetailBudget([], schema, new Map(), 100, 50, 10_000, "f.json");
    expect(plan.overBudget).toBe(false);
  });
});