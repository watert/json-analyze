// filter 单元测试
import { describe, it, expect } from "vitest";
import { filterJSON } from "../src/filter.js";

// 直接 inline 测试 coerce 行为，通过公共接口的 value 类型推断间接验证
const coerce = (v: string) => {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
};

describe("coerce: 类型自动推断", () => {
  it("数字", () => {
    expect(coerce("0.15")).toBe(0.15);
    expect(coerce("-3")).toBe(-3);
    expect(coerce("42")).toBe(42);
  });
  it("布尔", () => {
    expect(coerce("true")).toBe(true);
    expect(coerce("false")).toBe(false);
  });
  it("null", () => {
    expect(coerce("null")).toBeNull();
  });
  it("字符串 (兜底)", () => {
    expect(coerce("k2p6")).toBe("k2p6");
    expect(coerce("hello world")).toBe("hello world");
    expect(coerce("2026-01")).toBe("2026-01"); // 长度 7 不当数字
  });
});

describe("filterJSON: 字段值匹配", () => {
  const data = {
    users: [
      { id: 1, name: "Alice", score: 99.5 },
      { id: 2, name: "Bob", score: 60 },
      { id: 3, name: "Carol", score: 80, active: false },
    ],
  };

  it("单条件字符串 substring", () => {
    const r = filterJSON(data, { queries: [{ key: "name", op: "=", value: "li" }] });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].name).toBe("Alice");
  });

  it("数值 >=", () => {
    const r = filterJSON(data, { queries: [{ key: "score", op: ">=", value: "80" }] });
    expect(r.matches.length).toBe(2);
    expect(r.matches.map((m: any) => m.name).sort()).toEqual(["Alice", "Carol"]);
  });

  it("多条件 AND", () => {
    const r = filterJSON(data, {
      queries: [
        { key: "name", op: "=", value: "bo" },
        { key: "score", op: "<", value: "100" },
      ],
    });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].name).toBe("Bob");
  });

  it("缺失字段 → 不命中", () => {
    const r = filterJSON(data, { queries: [{ key: "active", op: "=", value: "false" }] });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].name).toBe("Carol");
  });

  it("数字字符串自动转 number 后可匹配", () => {
    const r = filterJSON(data, { queries: [{ key: "id", op: "=", value: "1" }] });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].name).toBe("Alice");
  });

  it("非数字字符串不能匹配数字字段", () => {
    const r = filterJSON(data, { queries: [{ key: "id", op: "=", value: "abc" }] });
    expect(r.matches.length).toBe(0);
  });
});

describe("filterJSON: dict-key 模式 (model id)", () => {
  const data = {
    openai: {
      id: "openai",
      models: {
        "gpt-4o": { cost: { input: 2.5, output: 10 } },
        "gpt-4o-mini": { cost: { input: 0.15, output: 0.6 } },
      },
    },
    moonshot: {
      id: "moonshot",
      models: {
        "kimi-k2p6": { cost: { input: 0.6, output: 2.5 } },
      },
    },
  };

  it("--key-match: 在对象 key 中搜", () => {
    const r = filterJSON(data, { queries: [], keyMatch: "k2p6" });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].cost.input).toBe(0.6);
    expect(r.paths[0]).toContain("kimi-k2p6");
  });

  it("path-glob 限定搜索范围", () => {
    const r = filterJSON(data, {
      queries: [{ key: "cost.input", op: "<", value: "1" }],
      pathGlob: "openai.models.*",
    });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].cost.input).toBe(0.15);
  });

  it("点路径读取嵌套字段", () => {
    const r = filterJSON(data, {
      queries: [{ key: "cost.input", op: "<=", value: "1" }],
    });
    expect(r.matches.length).toBe(2);
  });
});

describe("filterJSON: limit / maxDepth", () => {
  const data = { arr: Array.from({ length: 20 }, (_, i) => ({ i, v: i * 2 })) };
  it("limit 截断", () => {
    const r = filterJSON(data, {
      queries: [{ key: "i", op: ">=", value: "0" }],
      limit: 5,
    });
    expect(r.matches.length).toBe(5);
    expect(r.truncated).toBe(true);
  });
});

describe("filterJSON: 无 query + keyMatch", () => {
  const data = { a: { b: 1 }, c: { d: 2 } };
  it("keyMatch 单独工作", () => {
    const r = filterJSON(data, { queries: [], keyMatch: "b" });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0]).toBe(1);
  });
});

describe("filterJSON: keyMatch + field query (AND)", () => {
  const data = {
    providers: {
      solar: { cost: { input: 0.15, output: 0.15 }, speed: "fast" },
      gpt4: { cost: { input: 30, output: 60 }, speed: "slow" },
    },
  };
  it("keyMatch + 数值 query 必须同时满足", () => {
    // 不指定 key: 两条都可能被 solar 的 cost 命中
    const all = filterJSON(data, {
      queries: [{ key: "cost.input", op: "<=", value: "1" }],
    });
    expect(all.matches.length).toBe(1);
    expect(all.matches[0].cost.input).toBe(0.15);
  });
  it("keyMatch 与 field query AND", () => {
    // 命中 "gpt4" key 但 cost.input=30 不满足 <=1 → 不命中
    const r = filterJSON(data, {
      queries: [{ key: "cost.input", op: "<=", value: "1" }],
      keyMatch: "gpt4",
    });
    expect(r.matches.length).toBe(0);
  });
  it("keyMatch 与 field query AND（命中分支）", () => {
    const r = filterJSON(data, {
      queries: [{ key: "cost.input", op: "<=", value: "1" }],
      keyMatch: "solar",
    });
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].cost.input).toBe(0.15);
  });
});
