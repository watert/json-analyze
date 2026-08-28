// CLI 帮助文本
import type { SubCommand } from "./constants.js";

export function printHelp(cmd?: SubCommand) {
  if (!cmd || cmd === "help") {
    console.log(`json-analyze — JSON 工具集 v2.7

Usage:
  json-analyze [file|dir|glob]     # 默认 Overview；目录/glob 多文件
  cat data.json | json-analyze

Input (多文件):
  --max-files 100   --no-recurse   --ext json,jsonl
  --root <dir> --glob '<pat>'      # 与 filter query 并用
  --on-error skip|fail             # 默认 skip
  json-analyze <command> [options] [file]
  cat data.jsonl | json-analyze <command> --jsonl [options]

Commands:
  (default)  无子命令 → overview；--format json
  analyze    分析 JSON 结构 (md|md-flat|json)
  filter     按查询条件检索 JSON 内容
  summary    输出 JSON 结构高层摘要
  get        按路径提取数据值
  explore    探索字段的值分布 / 基数 / key 列表
  search     递归搜索 key / value (grep for JSON)
  compare    多路径取值对比, 输出 markdown table
  diff       双 JSON 文件对比 (AI Friendly, 50KB digest)
  help       显示帮助

JSONL:
  filter/search/get/explore/summary --jsonl  逐行流式, 背压友好
  analyze --jsonl  默认合并全文件为数组再 DESCRIBE (受 --max-lines 限制, 全量内存)
  analyze --jsonl --per-line  逐行 schema, 大文件用

Run 'json-analyze <command> --help' for command-specific help.
`);
    return;
  }
  if (cmd === "analyze") {
    console.log(`Usage: json-analyze analyze [file] [options]
       cat file.json | json-analyze analyze [options]
       cat file.jsonl | json-analyze analyze --jsonl [options]

Options:
  -f, --format   输出格式: md | md-flat | tree | xml | json (默认: md，紧凑语义 tag)
  -p, --pretty   与 --format json 配合时美化输出
      --jsonl         JSONL: 默认合并为大数组 schema (全量内存, 见 --max-lines)
      --per-line      JSONL 逐行 schema (大文件/调试)
      --max-lines     合并模式最多载入行数 (默认: 50000)
      --max-depth      最大递归深度 (默认: 32)
      --max-items      每个数组最多分析的元素数 (默认: 5000)
      --max-keys       每个 object 最多列举的 key 数 (默认: 500)
      --list-keys      只列出 object 节点的 key 列表 (树状)
      --key-depth      配合 --list-keys 限制深度 (默认: 1, 只列第一层 key)
      --path-glob      配合 --list-keys 限制路径范围, 支持 * 通配
      --fold           配合 --list-keys, 折叠叶子节点只显示 key 数量
      --top-summary  顶部重量级 path 摘要条数 (默认: 10)
      --max-detail-bytes  详情区字节上限，超出则大组 record-digest (默认: 51200，至少压 5 组)
      --path-prefix  只输出该 path 子树 (md-flat)，用于 digest drill
  -h, --help     显示帮助

JSONL 语义:
  --jsonl 默认: 所有行合并为一个大数组, 调一次 analyzeJSON (presence/optional/mixed 跨行)
                超过 --max-lines 报错; 超大文件请 --per-line
  --jsonl --per-line: 每行独立 schema, 流式输出
`);
    return;
  }
  if (cmd === "filter") {
    console.log(`Usage: json-analyze filter [file] [options] [query...]
       cat file.jsonl | json-analyze filter --jsonl [options] [query...]

Query 语法 (空格分隔多个条件):
  key=value              字符串/数字/布尔/null 精确匹配 (string 自动转 substring)
  key<n | key>n          数值小于/大于
  key<=n | key>=n        数值小于等于/大于等于

Options:
  -f, --format       输出格式: json | md (默认: json)
  -p, --pretty       美化 JSON 输出
      --jsonl         启用 JSONL 流式模式 (每行独立 filter, 命中行立即输出)
      --key-match    在对象 KEY 中搜索 (用于 dict-key 数据)
      --path-glob    限制搜索路径，支持 * 通配
      --max-depth    最大搜索深度 (默认: 32)
      --limit        最多输出多少条匹配 (默认: 50)
  -h, --help         显示帮助
`);
    return;
  }
  if (cmd === "summary") {
    console.log(`Usage: json-analyze summary [file] [options]
       cat file.json | json-analyze summary
       cat file.jsonl | json-analyze summary --jsonl

Options:
  -f, --format   输出格式: json | md (默认: md)
  -p, --pretty   美化 JSON 输出
      --jsonl     JSONL 模式下聚合所有行的 stats
  -h, --help   显示帮助
`);
    return;
  }
  if (cmd === "get") {
    console.log(`Usage: json-analyze get <path> [file] [options]
       cat file.json | json-analyze get <path>
       cat file.jsonl | json-analyze get <path> --jsonl

Options:
  -f, --format   输出格式: json | md (默认: json)
  -p, --pretty   美化 JSON 输出
      --jsonl     JSONL 流式模式, 每行独立提取
      --limit    最多提取条数 (默认: 100)
  -h, --help   显示帮助

例:
  json-analyze get 'users[].name' data.json
  cat data.json | json-analyze get 'items[].id' --limit 20
`);
    return;
  }
  if (cmd === "explore") {
    console.log(`Usage: json-analyze explore <path> [file] [options]
       cat file.json | json-analyze explore <path>
       cat file.jsonl | json-analyze explore <path> --jsonl

Options:
  -f, --format       输出格式: json | md (默认: md)
      --jsonl         JSONL 流式模式, 每行独立探索
      --limit        最多提取条数 (默认: 100)
      --no-distinct  不去重 (默认去重)
      --cardinality  只输出基数 (distinct/total)
      --keys         列出 object 节点的 key 列表 (非叶子探索)
  -h, --help         显示帮助

例:
  json-analyze explore 'items[].role' data.json
  json-analyze explore 'items[].role' data.json --cardinality
  json-analyze explore 'root' data.json --keys         # 列出根对象的所有 key
`);
    return;
  }
  if (cmd === "search") {
    console.log(`Usage: json-analyze search <pattern> [file] [options]
       cat file.json | json-analyze search <pattern>
       cat file.jsonl | json-analyze search <pattern> --jsonl

Options:
  -f, --format       输出格式: json | md (默认: md)
  -p, --pretty       美化 JSON 输出
      --jsonl         JSONL 流式模式, 命中行立即输出
      --key-only     只搜索 key (默认 key+value)
      --value-only   只搜索 value
      --path-glob    限制搜索路径, 支持 * 通配
      --max-depth    最大搜索深度 (默认: 32)
      --limit        最多输出多少条匹配 (默认: 50)
  -h, --help         显示帮助

例:
  json-analyze search deepseek data.json
  json-analyze search 'gemini|glm' data.json --key-only
  cat data.json | json-analyze search '0\\.14' --value-only --path-glob '*.cost.*'
`);
    return;
  }
  if (cmd === "compare") {
    console.log(`Usage: json-analyze compare <path1> <path2> [...] [file] [options]
       cat file.json | json-analyze compare <path1> <path2> [...]

Options:
  -f, --format   输出格式: md-table | json (默认: md-table)
      --labels   逗号分隔的列标签 (默认: 从路径末段推断)
      --fields   逗号分隔的子字段名, 用于展平 object (如 input,output)
      --limit    每个路径最多提取条数 (默认: 10)
  -h, --help     显示帮助

例:
  json-analyze compare \\
    'deepseek.models["deepseek-v4-flash"].cost' \\
    'vercel.models["xiaomi/mimo-v2.5"].cost' \\
    'openrouter.models["stepfun/step-3.5-flash"].cost' \\
    data.json --limit 1
`);
    return;
  }
  if (cmd === "diff") {
    console.log(`Usage: json-analyze diff <fileA> <fileB> [options]

Options:
  -f, --format          md | md-flat | json (默认 md)
      --labels          列名, 逗号分隔 (默认 basename)
      --path-prefix     只 diff 子树 (默认 root)
      --max-detail-bytes  默认 51200
      --ignore-paths    逗号 glob; 空串表示不忽略
      --dict-key-only   record 只报 key 增删
      --array-mode      index | id (默认 id)
      --value-depth     默认 4
      --max-changes     收集上限, 默认 2000
  -h, --help

例:
  json-analyze diff a.json b.json --path-prefix root.entities --dict-key-only
`);
  }
}