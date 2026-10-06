# json-analyze

> TypeScript 源码直出，无编译产物；库调用直接引入 `src/index.ts`。

JSON Schema Analyzer — 将任意 JSON 数据转换为扁平化 schema 数组，支持 Markdown / JSON 输出。v2 新增循环引用检测、规模控制、路径提取、字段探索、摘要压缩等能力。**JSONL**：检索类子命令真流式；`analyze --jsonl` 默认合并 DESCRIBE（`--max-lines` 默认 50000，超大用 `--per-line`）。CLI 在 `src/cli/`。

## 安装

```bash
# 源码链到本机后, 任意目录都能 bunx (npm 上还没有这个包)
git clone https://github.com/watert/json-analyze.git
cd json-analyze
bun install
bun link

bunx json-analyze --help
bunx json-analyze stringify data.json --keys chapters
bunx json-analyze stringify data.json --auto --dry-run
```

## 使用方式

### 1. 库调用

```typescript
import { analyzeJSON, getParent, getByPath, summarizeSchema, compactSchema } from "json-analyze";

const data = { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] };
const schema = analyzeJSON(data);

// schema 为 FlatSchemaItem[]
console.log(schema);

// 获取父路径
console.log(getParent("root.users[].name")); // "root.users"

// 按路径提取数据值
const names = getByPath(data, "root.users[].name"); // ["Alice", "Bob"]

// 获取结构摘要
const summary = summarizeSchema(schema);
// { totalNodes, maxDepth, arraysCount, mixedFields, leafTypes, ... }

// 紧凑类型字符串 (省 token，适合 AI 上下文)
console.log(compactSchema(schema));
// "{ users: [id: number, name: string] }"
```

### 2. CLI 工具

单一入口 `json-analyze`。**无子命令**时输出 **Overview**（多 section 体检报告 + 各段底部 drill-down 命令）；深度模式用子命令。

子命令：`analyze` | `filter` | `summary` | `get` | `explore` | `search` | `compare` | `diff` | `stringify` | `help`

#### 默认 Overview

```bash
json-analyze data.json
json-analyze ./exports/          # 目录内递归 *.json
json-analyze '*.json' --max-files 50
json-analyze filter ./dir id=foo # 多文件 grep
cat data.json | json-analyze
json-analyze data.json --format json --pretty
```

#### `analyze` — schema 详情（默认分层 MD）

```bash
# 默认 -f md：Top 摘要 + record/group 嵌套；超 50KB 底部 record-digest
bun bin/json-analyze analyze data.json

bun bin/json-analyze analyze data.json --max-depth 16 --max-items 1000 --max-keys 200
bun bin/json-analyze analyze data.json --max-detail-bytes 51200 --top-summary 10
bun bin/json-analyze analyze data.json --path-prefix 'root.entities.users' -f md-flat
bun bin/json-analyze analyze data.json -f md-flat
bun bin/json-analyze analyze data.json --format json --pretty

cat data.json | bun bin/json-analyze analyze
```

#### `filter` — 按条件检索

**Query 语法**（空格分隔多个条件，AND 语义）:
- `key=value` — 字符串 substring 匹配（大小写不敏感）
- `key<n` / `key>n` / `key<=n` / `key>=n` — 数值比较
- **类型自动推断**: 数字 / `true` / `false` / `null` / 其余字符串

**关键选项**:
- `--key-match <str>` — 在对象的**键名**中搜索
- `--path-glob <pat>` — 限制搜索路径，`*` 通配（不跨 `.`）
- `--limit <n>` — 最多返回条数（默认 50）

**示例**:
```bash
json-analyze filter data.json id=k2p6
json-analyze filter data.json "cost.input<=1" --path-glob "*.models.*"
json-analyze filter models.json deepseek --key-match
cat big.json | json-analyze filter id=foo --limit 20 -p
```

#### `summary` — 结构摘要

```bash
# 输出 Markdown 摘要 + compact 结构
json-analyze summary data.json

# JSON 输出
json-analyze summary data.json --format json
```

输出示例:
```
## Structure
`{ users: [id: number | name?: string] }`

## Summary
- total nodes: 5
- max depth: 2
- arrays: 1 (0 empty, 0 truncated)
- objects: 2 (0 truncated)
- mixed fields: 0
- long-text fields: 0
- leaf types: `number`(1), `string`(1)
```

#### `get` — 按路径提取数据值

```bash
# 提取所有用户名字
json-analyze get 'users[].name' data.json

# 限制条数
json-analyze get 'items[].id' data.json --limit 20

# 管道
cat data.json | json-analyze get 'users[].name' --format json --pretty
```

支持路径语法: `root.users[].name`、`root.items[0]`、`root.data[].tags[]`、`root["key.with.dots"]`

#### `explore` — 探索字段值分布

```bash
# 查看字段的去重值
json-analyze explore 'users[].role' data.json

# 只看基数
json-analyze explore 'users[].role' data.json --cardinality

# 不去重
json-analyze explore 'users[].role' data.json --no-distinct
```

#### `stringify` — 长数组每元素一行 (v2.9)

指定 `keys` 或 `paths` 的数组，每个元素 `JSON.stringify` 成一行，其余结构保持缩进。输出仍是合法 JSON，`JSON.parse` 回来结构不变。写到 stdout，不改原文件。

`keys` 按 key 名全局匹配。`paths` 用和 `getByPath` 一样的路径，只压命中的那个数组，同名嵌套可以放过。不支持 `[?filter]`。

`--auto` 自己估展开行数：元素数不少于 4、里面有对象或数组、展开不少于 24 行、并且超过压后行数的 1.5 倍，才压。标量数组不压。命中后不再下钻，所以内层小数组会并进父元素那一行。`--auto` 与 `keys` / `paths` 取并集。`--dry-run` 只打印会压的 path。

```bash
json-analyze stringify data.json --keys chapters
json-analyze stringify data.json --paths 'root.books[].chapters'
json-analyze stringify data.json --auto
json-analyze stringify data.json --auto --dry-run
```

```typescript
import { stringifyInlineArrays, planInlineArrays } from "json-analyze";

stringifyInlineArrays(data, { keys: ["chapters"] });
stringifyInlineArrays(data, { paths: ["root.books[].chapters"] });
stringifyInlineArrays(data, { auto: true });
planInlineArrays(data, { auto: true });
```

未压到的 `Date` / class 会抛（避免被收成 `{}`）。压中数组里的 `undefined`、function、空洞也会抛。

## API 完整列表

### `analyzeJSON(data: any, opts?: AnalyzeOptions): FlatSchemaItem[]`

**v2 新增选项:**
```typescript
interface AnalyzeOptions {
  maxDepth?: number;        // 最大递归深度 (默认 32)
  maxArrayItems?: number;   // 每个数组最多分析的元素数 (默认 5000)
  maxKeysPerObject?: number; // 每个 object 最多列举的 key 数 (默认 500)
  sampleCount?: number;     // 每种类型最多收集的样本数 (默认 3)
}
```

**v2 新特性:**
- 循环引用检测：自引用 / 相互引用标记为 `type: "circular"`
- 非标准类型：Date → `date-object`、BigInt → `bigint`、Symbol → `symbol`、undefined → `undefined`
- 路径转义：含 `.`/`[`/`]` 的 key 自动转 bracket 格式 `root["a.b"]`
- 规模控制：大数组/大对象自动采样截断

### `getParent(path: string): string | null`

修复 v1 bug，正确处理多层嵌套数组路径。

### `getByPath(data: any, path: string, opts?: GetByPathOptions): any[]`

按路径提取数据值，支持 wildcard (`[]`)、数组下标 (`[0]`)、bracket 转义 key。

```typescript
getByPath(data, "root.users[].name")         // 所有用户名
getByPath(data, "root.users[0]")             // 第一个用户
getByPath(data, "root.data[].tags[]")        // 所有标签 (展开嵌套数组)
getByPath(data, 'root["dot.key"].value')     // bracket 转义
```

### `getFieldValues(data: any, path: string, opts?): FieldValueResult`

探索字段值分布。
```typescript
const r = getFieldValues(data, "root.items[].role");
// r.values = ["admin", "user"] (去重), r.distinct = 2, r.totalVisited = 10
```

### `getPathCardinality(data: any, path: string, opts?): CardinalityResult`

字段基数（去重数 / 总数）。
```typescript
const r = getPathCardinality(data, "root.users[].role");
// r.distinct = 3, r.total = 100
```

### `findPathsByType(schema: FlatSchemaItem[], type: string): FlatSchemaItem[]`

从 schema 中筛选指定类型的节点，用于快速定位异常字段。
```typescript
const mixed = findPathsByType(schema, "mixed");       // 所有类型冲突字段
const longTexts = findPathsByType(schema, "long-text"); // 所有长文本字段
```

### `summarizeSchema(schema: FlatSchemaItem[]): AnalyzeSummary`

生成高层摘要。
```typescript
interface AnalyzeSummary {
  totalNodes: number;
  maxDepth: number;
  arraysCount: number;
  objectsCount: number;
  mixedFields: number;
  longTextFields: number;
  emptyArrays: number;
  leafTypes: Record<string, number>;
  truncatedArrays: number;
  truncatedObjects: number;
}
```

### `compactSchema(schema: FlatSchemaItem[]): string`

生成紧凑类型字符串，类似 TypeScript 类型语法，极省 token。
```
"{ users: [id: number, name: string, tags: [string]?, active?: boolean] }"
```

### `filterJSON(data: any, opts: FilterOptions): FilterResult`

按多条件检索 JSON 内容（同 v1）。

### `renderMarkdown(items: FlatSchemaItem[]): string`

将 schema 渲染为 Markdown。

## JSONL 流式协议 (v2.3 新增)

零依赖手写行拆分，支持任意大小 JSONL 文件。所有 JSONL 函数返回 `AsyncGenerator`，自然处理背压、不累积内存。

**输入源支持**:
- `string` (原始文本)
- `BunFile` (零拷贝流式)
- `AsyncIterable<string>` (任意异步源)
- `ReadableStream<Uint8Array>` (Node/Bun 标准流)

### `parseJSONL(source, opts?): AsyncGenerator<ParsedLine>`

```typescript
import { parseJSONL } from "json-analyze";

for await (const { line, data } of parseJSONL(Bun.file("huge.jsonl"))) {
  console.log(`line ${line}:`, data);
}
```

`ParseOptions`:
- `errorMode`: `"skip"` (默认) | `"ignore"` | `"throw"` — 错误行处理
- `onError(line, raw, err)`: 自定义错误回调 (覆盖 stderr)
- `maxLineBytes`: 单行最大字节数 (0=无限)

### `analyzeJSONL(source, opts?): AsyncGenerator<LineResult<FlatSchemaItem[]>>`

```typescript
import { analyzeJSONL } from "json-analyze";

for await (const { line, result: schema } of analyzeJSONL(file, { maxDepth: 16 })) {
  console.log(`line ${line} has ${schema.length} nodes`);
}
```

### `filterJSONL(source, opts): AsyncGenerator<LineResult<FilterResult>>`

```typescript
import { filterJSONL, collectFilterJSONL } from "json-analyze";

// 流式: 命中行立即 yield
for await (const { line, result } of filterJSONL(file, {
  queries: [{ key: "id", op: "=", value: "k2p6" }],
})) {
  console.log(`line ${line}:`, result.matches);
}

// 或一次性收集
const hits = await collectFilterJSONL(file, { queries: [...] });
```

### `searchJSONL(source, opts): AsyncGenerator<LineResult<SearchResult>>`

```typescript
import { searchJSONL, collectSearchJSONL } from "json-analyze";

const hits = await collectSearchJSONL(file, { pattern: "deepseek" });
// → [{ line: 1, match: { path, key?, value } }, ...]
```

### `aggregateAnalyzeJSONL(source, opts?): Promise<AggregatedStats>`

跨行聚合 stats, 用于"几万行 JSONL 整体长啥样":

```typescript
import { aggregateAnalyzeJSONL } from "json-analyze";

const stats = await aggregateAnalyzeJSONL(Bun.file("logs.jsonl"));
// { totalLines: 10000, totalNodes: 50000, leafTypes: { number: 30000, string: 20000 }, ... }
```

### JSONL CLI

子命令支持 `--jsonl`。**`analyze --jsonl`**：默认合并为 `[item1, …]` 再 `analyzeJSON`（跨行 presence，**全量载入内存**）；`--max-lines` 默认 50000，超出报错；行数 >10000 会 stderr 警告。GB 级或低内存请 **`--per-line`**。`filter`/`search`/`get`/`explore`/`summary --jsonl` 为真流式。

```bash
# analyze: 默认按大数组合并 schema (推荐)
cat data.jsonl | json-analyze analyze --jsonl
# → 1 份统一 schema, "字段 X present in N/279 objects (optional)"

# analyze --per-line: 逐行 schema (高级场景)
cat data.jsonl | json-analyze analyze --jsonl --per-line
# → 每行一份 schema, 流式输出

# filter: 命中行立即 yield (天然 per-line)
cat data.jsonl | json-analyze filter --jsonl id=foo

# search: 命中行立即 yield (天然 per-line)
cat data.jsonl | json-analyze search --jsonl "deepseek"

# summary: 跨行聚合 stats
cat data.jsonl | json-analyze summary --jsonl

# get: 每行独立 getByPath
cat data.jsonl | json-analyze get --jsonl 'name'

# explore: 每行独立 explore
cat data.jsonl | json-analyze explore --jsonl 'items[].role'
```

`--jsonl` 时错误行默认 skip + 警告 (stderr), 数据行处理不受影响。

### `diffJSON(left, right, opts?: DiffJSONOptions)`

双 JSON 对比，输出 md / md-flat / json（CLI 同逻辑）。

### `collectJSONLForMergedAnalyze(source, opts?)`

合并模式载入 JSONL 为数组；`maxLines` 默认 `DEFAULT_JSONL_MERGE_MAX_LINES` (50000)。

### `readByKey(obj: any, key: string): any`

辅助读取嵌套字段值，支持点路径和数组下标。

## 核心类型

```typescript
interface FlatSchemaItem {
  path: string;
  type: string;               // object | array | string | number | boolean | null | date | long-text | mixed | circular | date-object | bigint | undefined | symbol
  sampleValue?: any;
  itemTypes?: ItemTypeEntry[];
  presence?: number;
  note?: string;
  comment?: string;
  longText?: boolean;
  originalLength?: number;
  variants?: VariantEntry[];
  keys?: string[];
}
```

## 示例输出

```markdown
**root** — `object`
keys: `data`

**root.data** — `array[3]`
items: `object(3)`

**root.data[].id** — `number`
sample: `1`
note: `present in 3/3 objects`

**root.data[].tags** — `array[3]`
items: `string(3)="a", "b", "c"`
note: `present in 2/3 objects (optional)`
```

## 全局安装

```bash
bun add -g file:$(pwd)
json-analyze --help
bun remove -g json-analyze
```

## 测试

```bash
bun run test          # vitest run，单次退出（非 watch）
bun run test:watch    # 开发时监听
```

Vitest（Bun/Node 均可）；覆盖 analyze / paths / JSONL / diff / format 等（`src/*.test.ts`）。
