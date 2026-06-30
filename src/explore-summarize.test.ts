// explorer + summarize 测试
import { describe, it, expect } from "bun:test";
import {
  analyzeJSON,
  getFieldValues,
  getPathCardinality,
  findPathsByType,
  summarizeSchema,
  compactSchema,
} from "../src/index.js";

// ---------- explorer ----------

describe("getFieldValues: 字段值探索", () => {
  const data = {
    items: [
      { role: "admin", level: 1 },
      { role: "user", level: 2 },
      { role: "admin", level: 2 },
    ],
  };

  it("去重值", () => {
    const r = getFieldValues(data, "root.items[].role");
    expect(r.values).toEqual(["admin", "user"]);
    expect(r.distinct).toBe(2);
    expect(r.totalVisited).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it("不去重 (distinct=false)", () => {
    const r = getFieldValues(data, "root.items[].role", { distinct: false });
    expect(r.values).toEqual(["admin", "user", "admin"]);
    expect(r.totalVisited).toBe(3);
  });

  it("limit 生效", () => {
    const r = getFieldValues(data, "root.items[].role", { limit: 1 });
    expect(r.values.length).toBe(1);
    expect(r.truncated).toBe(true);
  });
});

describe("getPathCardinality: 基数", () => {
  const data = {
    users: [
      { role: "admin" },
      { role: "user" },
      { role: "admin" },
      { role: "user" },
    ],
  };

  it("role 字段基数", () => {
    const r = getPathCardinality(data, "root.users[].role");
    expect(r.distinct).toBe(2);
    expect(r.total).toBe(4);
  });

  it("id 字段基数=总数", () => {
    const d = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const r = getPathCardinality(d, "root.items[].id");
    expect(r.distinct).toBe(3);
    expect(r.total).toBe(3);
  });
});

describe("findPathsByType: 类型筛选", () => {
  const schema = analyzeJSON({
    users: [
      { id: 1, bio: "a".repeat(100), value: "hello" },
      { id: 2, value: 42 },
    ],
  });

  it("筛选 mixed 字段", () => {
    const mixed = findPathsByType(schema, "mixed");
    expect(mixed.length).toBe(1);
    expect(mixed[0].path).toBe("root.users[].value");
  });

  it("筛选 long-text 字段", () => {
    const lt = findPathsByType(schema, "long-text");
    expect(lt.length).toBe(1);
    expect(lt[0].path).toBe("root.users[].bio");
  });

  it("筛选 object 节点", () => {
    const objs = findPathsByType(schema, "object");
    expect(objs.length).toBeGreaterThan(0);
  });
});

// ---------- summarize ----------

describe("summarizeSchema: 摘要", () => {
  it("复杂 schema 摘要统计正确", () => {
    const schema = analyzeJSON({
      users: [
        { id: 1, name: "Alice", tags: ["a"] },
        { id: 2, bio: "x".repeat(70) },
      ],
      meta: { count: 2, empty: [] },
    });

    const s = summarizeSchema(schema);
    expect(s.totalNodes).toBeGreaterThan(0);
    expect(s.arraysCount).toBeGreaterThan(0);
    expect(s.objectsCount).toBeGreaterThan(0);
    expect(s.mixedFields).toBe(0);
    expect(s.longTextFields).toBeGreaterThan(0);
    expect(s.emptyArrays).toBeGreaterThan(0);
    expect(s.maxDepth).toBeGreaterThanOrEqual(2);
    expect(Object.keys(s.leafTypes).length).toBeGreaterThan(0);
  });

  it("简单对象的摘要", () => {
    const schema = analyzeJSON({ a: 1, b: "hello" });
    const s = summarizeSchema(schema);
    expect(s.totalNodes).toBe(3); // root, a, b
    expect(s.maxDepth).toBe(1);
    expect(s.leafTypes["number"]).toBe(1);
    expect(s.leafTypes["string"]).toBe(1);
  });
});

describe("compactSchema: 紧凑类型字符串", () => {
  it("简单对象", () => {
    const schema = analyzeJSON({ id: 1, name: "Alice" });
    expect(compactSchema(schema)).toContain("id: number");
    expect(compactSchema(schema)).toContain("name: string");
  });

  it("嵌套数组", () => {
    const schema = analyzeJSON({
      users: [{ id: 1, name: "Alice", tags: ["a", "b"] }],
    });
    const c = compactSchema(schema);
    expect(c).toContain("users");
    expect(c).toContain("tags");
    expect(c).toContain("string");
    expect(c).toContain("[");
  });

  it("含 optional 标记", () => {
    const data = { items: [{ id: 1 }, { id: 2, name: "x" }] };
    const schema = analyzeJSON(data);
    const c = compactSchema(schema);
    expect(c).toContain("name?");
  });

  it("空 schema 返回 {} 不崩溃", () => {
    expect(compactSchema([])).toBe("{}");
  });
});
