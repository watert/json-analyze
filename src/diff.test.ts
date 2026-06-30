import { describe, expect, it } from "bun:test";
import { diffJSON, diffWalk } from "./diff.js";

describe("diff", () => {
  it("dict key 增减", () => {
    const left = { entities: { answers: { a1: { id: "a1" }, a2: { id: "a2" } } } };
    const right = { entities: { answers: { a2: { id: "a2" }, a3: { id: "a3" } } } };
    const events = diffWalk(left, right, { pathPrefix: "root.entities.answers", dictKeyOnly: true, ignorePathGlobs: [] });
    expect(events.some((e) => e.kind === "keyRemoved" && e.key === "a1")).toBe(true);
    expect(events.some((e) => e.kind === "keyAdded" && e.key === "a3")).toBe(true);
  });

  it("标量 valueChanged", () => {
    const left = { loading: { global: { count: 2 } } };
    const right = { loading: { global: { count: 0 } } };
    const events = diffWalk(left, right, { ignorePathGlobs: [], valueDepth: 6 });
    expect(events.some((e) => e.kind === "valueChanged" && e.path.includes("count"))).toBe(true);
  });

  it("long-text 按长度比较", () => {
    const left = { x: { content: "a".repeat(100) } };
    const right = { x: { content: "b".repeat(100) } };
    const events = diffWalk(left, right, { ignorePathGlobs: [], valueDepth: 4 });
    expect(events.filter((e) => e.path.endsWith("content")).length).toBe(0);
  });

  it("md 输出含 summary", () => {
    const out = diffJSON({ a: 1 }, { a: 2 }, {
      leftFile: "l.json",
      rightFile: "r.json",
      ignorePaths: "",
      format: "md",
      maxChanges: 50,
    }) as string;
    expect(out).toContain("## 2. Summary");
    expect(out).toContain("diff-change");
  });

  it("超预算 digest", () => {
    const mk = (n: number, prefix: string) => {
      const o: Record<string, { id: string; v: number }> = {};
      for (let i = 0; i < n; i++) o[`${prefix}${i}`] = { id: `${prefix}${i}`, v: i };
      return o;
    };
    const left = { entities: { answers: mk(80, "l"), pins: mk(40, "lp") } };
    const right = { entities: { answers: mk(75, "r"), pins: mk(45, "rp") } };
    const out = diffJSON(left, right, {
      pathPrefix: "root.entities",
      dictKeyOnly: true,
      ignorePaths: "",
      format: "md",
      maxDetailBytes: 4000,
      maxChanges: 500,
    }) as string;
    expect(out.length).toBeLessThan(60000);
    if (out.includes("Compressed diff groups")) {
      expect(out).toContain("<diff-digest");
    }
  });
});