// 新能力测试: 循环引用、规模控制、非标准类型、路径转义
import { describe, it, expect } from "bun:test";
import { analyzeJSON, getParent } from "../src/index.js";

describe("v2: 循环引用检测", () => {
  it("自引用对象标记为 circular", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const schema = analyzeJSON(obj);
    const circular = schema.find((s) => s.type === "circular");
    expect(circular).toBeDefined();
    expect(circular!.path).toBe("root.self");
    expect(circular!.comment).toBe("circular reference");
  });

  it("相互引用 a→b→a 标记为 circular", () => {
    const a: any = { name: "a" };
    const b: any = { name: "b" };
    a.b = b;
    b.a = a;
    const schema = analyzeJSON(a);
    const circulars = schema.filter((s) => s.type === "circular");
    expect(circulars.length).toBeGreaterThanOrEqual(1);
  });

  it("嵌套对象自引用", () => {
    const inner: any = { x: 1 };
    const outer: any = { items: [inner, inner] };
    inner.parent = outer;
    const schema = analyzeJSON(outer);
    const circulars = schema.filter((s) => s.type === "circular");
    expect(circulars.length).toBeGreaterThanOrEqual(1);
  });
});

describe("v2: 选项 - maxDepth", () => {
  it("深度受限时截断", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const schema = analyzeJSON(deep, { maxDepth: 2 });
    const truncated = schema.filter((s) => s.comment === "max depth reached");
    expect(truncated.length).toBeGreaterThan(0);
  });
});

describe("v2: 选项 - maxArrayItems", () => {
  it("大数组采样截断", () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const schema = analyzeJSON({ arr }, { maxArrayItems: 10 });
    const arrNode = schema.find((s) => s.path === "root.arr");
    expect(arrNode?.comment).toContain("truncated");
    expect(arrNode?.comment).toContain("100 items");
    // 仍然展开前 10 个对象的字段
    const idNode = schema.find((s) => s.path === "root.arr[].id");
    expect(idNode).toBeDefined();
    expect(idNode!.presence).toBe(10);
  });
});

describe("v2: 选项 - maxKeysPerObject", () => {
  it("超大对象 key 截断", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) obj[`key${i}`] = i;
    const schema = analyzeJSON(obj, { maxKeysPerObject: 10 });
    const rootNode = schema.find((s) => s.path === "root");
    expect(rootNode?.comment).toContain("truncated keys");
    expect(rootNode?.keys?.length).toBe(10);
  });
});

describe("v2: 非标准 JSON 类型", () => {
  it("Date 对象 → date-object", () => {
    const schema = analyzeJSON({ created: new Date("2025-01-01T00:00:00Z") });
    const node = schema.find((s) => s.path === "root.created");
    expect(node?.type).toBe("date-object");
    expect(node?.sampleValue).toContain("2025-01-01");
  });

  it("BigInt → bigint", () => {
    const schema = analyzeJSON({ big: BigInt(9007199254740991) });
    const node = schema.find((s) => s.path === "root.big");
    expect(node?.type).toBe("bigint");
    expect(node?.sampleValue).toBe("9007199254740991");
  });

  it("undefined → undefined", () => {
    const schema = analyzeJSON({ x: undefined });
    const node = schema.find((s) => s.path === "root.x");
    expect(node?.type).toBe("undefined");
  });

  it("Symbol → symbol", () => {
    const sym = Symbol("test");
    const schema = analyzeJSON({ s: sym });
    const node = schema.find((s) => s.path === "root.s");
    expect(node?.type).toBe("symbol");
    expect(node?.sampleValue).toContain("test");
  });
});

describe("v2: 路径转义 - 特殊 key", () => {
  it('key 含 "." 时用 bracket 转义', () => {
    const schema = analyzeJSON({ "a.b": { "c.d": 1 } });
    const node = schema.find((s) => s.path.includes('"'));
    expect(node).toBeDefined();
    // path 应包含 bracket 转义
    const rootChild = schema.find((s) => s.path !== "root" && s.path.startsWith('root["'));
    expect(rootChild).toBeDefined();
  });

  it('bracket 转义 key 的 getParent 正确', () => {
    const parent = getParent('root["a.b"].c');
    expect(parent).toBe('root["a.b"]');
  });

  it('getParent("root["a.b"]") → "root"', () => {
    expect(getParent('root["a.b"]')).toBe("root");
  });
});

describe("v2: getParent 多层嵌套数组", () => {
  it('"root.a[].b[].c" → "root.a[].b"', () => {
    expect(getParent("root.a[].b[].c")).toBe("root.a[].b");
  });

  it('"root.a[].b[]" → "root.a[].b"', () => {
    expect(getParent("root.a[].b[]")).toBe("root.a[].b");
  });

  it('"root.a[].b.c" → "root.a[].b"', () => {
    expect(getParent("root.a[].b.c")).toBe("root.a[].b");
  });
});
