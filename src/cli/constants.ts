// CLI 子命令注册
export const SUB_COMMANDS = [
  "analyze",
  "filter",
  "summary",
  "get",
  "explore",
  "search",
  "compare",
  "diff",
  "help",
] as const;

export type SubCommand = (typeof SUB_COMMANDS)[number];

export const KNOWN_COMMANDS = new Set<string>(SUB_COMMANDS);