# json-analyze — 完整 API 文档

## `analyzeJSON(data: any, opts?: AnalyzeOptions): FlatSchemaItem[]`

递归分析任意 JSON 数据，返回扁平化 schema 数组。

**v2 新特性：**
- **循环引用检测**：自引用 / 相互引用标记为 `type: "circular"`
- **规模控制** (大文件防护): `maxDepth` / `maxArrayItems` / `maxKeysPerObject`
- **非标准类型**：Date → `date-object`, BigInt → `bigint`, Symbol → `symbol`, undefined → `undefined`
- **路径转义**：含 `.`/`[`/`]` 的 key 自动转 bracket 格式 `root["a.b"]`

```typescript
import { analyzeJSON } from "json-analyze";

// 基础用法
const schema = analyzeJSON({
  users: [
    { id: 1, name: "Alice", active: true },
    { id: 2, name: "Bob" }
  ]
});

// v2: 规模控制
const schema = analyzeJSON(largeData, {
  maxDepth: 16,
  maxArrayItems: 1000,
  maxKeysPerObject: 200,
});
```

## `getParent(path: string): string | null`

```typescript
getParent("root.users[].name");     // "root.users"
getParent("root.a[].b[].c");        // "root.a[].b" (v2 修复多层数组)
getParent('root["a.b"]');           // "root"
```

## `getByPath(data: any, path: string, opts?: GetByPathOptions): any[]`

**v2 新增** — 按路径模式提取数据值。

```typescript
import { getByPath } from "json-analyze";

// 在分析完 schema 后，精准提取数据
getByPath(data, "root.users[].name");         // ["Alice", "Bob"]
getByPath(data, "root.users[0]");             // [{ id: 1, name: "Alice" }]
getByPath(data, "root.data[].tags[]");        // 展开所有嵌套数组元素
getByPath(data, 'root["dot.key"].value');     // bracket 转义 key
```

## `filterJSON(data: any, opts: FilterOptions): FilterResult`

按多条件检索 JSON 内容，支持**自动类型推断**。

```typescript
import { filterJSON } from "json-analyze";

// 字段值匹配
filterJSON(data, { queries: [{ key: "id", op: "=", value: "k2p6" }] });

// 多条件 + 数值范围
filterJSON(data, {
  queries: [
    { key: "cost.input", op: "<=", value: "1" },
    { key: "tool_call", op: "=", value: "true" },
  ],
});

// 命中 dict key (model id) — v2.1: 零 query 模式, keyMatch 支持 string | string[] 多值 OR
filterJSON(data, {
  queries: [],
  keyMatch: ["deepseek-v4-pro", "deepseek-v4-flash"],
  pathGlob: "*.models.*",
});
```

## `searchJSON(data: any, opts: SearchOptions): SearchResult`

**v2.1 新增** — 递归搜索 key/value，对标 jq 的 `.. | select(test("pattern"))`。当你不确定数据在哪一层时，search 是首选。

```typescript
import { searchJSON } from "json-analyze";

// 搜索所有 key 或 value 包含 "deepseek" 的节点
searchJSON(data, { pattern: "deepseek" });

// 只搜 key
searchJSON(data, { pattern: "deepseek", keyOnly: true });

// 限制搜索范围
searchJSON(data, {
  pattern: "deepseek",
  keyOnly: true,
  pathGlob: "*.models.*",
  limit: 10,
});
```

## `getObjectKeys(data: any, path: string, opts?): { keys: string[]; total: number; truncated: boolean }`

**v2.1 新增** — 列出 object 节点的 key 列表。解决 `explore` 无法探索非叶子节点的痛点。

```typescript
import { getObjectKeys } from "json-analyze";

// 列出根对象的所有 provider 名
const r = getObjectKeys(data, "root");
// { keys: ["deepseek", "vercel", "openrouter", ...], total: 140, truncated: false }
```

## `getFieldValues(data: any, path: string, opts?): FieldValueResult`

**v2 新增** — 探索字段取值分布。

```typescript
import { getFieldValues } from "json-analyze";

const r = getFieldValues(data, "root.items[].role");
// { values: ["admin", "user"], distinct: 2, totalVisited: 10, truncated: false }
```

## `getPathCardinality(data: any, path: string, opts?): CardinalityResult`

**v2 新增** — 字段基数。

```typescript
import { getPathCardinality } from "json-analyze";

const r = getPathCardinality(data, "root.users[].role");
// { distinct: 3, total: 100, truncated: false }
```

## `findPathsByType(schema: FlatSchemaItem[], type: string): FlatSchemaItem[]`

**v2 新增** — 快速筛选异常字段。

```typescript
import { findPathsByType } from "json-analyze";

const mixed = findPathsByType(schema, "mixed");        // 所有类型冲突
const circulars = findPathsByType(schema, "circular"); // 所有循环引用
const longTexts = findPathsByType(schema, "long-text"); // 所有长文本
```

## `summarizeSchema(schema: FlatSchemaItem[]): AnalyzeSummary`

**v2 新增** — 高层结构摘要。

```typescript
import { summarizeSchema } from "json-analyze";

const summary = summarizeSchema(schema);
// {
//   totalNodes: 42,
//   maxDepth: 5,
//   arraysCount: 3,
//   mixedFields: 2,
//   longTextFields: 1,
//   emptyArrays: 0,
//   leafTypes: { number: 10, string: 15, boolean: 3 },
//   truncatedArrays: 1,
//   truncatedObjects: 0
// }
```

## `compactSchema(schema: FlatSchemaItem[]): string`

**v2 新增** — 生成紧凑类型字符串，可直接嵌入 AI prompt 上下文，极省 token。

```typescript
import { compactSchema } from "json-analyze";

const c = compactSchema(schema);
// "{ users: [id: number, name: string, tags: [string]?, active?: boolean] }"
```

## `renderAnalyzeMarkdown` / `renderGroupedFlatMarkdown` (v2.6)

`analyze` CLI 默认 **`-f md`**：`renderGroupedFlatMarkdown` — 顶部 Top paths 摘要、正文 **`<record>`** 全字段 / **`<group>`** 嵌套分节（object 按父 path 一节 + 子弹；同质 map entry 只 `fields per entry` 一次，不为每个动态 key 单独成节）、超预算时正文底部 **`## Compressed groups (digest)`** + **`<record-digest>`**（`keyNames` + `_drill_`）。

| `-f` | 行为 |
|------|------|
| `md` | 分层 MD + record/group（默认，详情预算 **50KB** `--max-detail-bytes 51200`；超预算至少 **5** 个大组 digest） |
| `md-flat` | 全量扁平 path（`--path-prefix` drill 子树也用此格式） |
| `json` | schema JSON |

```typescript
import { renderAnalyzeMarkdown, renderGroupedFlatMarkdown, renderMarkdown } from "json-analyze";
renderAnalyzeMarkdown(schema, "md", { maxDetailBytes: 51200, drillFile: "data.json", top: 10 });
renderAnalyzeMarkdown(schema, "md-flat");
```

**Record 检测 (v2.5+)**：小样本高 overlap、`v2[hex]`、**walkMergedValues** 合并多样本、`标量同质 map`（`recordMinValues` 等）。629 fixture：`articles` / `users` record 见 `dict-record.test.ts`。

## JSONL 流式 API (v2.3 新增)

**核心：所有 JSONL 函数返回 `AsyncGenerator`，自然处理背压、不累积内存。**

输入源支持 `string` | `BunFile` | `AsyncIterable<string>` | `ReadableStream<Uint8Array>`。

```typescript
import {
  parseJSONL, analyzeJSONL, filterJSONL, searchJSONL,
  aggregateAnalyzeJSONL, collectFilterJSONL, collectSearchJSONL,
} from "json-analyze";

// 1. parseJSONL — 逐行解析
for await (const { line, data } of parseJSONL(Bun.file("huge.jsonl"))) {
  console.log(`line ${line}:`, data);
}

// 2. analyzeJSONL — 流式逐行 analyze (复用 analyzeJSON)
for await (const { line, result } of analyzeJSONL(file, { maxDepth: 16 })) {
  // result: FlatSchemaItem[]
}

// 3. filterJSONL — 命中行立即 yield
for await (const { line, result } of filterJSONL(file, {
  queries: [{ key: "id", op: "=", value: "k2p6" }],
})) {
  // result.matches: Array<matched nodes>
}

// 4. searchJSONL — 流式 search
for await (const { line, result } of searchJSONL(file, { pattern: "deepseek" })) {
  // result.matches: SearchMatch[]
}

// 5. aggregateAnalyzeJSONL — 跨行聚合 stats (Promise<AggregatedStats>)
const stats = await aggregateAnalyzeJSONL(Bun.file("logs.jsonl"));
// { totalLines, successfulLines, totalNodes, leafTypes, ... }

// 6. collectFilterJSONL / collectSearchJSONL — 一次性扁平化收集
const allHits = await collectFilterJSONL(file, opts);
// → Array<{ line, match, path }>
```

**ParseOptions 共享**:
- `errorMode`: `"skip"` (默认) | `"ignore"` | `"throw"`
- `onError(line, raw, err)`: 自定义错误处理
- `maxLineBytes`: 单行最大字节 (0=无限, 默认 0)
