// getByPath / readByKey 测试
import { describe, it, expect } from "bun:test";
import { getByPath, readByKey, getClosestKeys } from "../src/index.js";

describe("getByPath: 路径提取", () => {
  const data = {
    users: [
      { id: 1, name: "Alice", tags: ["a", "b"] },
      { id: 2, name: "Bob", tags: ["c"] },
      { id: 3, name: "Carol", tags: [] },
    ],
    meta: { count: 3 },
  };

  it("简单字段提取", () => {
    const vals = getByPath(data, "root.meta.count");
    expect(vals).toEqual([3]);
  });

  it("数组元素字段提取 (wildcard)", () => {
    const vals = getByPath(data, "root.users[].name");
    expect(vals).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("特定下标提取", () => {
    const vals = getByPath(data, "root.users[0]");
    expect(vals).toEqual([{ id: 1, name: "Alice", tags: ["a", "b"] }]);
  });

  it("嵌套数组 wildcard", () => {
    const vals = getByPath(data, "root.users[].tags[]");
    expect(vals).toEqual(["a", "b", "c"]);
  });

  it("limit 截断", () => {
    const vals = getByPath(data, "root.users[].name", { limit: 2 });
    expect(vals.length).toBe(2);
    expect(vals).toEqual(["Alice", "Bob"]);
  });

  it("不存在的路径返回空数组", () => {
    const vals = getByPath(data, "root.nope.xxx");
    expect(vals).toEqual([]);
  });

  it("路径末尾 [] 展开数组", () => {
    const arr = getByPath(data, "root.users[]");
    expect(arr.length).toBe(3);
    expect(arr[0]).toEqual({ id: 1, name: "Alice", tags: ["a", "b"] });
  });
});

describe("getByPath: bracket 转义 key", () => {
  const data = {
    "dot.key": { value: 42 },
    normal: { value: 10 },
  };

  it('root["dot.key"].value', () => {
    const vals = getByPath(data, 'root["dot.key"].value');
    expect(vals).toEqual([42]);
  });
});

describe("readByKey: 辅助读取", () => {
  const data = {
    a: { b: { c: 1 } },
    items: [{ x: 10 }, { x: 20 }],
  };

  it("点路径读取", () => {
    expect(readByKey(data, "a.b.c")).toBe(1);
  });

  it("数组下标读取", () => {
    expect(readByKey(data, "items[0].x")).toBe(10);
  });

  it("整 key 优先", () => {
    // 如果 object 自身有 key 叫 "a.b" (literal), 优先于嵌套
    const obj = { "a.b": 99, a: { b: 1 } };
    expect(readByKey(obj, "a.b")).toBe(99);
  });

  it("不存在的 key 返回 undefined", () => {
    expect(readByKey(data, "nope.x")).toBeUndefined();
  });

  it("null 安全", () => {
    expect(readByKey(null, "a.b")).toBeUndefined();
  });
});

describe("getClosestKeys: 路径诊断", () => {
  const data = {
    users: [
      { id: 1, name: "Alice", tags: ["a", "b"] },
      { id: 2, name: "Bob", tags: ["c"] },
    ],
    meta: { count: 3, version: "1.0" },
  };

  it("key 不存在 → 返回 Levenshtein 最近 key 建议", () => {
    // 用具体下标进入对象, wildcard 不消耗节点
    const hint = getClosestKeys(data, "root.users[0].naem");
    expect(hint).not.toBeNull();
    expect(hint!.lastValidPath).toBe("root.users[0]");
    expect(hint!.lastNodeType).toBe("object");
    expect(hint!.searchedKey).toBe("naem");
    // 最近匹配应为 name
    expect(hint!.closestKeys[0]).toBe("name");
    expect(hint!.closestKeys).toContain("tags");
    expect(hint!.closestKeys).toContain("id");
  });

  it("标量节点不能继续遍历 → 返回类型信息", () => {
    const hint = getClosestKeys(data, "root.meta.count.xxx");
    expect(hint).not.toBeNull();
    expect(hint!.lastValidPath).toBe("root.meta.count");
    expect(hint!.lastNodeType).toBe("number");
    expect(hint!.closestKeys).toEqual([]);
    expect(hint!.searchedKey).toBe("xxx");
  });

  it("数组下标越界 → 返回 array 长度", () => {
    const hint = getClosestKeys(data, "root.users[5]");
    expect(hint).not.toBeNull();
    expect(hint!.lastValidPath).toBe("root.users");
    expect(hint!.lastNodeType).toBe("array[2]");
    expect(hint!.searchedKey).toBe("[5]");
  });

  it("非数组上用下标 → 返回实际类型", () => {
    const hint = getClosestKeys(data, "root.meta[0]");
    expect(hint).not.toBeNull();
    expect(hint!.lastValidPath).toBe("root.meta");
    expect(hint!.lastNodeType).toBe("object");
    expect(hint!.searchedKey).toBe("[0]");
    // meta 的 keys 应被返回
    expect(hint!.closestKeys).toContain("count");
    expect(hint!.closestKeys).toContain("version");
  });

  it("完全匹配路径 → 返回 null", () => {
    const hint = getClosestKeys(data, "root.meta.count");
    expect(hint).toBeNull();
  });

  it("中间节点为标量再深入 → 返回标量类型", () => {
    const hint = getClosestKeys(data, "root.users[0].name.xxx");
    expect(hint).not.toBeNull();
    expect(hint!.lastValidPath).toBe("root.users[0].name");
    expect(hint!.lastNodeType).toBe("string");
    expect(hint!.searchedKey).toBe("xxx");
  });
});
