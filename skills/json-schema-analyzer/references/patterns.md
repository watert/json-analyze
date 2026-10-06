# json-analyze — 使用模式

## 模式 1: 快速了解数据结构
```typescript
const schema = analyzeJSON(apiResponse);
const conflicts = schema.filter(item => item.type === "mixed");
```

## 模式 2: 检查可选字段
```typescript
const schema = analyzeJSON(data);
const optional = schema.filter(item => item.presence != null && item.presence < 3);
```

## 模式 3: 获取父节点
```typescript
const parentPath = getParent("root.data[].nested.field");
```

## 模式 4: 从大 JSON 检索数据
```typescript
const result = filterJSON(modelsDevApi, {
  queries: [{ key: "cost.input", op: "<=", value: "1" }],
  pathGlob: "*.models.*",
});
```

## 模式 5 (v2): 先看摘要再决策
```typescript
const schema = analyzeJSON(largeApiResponse, { maxArrayItems: 100 });
const summary = summarizeSchema(schema);
const compact = compactSchema(schema);
// 先把 compact + summary 给 AI 看，AI 决定 focus 哪个字段
// 再用 getByPath 精准提取
```

## 模式 6 (v2): 探索字段取值分布
```typescript
const schema = analyzeJSON(data);
const longTexts = findPathsByType(schema, "long-text");
// 查看某字段的不同取值
const vals = getFieldValues(data, "root.items[].category");
```

## 模式 7 (v2): 安全分析任意 JS 对象
```typescript
// 含循环引用 / Date / BigInt 的对象也安全
const circularObj = { a: 1 };
circularObj.self = circularObj;
const schema = analyzeJSON(circularObj); // 不会栈溢出
const c = findPathsByType(schema, "circular"); // [{ path: "root.self", type: "circular" }]
```

## 模式 8 (v2.1): 递归搜索 key/value
```typescript
// 不知道数据在哪层？直接 pattern 搜索
const result = searchJSON(largeApiDump, {
  pattern: "deepseek",
  keyOnly: true,
  pathGlob: "*.models.*",
});
// → [{ path: "root.deepseek.models.deepseek-v4-flash", key: "deepseek-v4-flash" }, ...]
```

## 模式 9 (v2.1): 探索 dict-key 结构
```typescript
// 列出根级别的所有 key (如 provider 列表)
const keys = getObjectKeys(data, "root");
// → { keys: ["deepseek", "vercel", "openrouter", ...], total: 140 }
```

## 模式 10 (v2.2): 跨节点路径通配 + 条件过滤
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

## 模式 11 (v2.2): 多路径对比
```bash
json-analyze compare \
  '*.models["deepseek-v4-flash"].cost' \
  '*.models["mimo-v2-flash"].cost' \
  data.json --fields 'input,output,cache_read'
```

## 模式 12 (v2.8): 长数组每条记录一行

```typescript
import { stringifyInlineArrays } from "json-analyze";

// 章列表一行一章, 章内的 tags 数组跟着压进同一行, 仍是数组
const text = stringifyInlineArrays(data, { keys: ["chapters"] });

// 只压顶层, 放过 book.chapters
stringifyInlineArrays(data, { paths: ["root.chapters"] });
```

```bash
json-analyze stringify stats.json --keys chapters
json-analyze stringify stats.json --paths 'root.books[].chapters'
```
