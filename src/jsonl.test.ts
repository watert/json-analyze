// JSONL 流式模块测试
import { describe, it, expect } from "./test-harness.js";
import {
  parseJSONL,
  analyzeJSONL,
  filterJSONL,
  searchJSONL,
  aggregateAnalyzeJSONL,
  collectFilterJSONL,
  collectSearchJSONL,
  collectJSONLForMergedAnalyze,
} from "./jsonl.js";

// ---------- parseJSONL ----------

describe("parseJSONL: 字符串输入", () => {
  it("基础多行解析", async () => {
    const input = '{"a":1}\n{"b":2}\n{"c":3}';
    const out: any[] = [];
    for await (const p of parseJSONL(input)) out.push(p);
    expect(out.length).toBe(3);
    expect(out[0].line).toBe(1);
    expect(out[0].data).toEqual({ a: 1 });
    expect(out[2].line).toBe(3);
    expect(out[2].data).toEqual({ c: 3 });
  });

  it("跳过空行", async () => {
    const input = '{"a":1}\n\n\n{"b":2}\n';
    const out: any[] = [];
    for await (const p of parseJSONL(input)) out.push(p);
    expect(out.length).toBe(2);
    expect(out[0].line).toBe(1);
    expect(out[1].line).toBe(4); // 行号累计实际行数
  });

  it("CRLF 兼容", async () => {
    const input = '{"a":1}\r\n{"b":2}\r\n';
    const out: any[] = [];
    for await (const p of parseJSONL(input)) out.push(p);
    expect(out.length).toBe(2);
    expect(out[0].data).toEqual({ a: 1 });
  });

  it("无效 JSON 默认 skip + 警告", async () => {
    const errs: any[] = [];
    const input = '{"a":1}\nnot json\n{"b":2}';
    const out: any[] = [];
    for await (const p of parseJSONL(input, { onError: (l, r, e) => errs.push({ l, r, e }) })) {
      out.push(p);
    }
    expect(out.length).toBe(2);
    expect(errs.length).toBe(1);
    expect(errs[0].l).toBe(2);
  });

  it("errorMode: throw 直接抛错", async () => {
    const input = '{"a":1}\nnot json\n{"b":2}';
    let err: unknown;
    try {
      for await (const _ of parseJSONL(input, { errorMode: "throw" })) {
        void _;
      }
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String(err)).toMatch(/invalid JSON/);
  });

  it("errorMode: ignore 静默跳过", async () => {
    const input = '{"a":1}\nnot json\n{"b":2}';
    const out: any[] = [];
    for await (const p of parseJSONL(input, { errorMode: "ignore" })) out.push(p);
    expect(out.length).toBe(2);
  });

  it("maxLineBytes 限制", async () => {
    const input = '{"a":1}\n{"x":"' + "x".repeat(100) + '"}\n{"b":2}';
    const out: any[] = [];
    for await (const p of parseJSONL(input, { maxLineBytes: 50, errorMode: "ignore" })) {
      out.push(p);
    }
    expect(out.length).toBe(2); // 超长行被跳过
  });

  it("复杂嵌套 JSON", async () => {
    const input = '{"users":[{"id":1,"name":"Alice"}]}\n{"users":[{"id":2}]}';
    const out: any[] = [];
    for await (const p of parseJSONL(input)) out.push(p);
    expect(out[0].data.users[0].name).toBe("Alice");
    expect(out[1].data.users[0].id).toBe(2);
  });
});

describe("parseJSONL: AsyncIterable 输入", () => {
  it("逐 chunk 喂入", async () => {
    async function* gen() {
      yield '{"a';
      yield '":1}\n{';
      yield '"b":2}\n';
    }
    const out: any[] = [];
    for await (const p of parseJSONL(gen())) out.push(p);
    expect(out.length).toBe(2);
    expect(out[0].data).toEqual({ a: 1 });
    expect(out[1].data).toEqual({ b: 2 });
  });

  it("跨 chunk 的完整行", async () => {
    async function* gen() {
      yield '{"a":1}\n{"b';
      yield '":2}\n{"c":3}';
    }
    const out: any[] = [];
    for await (const p of parseJSONL(gen())) out.push(p);
    expect(out.length).toBe(3);
    expect(out[1].data).toEqual({ b: 2 });
  });
});

describe("parseJSONL: ReadableStream 输入", () => {
  it("字节流解码", async () => {
    const text = '{"a":1}\n{"b":2}\n';
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(text));
        ctrl.close();
      },
    });
    const out: any[] = [];
    for await (const p of parseJSONL(stream)) out.push(p);
    expect(out.length).toBe(2);
    expect(out[0].data).toEqual({ a: 1 });
  });

  it("分块字节流", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode('{"a":1}\n'));
        ctrl.enqueue(encoder.encode('{"b":'));
        ctrl.enqueue(encoder.encode('2}\n'));
        ctrl.enqueue(encoder.encode('{"c":3}'));
        ctrl.close();
      },
    });
    const out: any[] = [];
    for await (const p of parseJSONL(stream)) out.push(p);
    expect(out.length).toBe(3);
    expect(out[2].data).toEqual({ c: 3 });
  });

  it("空流", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrl.close(); },
    });
    const out: any[] = [];
    for await (const p of parseJSONL(stream)) out.push(p);
    expect(out.length).toBe(0);
  });
});

describe("parseJSONL: 文件流输入", () => {
  it("从文件读取", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { createReadStream } = await import("node:fs");
    const { Readable } = await import("node:stream");
    const path = "/tmp/jsonl-test-filestream.jsonl";
    await writeFile(path, '{"a":1}\n{"b":2}\n{"c":3}\n', "utf8");
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    const out: any[] = [];
    for await (const p of parseJSONL(stream)) out.push(p);
    expect(out.length).toBe(3);
    expect(out[1].data).toEqual({ b: 2 });
    await unlink(path).catch(() => {});
  });
});

// ---------- analyzeJSONL ----------

describe("analyzeJSONL: 流式逐行 analyze", () => {
  it("每行输出独立 schema", async () => {
    const input = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob","age":30}';
    const out: any[] = [];
    for await (const r of analyzeJSONL(input)) out.push(r);
    expect(out.length).toBe(2);
    expect(out[0].line).toBe(1);
    expect(out[0].result.find((i: any) => i.path === "root.name")?.sampleValue).toBe("Alice");
    // 第二行有 age 字段
    expect(out[1].result.find((i: any) => i.path === "root.age")?.type).toBe("number");
  });

  it("错误行被跳过", async () => {
    const input = '{"a":1}\nbad\n{"b":2}';
    const out: any[] = [];
    for await (const r of analyzeJSONL(input, { errorMode: "ignore" })) out.push(r);
    expect(out.length).toBe(2);
  });

  it("options 透传", async () => {
    const input = '{"a":[1,2,3,4,5,6,7,8]}';
    const out: any[] = [];
    for await (const r of analyzeJSONL(input, { maxArrayItems: 3, errorMode: "ignore" })) out.push(r);
    expect(out.length).toBe(1);
    const arrNode = out[0].result.find((i: any) => i.path === "root.a");
    expect(arrNode?.comment).toContain("truncated");
  });
});

// ---------- filterJSONL ----------

describe("filterJSONL: 流式逐行 filter", () => {
  it("命中行才 yield", async () => {
    const input = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Alice"}';
    const out: any[] = [];
    for await (const r of filterJSONL(input, { queries: [{ key: "name", op: "=", value: "Alice" }] })) {
      out.push(r);
    }
    expect(out.length).toBe(2);
    expect(out[0].line).toBe(1);
    expect(out[1].line).toBe(3);
    expect(out[0].result.matches[0].name).toBe("Alice");
  });

  it("无命中不 yield", async () => {
    const input = '{"id":1}\n{"id":2}';
    const out: any[] = [];
    for await (const r of filterJSONL(input, { queries: [{ key: "id", op: "=", value: "999" }] })) {
      out.push(r);
    }
    expect(out.length).toBe(0);
  });

  it("collectFilterJSONL 扁平化", async () => {
    const input = '{"users":[{"id":1},{"id":2}]}\n{"users":[{"id":3}]}';
    const out = await collectFilterJSONL(input, {
      queries: [{ key: "id", op: "=", value: "1" }],
    });
    expect(out.length).toBe(1);
    expect(out[0].line).toBe(1);
    expect(out[0].match.id).toBe(1);
  });
});

// ---------- searchJSONL ----------

describe("searchJSONL: 流式逐行 search", () => {
  it("按 pattern 搜 value", async () => {
    const input = '{"msg":"hello world"}\n{"msg":"goodbye"}\n{"msg":"hello again"}';
    const out: any[] = [];
    for await (const r of searchJSONL(input, { pattern: "hello" })) out.push(r);
    expect(out.length).toBe(2);
    expect(out[0].line).toBe(1);
    expect(out[1].line).toBe(3);
  });

  it("collectSearchJSONL 扁平化", async () => {
    const input = '{"a":"foo"}\n{"a":"bar"}\n{"a":"foobar"}';
    const out = await collectSearchJSONL(input, { pattern: "foo" });
    expect(out.length).toBe(2);
    expect(out[0].line).toBe(1);
    expect(out[1].line).toBe(3);
  });
});

// ---------- aggregateAnalyzeJSONL ----------

describe("aggregateAnalyzeJSONL: 跨行汇总", () => {
  it("累加 stats", async () => {
    const input = '{"a":1,"b":"x"}\n{"a":2,"b":"y","c":true}\n{"a":3}';
    const stats = await aggregateAnalyzeJSONL(input);
    expect(stats.totalLines).toBe(3);
    expect(stats.successfulLines).toBe(3);
    expect(stats.leafTypes.number).toBeGreaterThan(0);
    expect(stats.leafTypes.string).toBeGreaterThan(0);
  });

  it("错误行不计入 successfulLines", async () => {
    const input = '{"a":1}\nbad\n{"b":2}';
    const stats = await aggregateAnalyzeJSONL(input, { errorMode: "ignore" });
    // 注: totalLines 来自 schema count, 错误行无 schema, 所以只 2
    expect(stats.totalLines).toBe(2);
    expect(stats.successfulLines).toBe(2);
  });

  it("空输入", async () => {
    const stats = await aggregateAnalyzeJSONL("");
    expect(stats.totalLines).toBe(0);
    expect(stats.totalNodes).toBe(0);
  });

  it("bracket 转义 key 的深度计算正确", async () => {
    // "a.b" 含点号, 若用 split('.') 算深度会得到错误值
    const input = JSON.stringify({ "a.b": { c: 1 } }) + "\n";
    const stats = await aggregateAnalyzeJSONL(input);
    expect(stats.totalLines).toBe(1);
    // root → root["a.b"] → root["a.b"].c, 深度应为 2
    expect(stats.maxDepth).toBe(2);
  });
});

// ---------- 真实场景模拟 ----------

describe("JSONL 端到端", () => {
  it("从 ReadableStream 文件流到 analyze, 内存恒定", async () => {
    // 模拟大文件: 1 万行
    const lines: string[] = [];
    for (let i = 0; i < 10000; i++) {
      lines.push(JSON.stringify({ id: i, name: `user-${i}`, active: i % 2 === 0 }));
    }
    const text = lines.join("\n") + "\n";
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        // 分 100 次 enqueue 模拟分块
        const chunkSize = Math.ceil(text.length / 100);
        for (let i = 0; i < text.length; i += chunkSize) {
          ctrl.enqueue(encoder.encode(text.slice(i, i + chunkSize)));
        }
        ctrl.close();
      },
    });
    let count = 0;
    for await (const r of analyzeJSONL(stream)) {
      count++;
      // 只数行数, 不累积, 验证流式
      if (count === 1) {
        expect(r.line).toBe(1);
      }
    }
    expect(count).toBe(10000);
  });
});

describe("collectJSONLForMergedAnalyze", () => {
  it("maxLines 超出抛错", async () => {
    const input = '{"a":1}\n{"b":2}\n{"c":3}';
    await expect(collectJSONLForMergedAnalyze(input, { maxLines: 2 })).rejects.toThrow(/max-lines/);
  });

  it("正常合并", async () => {
    const input = '{"a":1}\n{"b":2}';
    const r = await collectJSONLForMergedAnalyze(input, { maxLines: 10 });
    expect(r.totalLines).toBe(2);
    expect(r.items).toEqual([{ a: 1 }, { b: 2 }]);
  });
});