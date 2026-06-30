// overview / summary 展示用截断
export const DEFAULT_COMPACT_DISPLAY_MAX = 4000;

export function truncateForDisplay(text: string, maxLen = DEFAULT_COMPACT_DISPLAY_MAX): string {
  if (text.length <= maxLen) return text;
  const omitted = text.length - maxLen;
  return `${text.slice(0, maxLen)} … [truncated ${omitted} chars; full: json-analyze analyze <file>]`;
}