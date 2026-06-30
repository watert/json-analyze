import { describe, expect, it } from "vitest";
import { analyzeJSON } from "./analyzer.js";
import { renderGroupedFlatMarkdown } from "./format-grouped.js";

describe("format-grouped", () => {
  it("record 统一 record tag + attrs，内部短字段名 + sample", () => {
    const obj: Record<string, object> = {};
    for (let i = 0; i < 10; i++) obj[`id${i}`] = { id: i, name: `n${i}` };
    const schema = analyzeJSON({ users: obj });
    const md = renderGroupedFlatMarkdown(schema);
    expect(md).toMatch(/<record path="root\.users" keyCount="10" overlap="/);
    expect(md).toMatch(/<\/record>/);
    expect(md).not.toContain("<users");
    expect(md).toContain("**name**");
    expect(md).toContain("sample:");
  });

  it("object 大组用分节 + 子弹，不逐 path 平铺", () => {
    const schema = analyzeJSON({
      env: {
        abV2: {
          config: {
            paramMap: {
              px: { value: "2", abId: "a1" },
              ws: { value: "1", abId: "a2" },
            },
          },
          triggers: {},
        },
      },
    });
    const md = renderGroupedFlatMarkdown(schema);
    expect(md).toContain('<group path="root.env">');
    expect(md).toContain("`env`: object");
    expect(md).toContain("`abV2`: object");
    expect(md).toMatch(/\* \*\*value\*\*: string, sample:/);
    expect(md).not.toMatch(/\*\*root\.env\.abV2\.config\.paramMap\.px_hottiming/);
  });

  it("map entry 不单独成节，同构 entry 只展开 fields per entry 一次", () => {
    const schema = analyzeJSON({
      env: {
        abV2: {
          config: {
            abMap: {
              "rl-a": { abId: "rl-a", layerId: "L1" },
              "rl-b": { abId: "rl-b", layerId: "L2" },
            },
          },
        },
      },
    });
    const md = renderGroupedFlatMarkdown(schema);
    expect(md).toContain("`abV2.config.abMap`: object");
    expect(md).toContain("fields per entry:");
    expect(md).toContain("* **abId**: string");
    expect(md).not.toContain("`abV2.config.abMap.rl-a`:");
  });
});