# json-analyze — CLI 子命令大全

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

# diff (v2.7): 双文件对比，默认 50KB + diff-digest
json-analyze diff fileA.json fileB.json --path-prefix root.entities --dict-key-only

# compare (v2.2): 多路径对比
json-analyze compare path1 path2 path3 data.json
json-analyze compare path1 path2 data.json --fields 'input,output'
json-analyze compare path1 path2 data.json --labels 'A,B'

# explore (v2 新增)
json-analyze explore 'items[].role' data.json
json-analyze explore 'users[].role' data.json --cardinality
json-analyze explore 'root' data.json --keys              # v2.1: 列出 object key

# stringify (v2.9): 指定数组每元素一行, stdout, 不改原文件
json-analyze stringify data.json --keys chapters
json-analyze stringify data.json --paths 'root.books[].chapters'
json-analyze stringify data.json --paths 'root.chapters' --paths 'root.notes'
json-analyze stringify data.json --auto
json-analyze stringify data.json --auto --dry-run
cat data.json | json-analyze stringify --keys items

# JSONL 流式模式 (v2.3): 分析类子命令支持 --jsonl (stringify 除外)
cat huge.jsonl | json-analyze analyze --jsonl       # 默认: 大数组合并 schema (含 presence)
cat huge.jsonl | json-analyze analyze --jsonl --per-line  # 逐行 schema (高级 / GB 级)
cat huge.jsonl | json-analyze filter --jsonl id=foo  # 命中行立即输出 (per-line)
cat huge.jsonl | json-analyze search --jsonl deepseek
cat huge.jsonl | json-analyze summary --jsonl       # 跨行聚合 stats
cat huge.jsonl | json-analyze get --jsonl 'name'
cat huge.jsonl | json-analyze explore --jsonl 'items[].role'
```
