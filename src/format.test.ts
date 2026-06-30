// Markdown 格式化输出测试
import { describe, it, expect } from "./test-harness.js";
import { analyzeJSON } from "../src/analyzer.js";
import { renderMarkdown } from "../src/format.js";

describe("renderMarkdown", () => {
  it("示例 4.1: 简单扁平对象", () => {
    const schema = analyzeJSON({
      id: 1024,
      name: "Alice",
      active: true,
      score: null,
    });
    const md = renderMarkdown(schema);
    expect(md).toBe(
      `**root** — object
keys: id, name, active, score

**root.id** — number
sample: 1024

**root.name** — string
sample: "Alice"

**root.active** — boolean
sample: true

**root.score** — null
sample: null`
    );
  });

  it("示例 4.2: 嵌套对象 + 长文本 + 日期", () => {
    const schema = analyzeJSON({
      article: {
        title: "Learning Bun",
        body: "Bun is an incredibly fast all-in-one JavaScript runtime. It combines package manager, bundler, and test runner into a single tool, making development smooth and efficient.",
        createdAt: "2026-03-15T08:30:00Z",
        updatedAt: "2026-06-01",
      },
    });
    const md = renderMarkdown(schema);
    expect(md).toBe(
      `**root** — object
keys: article

**root.article** — object
keys: title, body, createdAt, updatedAt

**root.article.title** — string
sample: "Learning Bun"

**root.article.body** — long-text[171]
length: 171

**root.article.createdAt** — date
sample: "2026-03-15T08:30:00Z"

**root.article.updatedAt** — date
sample: "2026-06-01"`
    );
  });

  it("示例 4.3: 混合数组", () => {
    const schema = analyzeJSON({
      arr: [
        true,
        123,
        { date: "2025-04-02", msg: "hello" },
        { date: "2025-04-03", msg: "hello2", foo: "bar" },
      ],
    });
    const md = renderMarkdown(schema);
    expect(md).toBe(
      `**root** — object
keys: arr

**root.arr** — array[4]
items: boolean(1)=true, number(1)=123, object(2)

**root.arr[].date** — date
sample: "2025-04-02"

**root.arr[].msg** — string
sample: "hello"

**root.arr[].foo** — string
sample: "bar"`
    );
  });

  it("示例 4.4: 矩阵", () => {
    const schema = analyzeJSON({
      matrix: [[1, 2], [3, 4], [5, 6]],
    });
    const md = renderMarkdown(schema);
    expect(md).toBe(
      `**root** — object
keys: matrix

**root.matrix** — array[3]
items: array(3)

**root.matrix[]** — array[6]
items: number(6)=1, 2, 3`
    );
  });

  it("示例 4.6: mixed 类型冲突", () => {
    const schema = analyzeJSON({
      items: [
        { id: 1, value: "hello" },
        { id: 2, value: 42 },
        { id: 3, value: "world" },
      ],
    });
    const md = renderMarkdown(schema);
    expect(md).toBe(
      `**root** — object
keys: items

**root.items** — array[3]
items: object(3)

**root.items[].id** — number
sample: 1

**root.items[].value** — mixed
variants: string(2)="hello", "world", number(1)=42
sample: "hello"`
    );
  });

  it("示例 4.7: 空数组", () => {
    const schema = analyzeJSON({
      data: [],
      items: [null, null],
    });
    const md = renderMarkdown(schema);
    expect(md).toBe(
      `**root** — object
keys: data, items

**root.data** — array[0]
items: (empty)

**root.items** — array[2]
items: null(2)`
    );
  });
});