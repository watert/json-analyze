import { describe, expect, it } from "bun:test";
import { analyzeJSON } from "./analyzer.js";
import { renderTreeMarkdown, renderXmlMarkdown, groupSchemaTwoLevels } from "./format-tree.js";

describe("format-tree", () => {
  it("两层分组: record 子字段挂在父 path 下", () => {
    const schema = analyzeJSON({
      users: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`id${i}`, { id: i, name: `n${i}` }])
      ),
    });
    const { sections } = groupSchemaTwoLevels(schema);
    const users = sections.find((s) => s.parent.path === "root.users");
    expect(users?.parent.type).toBe("record");
    expect(users?.children.some((c) => c.path === "root.users[].id")).toBe(true);
  });

  it("renderTreeMarkdown snapshot 片段", () => {
    const schema = analyzeJSON({ id: 1, meta: { a: 1, b: 2 } });
    const md = renderTreeMarkdown(schema);
    expect(md).toContain("### root —");
    expect(md).toContain("root.meta");
    expect(md).toContain("root.id");
  });

  it("renderXmlMarkdown 含 field 标签", () => {
    const schema = analyzeJSON({ id: 1, meta: { a: 1 } });
    const xml = renderXmlMarkdown(schema);
    expect(xml).toMatch(/<field name="id"/);
    expect(xml).toMatch(/<meta /);
  });
});