// JSON Schema Analyzer 单元测试
import { describe, it, expect } from "bun:test";
import { analyzeJSON } from "../src/analyzer.js";
import { getParent } from "../src/path-utils.js";

// ---------- getParent 工具测试 ----------

describe("getParent", () => {
  it('"root" → null', () => {
    expect(getParent("root")).toBeNull();
  });

  it('"root.arr[].name" → "root.arr"', () => {
    expect(getParent("root.arr[].name")).toBe("root.arr");
  });

  it('"root.arr[]" → "root.arr"', () => {
    expect(getParent("root.arr[]")).toBe("root.arr");
  });

  it('"root.obj.nested" → "root.obj"', () => {
    expect(getParent("root.obj.nested")).toBe("root.obj");
  });
});

// ---------- 示例 4.1: 简单扁平对象 ----------

describe("示例 4.1: 简单扁平对象", () => {
  const data = {
    id: 1024,
    name: "Alice",
    active: true,
    score: null,
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["id", "name", "active", "score"] },
      { path: "root.id", type: "number", sampleValue: 1024 },
      { path: "root.name", type: "string", sampleValue: "Alice" },
      { path: "root.active", type: "boolean", sampleValue: true },
      { path: "root.score", type: "null", sampleValue: null },
    ]);
  });
});

// ---------- 示例 4.2: 嵌套对象 + 长文本 + 日期 ----------

describe("示例 4.2: 嵌套对象 + 长文本 + 日期", () => {
  const data = {
    article: {
      title: "Learning Bun",
      body: "Bun is an incredibly fast all-in-one JavaScript runtime. It combines package manager, bundler, and test runner into a single tool, making development smooth and efficient.",
      createdAt: "2026-03-15T08:30:00Z",
      updatedAt: "2026-06-01",
    },
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["article"] },
      { path: "root.article", type: "object", keys: ["title", "body", "createdAt", "updatedAt"] },
      { path: "root.article.title", type: "string", sampleValue: "Learning Bun" },
      {
        path: "root.article.body",
        type: "long-text",
        sampleValue: "Bun is an incredibly fast all-...(111 chars)...elopment smooth and efficient.",
        longText: true,
        originalLength: 171,
      },
      { path: "root.article.createdAt", type: "date", sampleValue: "2026-03-15T08:30:00Z" },
      { path: "root.article.updatedAt", type: "date", sampleValue: "2026-06-01" },
    ]);
  });
});

// ---------- 示例 4.3: 混合数组（标量 + 对象） ----------

describe("示例 4.3: 混合数组（标量 + 对象）", () => {
  const data = {
    arr: [
      true,
      123,
      { date: "2025-04-02", msg: "hello" },
      { date: "2025-04-03", msg: "hello2", foo: "bar" },
    ],
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["arr"] },
      {
        path: "root.arr",
        type: "array",
        itemTypes: [
          { type: "boolean", count: 1, samples: [true] },
          { type: "number", count: 1, samples: [123] },
          { type: "object", count: 2 },
        ],
      },
      {
        path: "root.arr[].date",
        type: "date",
        sampleValue: "2025-04-02",
        presence: 2,
        note: "present in 2/2 objects",
      },
      {
        path: "root.arr[].msg",
        type: "string",
        sampleValue: "hello",
        presence: 2,
        note: "present in 2/2 objects",
      },
      {
        path: "root.arr[].foo",
        type: "string",
        sampleValue: "bar",
        presence: 1,
        note: "present in 1/2 objects (optional)",
      },
    ]);
  });
});

// ---------- 示例 4.4: 数组内嵌数组（矩阵） ----------

describe("示例 4.4: 数组内嵌数组（矩阵）", () => {
  const data = {
    matrix: [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["matrix"] },
      {
        path: "root.matrix",
        type: "array",
        itemTypes: [{ type: "array", count: 3 }],
      },
      {
        path: "root.matrix[]",
        type: "array",
        itemTypes: [{ type: "number", count: 6, samples: [1, 2, 3] }],
        note: "inner array",
      },
    ]);
  });
});

// ---------- 示例 4.5: 复杂嵌套：对象数组内含可选数组字段 ----------

describe("示例 4.5: 复杂嵌套：对象数组内含可选数组字段", () => {
  const data = {
    data: [
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: ["c"] },
      { id: 3, coords: [10, 20] },
    ],
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["data"] },
      {
        path: "root.data",
        type: "array",
        itemTypes: [{ type: "object", count: 3 }],
      },
      {
        path: "root.data[].id",
        type: "number",
        sampleValue: 1,
        presence: 3,
        note: "present in 3/3 objects",
      },
      {
        path: "root.data[].tags",
        type: "array",
        itemTypes: [{ type: "string", count: 3, samples: ["a", "b", "c"] }],
        presence: 2,
        note: "present in 2/3 objects (optional)",
      },
      {
        path: "root.data[].coords",
        type: "array",
        itemTypes: [{ type: "number", count: 2, samples: [10, 20] }],
        presence: 1,
        note: "present in 1/3 objects (optional)",
      },
    ]);
  });
});

// ---------- 示例 4.6: 类型冲突（mixed） ----------

describe("示例 4.6: 类型冲突（mixed）", () => {
  const data = {
    items: [
      { id: 1, value: "hello" },
      { id: 2, value: 42 },
      { id: 3, value: "world" },
    ],
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["items"] },
      {
        path: "root.items",
        type: "array",
        itemTypes: [{ type: "object", count: 3 }],
      },
      {
        path: "root.items[].id",
        type: "number",
        sampleValue: 1,
        presence: 3,
        note: "present in 3/3 objects",
      },
      {
        path: "root.items[].value",
        type: "mixed",
        sampleValue: "hello",
        presence: 3,
        note: "present in 3/3 objects",
        variants: [
          { type: "string", count: 2, samples: ["hello", "world"] },
          { type: "number", count: 1, samples: [42] },
        ],
      },
    ]);
  });
});

// ---------- 示例 4.7: 空数组 ----------

describe("示例 4.7: 空数组", () => {
  const data = {
    data: [],
    items: [null, null],
  };

  it("输出正确 schema", () => {
    const schema = analyzeJSON(data);
    expect(schema).toEqual([
      { path: "root", type: "object", keys: ["data", "items"] },
      {
        path: "root.data",
        type: "array",
        itemTypes: [],
        comment: "empty array",
      },
      {
        path: "root.items",
        type: "array",
        itemTypes: [{ type: "null", count: 2 }],
      },
    ]);
  });
});

// ---------- 边界测试 ----------

describe("边界测试", () => {
  it("根为数组", () => {
    const schema = analyzeJSON([1, 2, 3]);
    expect(schema[0]).toEqual({
      path: "root",
      type: "array",
      itemTypes: [{ type: "number", count: 3, samples: [1, 2, 3] }],
    });
  });

  it("根为标量", () => {
    const schema = analyzeJSON("hello");
    expect(schema[0]).toEqual({
      path: "root",
      type: "string",
      sampleValue: "hello",
    });
  });

  it("纯数字字符串不应被识别为日期", () => {
    const schema = analyzeJSON({ id: "12345" });
    expect(schema[1]).toEqual({
      path: "root.id",
      type: "string",
      sampleValue: "12345",
    });
  });

  it("日期字符串长度不足不应识别为日期", () => {
    const schema = analyzeJSON({ d: "2026-01" });
    expect(schema[1]).toEqual({
      path: "root.d",
      type: "string",
      sampleValue: "2026-01",
    });
  });
});
