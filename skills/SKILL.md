---
name: json-schema-analyzer
description: Analyze arbitrary JSON data and convert it into a flattened schema array, or filter/query JSON content with auto-inferred types. v2.2 adds cross-node wildcard (*/[] on dict), filter expressions ([?key~pattern]), path diagnostics (getClosestKeys), and multi-path comparison (compare). v2.3 adds JSONL streaming protocol — async generator based parseJSONL/analyzeJSONL/filterJSONL/searchJSONL with zero-copy line splitting for arbitrary-size JSONL files. Triggers when the user needs to understand JSON structure, find data by pattern, compare values across paths, get a compact schema digest for LLM prompt injection, or stream-process JSONL files.
version: 2.6.0
---

# json-analyze — JSON Schema Analyzer & Filter v2.5

`json-analyze` 是一个轻量 JSON 工具集，提供：

1. **Analyze**: 将任意 JSON 数据转换为扁平化 schema 数组，帮助快速理解数据结构、类型分布和样本值
2. **Filter**: 按查询条件检索 JSON 内容，专为大 JSON 文件设计
3. **Search** (v2.1): 递归搜索 key/value，对标 jq 的 `.. | select(test("pattern"))`
4. **Path Extract**: 按路径模式提取数据值 (`getByPath`)，v2.2 支持跨节点 `*` / `[]` on dict / `[?key~pattern]` 过滤
5. **Explore**: 字段值分布探索、基数统计、object key 列表 (`getObjectKeys`)
6. **Compare** (v2.2): 多路径取值对比，`--fields` 展平子字段，输出 markdown table
7. **Summary**: 结构摘要 + 紧凑 schema (极省 token，适合 AI 上下文)
8. **JSONL Streaming** (v2.3): 零依赖流式处理 JSONL，逐行 async generator，支持任意大小文件

## 何时使用

- 需要向 AI 描述一个 JSON 数据结构时（比原始 JSON 更紧凑、信息密度更高）
- 需要检查 JSON 中是否存在类型不一致的字段
- 需要了解数组内对象字段的可选性（哪些字段不是每个对象都有）
- 需要从大 JSON 文件（如 models.dev、API dump）中快速定位若干匹配项
- 需要获取某个 path 的父节点路径
- **v2 新增**: 需要安全分析含循环引用的 JSON / 非标准类型 (Date, BigInt)
- **v2 新增**: 需要按路径精准提取值（如 `root.users[].name` → 所有用户名数组）
- **v2 新增**: 需要快速查看字段的取值分布 / 基数
- **v2 新增**: 需要生成紧凑的类型摘要嵌入 AI prompt（省 token）
- **v2.1 新增**: 不确定数据在哪一层，想用 pattern 递归搜索 key 或 value
- **v2.1 新增**: 想列出 dict-key 结构的所有 key（如 provider 列表）
- **v2.3 新增**: 需要处理 JSONL（每行一个 JSON 对象）—— 任意大小文件、零依赖手写行拆分、async generator 背压友好

## 核心工具

### `analyzeJSON(data: any, opts?: AnalyzeOptions): FlatSchemaItem[]`

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

### `getParent(path: string): string | null`

```typescript
getParent("root.users[].name");     // "root.users"
getParent("root.a[].b[].c");        // "root.a[].b" (v2 修复多层数组)
getParent('root["a.b"]');           // "root"
```

### `getByPath(data: any, path: string, opts?: GetByPathOptions): any[]`

**v2 新增** — 按路径模式提取数据值。

```typescript
import { getByPath } from "json-analyze";

// 在分析完 schema 后，精准提取数据
getByPath(data, "root.users[].name");         // ["Alice", "Bob"]
getByPath(data, "root.users[0]");             // [{ id: 1, name: "Alice" }]
getByPath(data, "root.data[].tags[]");        // 展开所有嵌套数组元素
getByPath(data, 'root["dot.key"].value');     // bracket 转义 key
```

### `filterJSON(data: any, opts: FilterOptions): FilterResult`

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

### `searchJSON(data: any, opts: SearchOptions): SearchResult`

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

### `getObjectKeys(data: any, path: string, opts?): { keys: string[]; total: number; truncated: boolean }`

**v2.1 新增** — 列出 object 节点的 key 列表。解决 `explore` 无法探索非叶子节点的痛点。

```typescript
import { getObjectKeys } from "json-analyze";

// 列出根对象的所有 provider 名
const r = getObjectKeys(data, "root");
// { keys: ["deepseek", "vercel", "openrouter", ...], total: 140, truncated: false }
```

### `getFieldValues(data: any, path: string, opts?): FieldValueResult`

**v2 新增** — 探索字段取值分布。

```typescript
import { getFieldValues } from "json-analyze";

const r = getFieldValues(data, "root.items[].role");
// { values: ["admin", "user"], distinct: 2, totalVisited: 10, truncated: false }
```

### `getPathCardinality(data: any, path: string, opts?): CardinalityResult`

**v2 新增** — 字段基数。

```typescript
import { getPathCardinality } from "json-analyze";

const r = getPathCardinality(data, "root.users[].role");
// { distinct: 3, total: 100, truncated: false }
```

### `findPathsByType(schema: FlatSchemaItem[], type: string): FlatSchemaItem[]`

**v2 新增** — 快速筛选异常字段。

```typescript
import { findPathsByType } from "json-analyze";

const mixed = findPathsByType(schema, "mixed");       // 所有类型冲突
const circulars = findPathsByType(schema, "circular"); // 所有循环引用
const longTexts = findPathsByType(schema, "long-text"); // 所有长文本
```

### `summarizeSchema(schema: FlatSchemaItem[]): AnalyzeSummary`

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

### `compactSchema(schema: FlatSchemaItem[]): string`

**v2 新增** — 生成紧凑类型字符串，可直接嵌入 AI prompt 上下文，极省 token。

```typescript
import { compactSchema } from "json-analyze";

const c = compactSchema(schema);
// "{ users: [id: number, name: string, tags: [string]?, active?: boolean] }"
```

### `renderAnalyzeMarkdown` / `renderGroupedFlatMarkdown` (v2.6)

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

### JSONL 流式 API (v2.3 新增)

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

## 使用模式

### 模式 1: 快速了解数据结构
```typescript
const schema = analyzeJSON(apiResponse);
const conflicts = schema.filter(item => item.type === "mixed");
```

### 模式 2: 检查可选字段
```typescript
const schema = analyzeJSON(data);
const optional = schema.filter(item => item.presence != null && item.presence < 3);
```

### 模式 3: 获取父节点
```typescript
const parentPath = getParent("root.data[].nested.field");
```

### 模式 4: 从大 JSON 检索数据
```typescript
const result = filterJSON(modelsDevApi, {
  queries: [{ key: "cost.input", op: "<=", value: "1" }],
  pathGlob: "*.models.*",
});
```

### 模式 5 (v2): 先看摘要再决策
```typescript
const schema = analyzeJSON(largeApiResponse, { maxArrayItems: 100 });
const summary = summarizeSchema(schema);
const compact = compactSchema(schema);
// 先把 compact + summary 给 AI 看，AI 决定 focus 哪个字段
// 再用 getByPath 精准提取
```

### 模式 6 (v2): 探索字段取值分布
```typescript
const schema = analyzeJSON(data);
const longTexts = findPathsByType(schema, "long-text");
// 查看某字段的不同取值
const vals = getFieldValues(data, "root.items[].category");
```

### 模式 7 (v2): 安全分析任意 JS 对象
```typescript
// 含循环引用 / Date / BigInt 的对象也安全
const circularObj = { a: 1 };
circularObj.self = circularObj;
const schema = analyzeJSON(circularObj); // 不会栈溢出
const c = findPathsByType(schema, "circular"); // [{ path: "root.self", type: "circular" }]
```

### 模式 8 (v2.1): 递归搜索 key/value
```typescript
// 不知道数据在哪层？直接 pattern 搜索
const result = searchJSON(largeApiDump, {
  pattern: "deepseek",
  keyOnly: true,
  pathGlob: "*.models.*",
});
// → [{ path: "root.deepseek.models.deepseek-v4-flash", key: "deepseek-v4-flash" }, ...]
```

### 模式 9 (v2.1): 探索 dict-key 结构
```typescript
// 列出根级别的所有 key (如 provider 列表)
const keys = getObjectKeys(data, "root");
// → { keys: ["deepseek", "vercel", "openrouter", ...], total: 140 }
```

### 模式 10 (v2.2): 跨节点路径通配 + 条件过滤
```typescript
// [] on dict — models 为 dict 也可遍历
getByPath(data, "root.deepseek.models[].cost.input");
// → [0.14, 0.435, 0.14, 0.14]

// * globstar — 跨 provider 搜索同名 model
getByPath(data, 'root.*.models["deepseek-v4-flash"].cost.input');
// → [0.14, 0.14, ...] 所有 provider 下的 deepseek-v4-flash

// [?key~pattern] — 条件筛选 key
getByPath(data, "root.*.models[?key~deepseek].cost.input");
// → 只遍历 key 含 "deepseek" 的 model 的 cost.input
```

### 模式 11 (v2.2): 多路径对比
```bash
json-analyze compare \
  '*.models["deepseek-v4-flash"].cost' \
  '*.models["mimo-v2-flash"].cost' \
  data.json --fields 'input,output,cache_read'
```

## CLI 工具

```bash
# 默认 overview
json-analyze data.json
cat data.json | json-analyze

# analyze (默认 md 分层 + 50KB 预算；-f md-flat 扁平)
json-analyze analyze data.json
json-analyze analyze data.json --max-detail-bytes 51200 --top-summary 10
json-analyze analyze data.json --path-prefix 'root.entities' -f md-flat
json-analyze analyze data.json -f md-flat
json-analyze analyze data.json -f json
json-analyze analyze data.json --max-depth 16 --max-items 1000
cat data.json | json-analyze analyze

# analyze --list-keys (v2.1): 只列出 object key 树
json-analyze analyze data.json --list-keys --key-depth 1

# filter
json-analyze filter data.json id=foo
json-analyze filter models.json --key-match deepseek-v4-flash --path-glob "*.models.*"  # v2.1: 零 query

# search (v2.1): 递归搜索 key/value
json-analyze search deepseek data.json
json-analyze search 'gemini|glm' data.json --key-only --path-glob '*.models.*'

# summary (v2 新增)
json-analyze summary data.json

# get (v2 新增)
json-analyze get 'users[].name' data.json
cat data.json | json-analyze get 'items[].id' --limit 20
json-analyze get '*.models[?key~deepseek].cost.input' data.json  # v2.2: 跨节点过滤

# compare (v2.2): 多路径对比
json-analyze compare path1 path2 path3 data.json
json-analyze compare path1 path2 data.json --fields 'input,output'
json-analyze compare path1 path2 data.json --labels 'A,B'

# explore (v2 新增)
json-analyze explore 'items[].role' data.json
json-analyze explore 'users[].role' data.json --cardinality
json-analyze explore 'root' data.json --keys              # v2.1: 列出 object key

# JSONL 流式模式 (v2.3): 所有子命令支持 --jsonl
cat huge.jsonl | json-analyze analyze --jsonl       # 默认: 大数组合并 schema (含 presence)
cat huge.jsonl | json-analyze analyze --jsonl --per-line  # 逐行 schema (高级 / GB 级)
cat huge.jsonl | json-analyze filter --jsonl id=foo  # 命中行立即输出 (per-line)
cat huge.jsonl | json-analyze search --jsonl deepseek
cat huge.jsonl | json-analyze summary --jsonl       # 跨行聚合 stats
cat huge.jsonl | json-analyze get --jsonl 'name'
cat huge.jsonl | json-analyze explore --jsonl 'items[].role'
```

## 注意事项

- **循环引用**: v2 会自动检测并标记为 `type: "circular"`，不再栈溢出
- **非标准类型**: Date/BigInt/Symbol 等 JS 特有类型会正确识别
- **路径转义**: key 含 `.`/`[`/`]` 时自动用 bracket 格式 `root["a.b"]`
- **规模控制**: 建议大 JSON 分析时设置 `maxArrayItems` / `maxKeysPerObject`
- **日期识别约束**: 字符串长度 ≥ 8 且含日期分隔符
- **长文本处理**: 长度 > 60 截断
- **getByPath 路径语法**: `root.users[].name` (wildcard)、`root.users[0]` (下标)、`root["a.b"]` (转义)
- **filter query key**: 必须在 object 顶层或用点路径指向精确字段
- **search (v2.1)**: 当不知道字段名时可替代 filter 进行模糊搜索；pattern 为 regex (case-insensitive)
- **getObjectKeys (v2.1)**: 探索 dict-key 结构的首选；路径指向 object 节点, 返回其 key 列表
- **`--key-match` 零 query 模式 (v2.1)**: `filter --key-match pattern` 不再要求 field query, 可单独使用
- **filter pathGlob (v2.1 fix)**: 校验完整路径(含命中 key)而非父路径
- **`*` globstar (v2.2)**: 在 getByPath 路径中通配 object 任意 key; `*.models.x` 跨所有 provider
- **`[]` on dict (v2.2)**: wildcard 遍历 object values, 不再要求 Array; `models[].cost` 对 dict 也有效
- **`[?key~pattern]` (v2.2)**: 路径内条件过滤, 语法 `[?key~regex]` 或 `[?field=value]`
- **`get` 诊断 (v2.2)**: 路径失败时自动 Levenshtein 模糊匹配输出最近 key
- **`compare` (v2.2)**: 多路径取值对比, `--fields` 展平子字段, `--labels` 自定义列名
- **`analyze --list-keys --path-glob --fold` (v2.2)**: 限制 key 列表范围 + 折叠叶子节点
- **JSONL 流式模式 (v2.3)**: `--jsonl` 启用逐行 async generator 处理，支持任意大小文件; 错误行默认 skip + stderr 警告，不影响有效行; `BunFile` 走零拷贝 stream，stdin 走 AsyncIterable 喂入; `summary --jsonl` 跨行聚合 stats
- **默认 overview (v2.4)**: `json-analyze [file]` 六段 Markdown；库 `renderOverviewMarkdown` / `buildOverviewJSON`
- **analyze 默认 md (v2.6)**: Top 摘要 + record/group 嵌套；同质 map 不逐 entry 成节；超 50KB → 底部 ≥5 条 record-digest；drill `--path-prefix` + `-f md-flat`
- **`analyze --jsonl` 默认按大数组处理 (v2.3.1)**: 把所有行合并为 `[]` 调一次 `analyzeJSON`, 输出统一 schema 含 presence/optional/mixed 跨行统计 (类似 SQL DESCRIBE); 加 `--per-line` 切回逐行 (高级 / 调试 / GB 级文件); `filter/search/get/explore --jsonl` 仍保持 per-line (天然按行查的语义)

## 相关文档

- `packages/json-analyze/README.md` — 完整使用说明和 API 文档
- `packages/json-analyze/src/analyzer.test.ts` — analyze 测试用例
- `packages/json-analyze/src/analyzer-v2.test.ts` — v2 新特性测试
- `packages/json-analyze/src/paths.test.ts` — getByPath 测试
- `packages/json-analyze/src/explore-summarize.test.ts` — explorer/summarize 测试
- `packages/json-analyze/src/filter.test.ts` — filter 测试用例
- `docs/json-schema-analyzer.md` — 原始规范文档
