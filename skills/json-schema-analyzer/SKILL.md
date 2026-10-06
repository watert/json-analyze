---
name: json-schema-analyzer
description: Analyze arbitrary JSON data and convert it into a flattened schema array, or filter/query JSON content with auto-inferred types. v2.2 adds cross-node wildcard (*/[] on dict), filter expressions ([?key~pattern]), path diagnostics (getClosestKeys), and multi-path comparison (compare). v2.3 adds JSONL streaming protocol — async generator based parseJSONL/analyzeJSONL/filterJSONL/searchJSONL with zero-copy line splitting for arbitrary-size JSONL files. v2.8 adds stringifyInlineArrays and the stringify CLI: print chosen arrays one element per line (by key or path) while the rest stays indented, JSON.parse unchanged. v2.9 adds stringify --auto, which inlines object arrays whose pretty form is at least 24 lines and 1.5x the one-item-per-line form. Triggers when the user needs to understand JSON structure, find data by pattern, compare values across paths, get a compact schema digest for LLM prompt injection, stream-process JSONL files, or pretty-print long arrays as one record per line.
metadata:
  version: 2.9.0
---

# json-analyze — JSON Schema Analyzer & Filter v2.9

`json-analyze` 是一个轻量 JSON 工具集，提供：

1. **Analyze**: 将任意 JSON 数据转换为扁平化 schema 数组
2. **Filter**: 按查询条件检索 JSON 内容，专为大 JSON 文件设计
3. **Search**: 递归搜索 key/value
4. **Path Extract**: 按路径模式提取数据值 (`getByPath`)
5. **Explore**: 字段值分布探索、基数统计、object key 列表
6. **Compare**: 多路径取值对比，输出 markdown table
7. **Summary**: 结构摘要 + 紧凑 schema（极省 token，适合 AI 上下文）
8. **JSONL Streaming**: 零依赖流式处理 JSONL，逐行 async generator
9. **Stringify**: 指定 key / path，或 `--auto` 按展开行数，把长数组收成每个元素一行

## 何时使用

- 需要向 AI 描述一个 JSON 数据结构时（比原始 JSON 更紧凑、信息密度更高）
- 需要检查 JSON 中是否存在类型不一致的字段
- 需要了解数组内对象字段的可选性
- 需要从大 JSON 文件中快速定位若干匹配项
- 需要获取某个 path 的父节点路径
- 需要安全分析含循环引用的 JSON / 非标准类型 (Date, BigInt)
- 需要按路径精准提取值（如 `root.users[].name` → 所有用户名数组）
- 需要生成紧凑的类型摘要嵌入 AI prompt
- 需要处理任意大小的 JSONL 文件

## 核心 API 一览

| API | 一句话用途 |
|-----|-----------|
| `analyzeJSON(data, opts?)` | 递归分析任意 JSON，返回扁平 schema 数组 |
| `getParent(path)` | 获取 path 的父节点路径 |
| `getByPath(data, path, opts?)` | 按路径模式提取值，支持 `*` / `[]` / `[?key~pattern]` |
| `filterJSON(data, opts)` | 多条件检索，支持自动类型推断 |
| `searchJSON(data, opts)` | 递归搜索 key/value，对标 jq `.. \| select(test("pattern"))` |
| `getObjectKeys(data, path, opts?)` | 列出 object 节点的 key 列表 |
| `getFieldValues(data, path, opts?)` | 探索字段取值分布 |
| `getPathCardinality(data, path, opts?)` | 字段基数统计 |
| `findPathsByType(schema, type)` | 快速筛选异常字段（mixed/circular/long-text 等） |
| `summarizeSchema(schema)` | 高层结构摘要 |
| `compactSchema(schema)` | 生成紧凑类型字符串 |
| `renderAnalyzeMarkdown` / `renderGroupedFlatMarkdown` | 生成 analyze Markdown 报告 |
| `parseJSONL` / `analyzeJSONL` / `filterJSONL` / `searchJSONL` / `aggregateAnalyzeJSONL` | JSONL 流式处理 |
| `stringifyInlineArrays(data, { keys?, paths?, auto?, space? })` | 指定数组每元素一行，其余保持缩进 |
| `planInlineArrays(data, opts?)` | 同样的判定，只返回会被压的 path |

完整签名、参数、返回值与示例见 [references/api.md](references/api.md)。

## 最常用模式

### 模式 1: 快速了解数据结构
```typescript
const schema = analyzeJSON(apiResponse);
const conflicts = schema.filter(item => item.type === "mixed");
```

### 模式 5: 先看摘要再决策（省 token）
```typescript
const schema = analyzeJSON(largeApiResponse, { maxArrayItems: 100 });
const summary = summarizeSchema(schema);
const compact = compactSchema(schema);
// 先把 compact + summary 给 AI 看，再决定用 getByPath 精准提取
```

### 模式 8: 递归搜索 key/value
```typescript
const result = searchJSON(largeApiDump, {
  pattern: "deepseek",
  keyOnly: true,
  pathGlob: "*.models.*",
});
```

更多模式见 [references/patterns.md](references/patterns.md)。

## CLI 速查

```bash
json-analyze data.json                      # 默认 overview
json-analyze analyze data.json              # 默认 md 分层报告
json-analyze filter data.json id=foo        # 字段值过滤
json-analyze search deepseek data.json      # 递归搜索
json-analyze summary data.json              # 结构摘要
json-analyze get 'users[].name' data.json   # 按路径提取
json-analyze compare p1 p2 data.json        # 多路径对比
json-analyze stringify data.json --keys chapters
json-analyze stringify data.json --paths 'root.books[].chapters'
json-analyze stringify data.json --auto --dry-run
cat huge.jsonl | json-analyze analyze --jsonl
```

完整 CLI 子命令见 [references/cli.md](references/cli.md)。

## 注意事项

- **循环引用**: v2 会自动检测并标记为 `type: "circular"`，不再栈溢出
- **非标准类型**: Date/BigInt/Symbol 等 JS 特有类型会正确识别
- **路径转义**: key 含 `.`/`[`/`]` 时自动用 bracket 格式 `root["a.b"]`
- **规模控制**: 建议大 JSON 分析时设置 `maxArrayItems` / `maxKeysPerObject`
- **getByPath 路径语法**: `root.users[].name`（通配）、`root.users[0]`（下标）、`root["a.b"]`（转义）
- **filter query key**: 必须在 object 顶层或用点路径指向精确字段
- **search**: pattern 为 regex（case-insensitive），不确定字段名时替代 filter
- **JSONL 流式模式**: `--jsonl` 启用逐行 async generator，错误行默认 skip + stderr 警告；`summary --jsonl` 跨行聚合 stats
- **stringify**: 至少给 `--keys`、`--paths` 或 `--auto`。`auto` 要求元素数 >= 4、含对象/数组、展开 >= 24 行且超过压后的 1.5 倍。标量数组不压。`--dry-run` 只打印决定
- **analyze 默认 md (v2.6)**: Top 摘要 + record/group 嵌套；同质 map 不逐 entry 成节；超 50KB → 底部 ≥5 条 record-digest

## 相关文档

- [references/api.md](references/api.md) — 完整 API 文档
- [references/patterns.md](references/patterns.md) — 12 个使用模式
- [references/cli.md](references/cli.md) — CLI 子命令大全
- [README.md](../../README.md) — 库完整使用说明
- [src/analyzer.test.ts](../../src/analyzer.test.ts) — analyze 测试用例
- [src/filter.test.ts](../../src/filter.test.ts) — filter 测试用例
