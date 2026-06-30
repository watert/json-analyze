import { describe, expect, it } from "./test-harness.js";
import { analyzeJSON } from "./analyzer.js";
import {
  formatGroupDigest,
  MIN_DIGEST_WHEN_OVER_BUDGET,
  planGroupCompression,
  recordFieldKeyNames,
  type CompressUnit,
} from "./format-compress-groups.js";
import { renderGroupedFlatMarkdown } from "./format-grouped.js";

describe("format-compress-groups", () => {
  it("digest 仅 keyNames + drill", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 12; i++) obj[`id${i}`] = { id: i, name: `n${i}` };
    const schema = analyzeJSON({ users: obj });
    const parent = schema.find((s) => s.path === "root.users" && s.type === "record")!;
    const kids = schema.filter((s) => s.path.startsWith("root.users[]."));
    const d = formatGroupDigest(
      {
        path: "root.users",
        node: parent,
        kind: "record",
        keyNames: recordFieldKeyNames("root.users", kids),
        bytes: 9999,
        weight: 100,
      },
      "f.json",
    );
    expect(d).toContain("keyNames:");
    expect(d).not.toContain("sample keys:");
    expect(d).toContain("--path-prefix");
  });

  it("超预算按大组 digest", () => {
    const a: Record<string, object> = {};
    const b: Record<string, object> = {};
    for (let i = 0; i < 20; i++) {
      a[`a${i}`] = { id: i, x: "y".repeat(30) };
      b[`b${i}`] = { id: i, x: "z".repeat(30) };
    }
    const schema = analyzeJSON({ sliceA: a, sliceB: b, extra: { n: 1 } });
    const out = renderGroupedFlatMarkdown(schema, { maxDetailBytes: 600, drillFile: "d.json", top: 5 });
    expect(out).not.toContain("flat budget");
    expect(out).toMatch(/<record-digest/);
    expect(out).toContain("keyNames:");
  });

  it("超预算至少 MIN_DIGEST 条（大组够多时）", () => {
    const units: CompressUnit[] = Array.from({ length: 10 }, (_, i) => ({
      path: `root.g${i}`,
      node: { path: `root.g${i}`, type: "record", keysCount: 20 },
      kind: "record" as const,
      keyNames: ["a", "b"],
      bytes: 5000,
      weight: 100 - i,
    }));
    const plan = planGroupCompression(units, 200, 3000, "f.json");
    expect(plan.overBudget).toBe(true);
    expect(plan.digestPaths.size).toBeGreaterThanOrEqual(MIN_DIGEST_WHEN_OVER_BUDGET);
  });
});