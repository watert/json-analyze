import { describe, expect, it } from "vitest";
import { stringifyInlineArrays } from "./stringify-inline.js";

describe("stringifyInlineArrays", () => {
  const sample = {
    title: "demo",
    alias: { Ann: "Anne" },
    items: [
      { id: 1, title: "第1章", tags: [{ name: "a", count: 2 }, { name: "b", count: 1 }], note: "他说\"走\"\n下一句" },
      { id: 2, title: "第2章", tags: [] as { name: string; count: number }[], note: "空" },
    ],
    audit: { suspicious: [{ alias: "x", parents: ["y"] }] },
  };

  it("items 每条一行, 元素内数组仍是数组, 其余保持缩进", () => {
    const text = stringifyInlineArrays(sample, { keys: ["items"] });
    const lines = text.split("\n").filter((line) => line.includes("\"tags\""));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("\"title\":\"第1章\"");
    expect(lines[0]).toContain("\"tags\":[{\"name\":\"a\",\"count\":2},{\"name\":\"b\",\"count\":1}]");
    expect(lines[0]).toContain("\\\"走\\\"\\n下一句");
    expect(text).toMatch(/"alias": \{\n\s+"Ann": "Anne"\n\s+\}/);
    expect(text).toMatch(/"suspicious": \[\n/);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(sample);
  });

  it("空数组写成 [], 同名 key 一起压", () => {
    const value = { items: [] as unknown[], book: { items: [{ title: "extra" }] } };
    const text = stringifyInlineArrays(value, { keys: ["items"] });
    expect(text).toContain("\"items\": []");
    expect(text).toMatch(/"items": \[\n\s+\{"title":"extra"\}\n\s+\]/);
    expect(JSON.parse(text)).toEqual(value);
  });

  it("paths 只压命中的数组, 同名嵌套放过", () => {
    const value = {
      items: [{ id: 1, tags: ["a", "b"] }],
      book: { items: [{ id: 2 }] },
    };
    const text = stringifyInlineArrays(value, { paths: ["root.items"] });
    expect(text).toMatch(/"items": \[\n\s+\{"id":1,"tags":\["a","b"\]\}\n\s+\]/);
    expect(text).toMatch(/"id": 2/);
    expect(text).not.toMatch(/\{"id":2\}/);
    expect(JSON.parse(text)).toEqual(value);
  });

  it("paths 支持 [], 下标, * 和 bracket key", () => {
    const value = {
      books: [{ items: [{ id: 1 }] }, { items: [{ id: 2, tags: ["a"] }] }],
      book: { items: [{ id: 3 }] },
      "a.b": [{ id: 4 }],
    };
    const all = stringifyInlineArrays(value, { paths: ["root.books[].items"] });
    expect(all).toContain("{\"id\":1}");
    expect(all).toContain("{\"id\":2,\"tags\":[\"a\"]}");
    expect(all).toMatch(/"id": 3/);
    expect(JSON.parse(all)).toEqual(value);

    const first = stringifyInlineArrays(value, { paths: ["books[0].items"] });
    expect(first).toContain("{\"id\":1}");
    expect(first).toMatch(/"id": 2/);
    expect(JSON.parse(first)).toEqual(value);

    const star = stringifyInlineArrays(value, { paths: ["*.items"] });
    expect(star).toContain("{\"id\":3}");
    expect(star).toMatch(/"id": 1/);
    expect(JSON.parse(star)).toEqual(value);

    const bracket = stringifyInlineArrays({ "a.b": [{ id: 4 }] }, { paths: ["root[\"a.b\"]"] });
    expect(bracket).toContain("{\"id\":4}");
    expect(JSON.parse(bracket)).toEqual({ "a.b": [{ id: 4 }] });
  });

  it("keys 与 paths 取并集", () => {
    const value = { items: [{ id: 1 }], notes: [{ id: 2 }] };
    const text = stringifyInlineArrays(value, { keys: ["items"], paths: ["root.notes"] });
    expect(text).toContain("{\"id\":1}");
    expect(text).toContain("{\"id\":2}");
    expect(JSON.parse(text)).toEqual(value);
  });

  it("非法元素和 plain 约束直接抛", () => {
    expect(() => stringifyInlineArrays({ items: [undefined] }, { keys: ["items"] })).toThrow(/不是 JSON 值/);
    expect(() => stringifyInlineArrays({ items: [() => 1] }, { keys: ["items"] })).toThrow(/不是 JSON 值/);
    const holes: unknown[] = [];
    holes.length = 1;
    expect(() => stringifyInlineArrays({ items: holes }, { keys: ["items"] })).toThrow(/空洞/);
    expect(() => stringifyInlineArrays({ updated: new Date() }, { keys: ["items"] })).toThrow(/plain JSON/);
    expect(() => stringifyInlineArrays({ items: [] }, {})).toThrow(/需要 keys 或 paths/);
    expect(() => stringifyInlineArrays({ items: [] }, { paths: ["root[?key~items]"] })).toThrow(/filter/);
    expect(() => stringifyInlineArrays({ items: [] }, { keys: ["items"], space: 1.5 })).toThrow(/space/);
  });

  it("压中的 Date 元素走 JSON.stringify", () => {
    const value = { items: [new Date("2020-01-02T00:00:00.000Z")] };
    const text = stringifyInlineArrays(value, { keys: ["items"] });
    expect(JSON.parse(text)).toEqual({ items: ["2020-01-02T00:00:00.000Z"] });
  });
});
