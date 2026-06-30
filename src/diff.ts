// 双 JSON diff 入口
import { diffWalk, parseIgnorePaths, type DiffWalkOptions } from "./diff-walk.js";
import { buildSummaryRows, groupDiffEvents } from "./diff-summarize.js";
import {
  buildDiffJSON,
  renderDiffFlat,
  renderDiffMarkdown,
  type DiffFormatOptions,
} from "./diff-format.js";

export interface DiffJSONOptions extends DiffWalkOptions {
  leftFile?: string;
  rightFile?: string;
  leftLabel?: string;
  rightLabel?: string;
  format?: "md" | "md-flat" | "json";
  maxDetailBytes?: number;
  ignorePaths?: string;
  includeSchema?: boolean;
}

function basenameLabel(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.json$/i, "");
}

export function diffJSON(left: unknown, right: unknown, opts: DiffJSONOptions = {}) {
  const walkOpts: DiffWalkOptions = {
    pathPrefix: opts.pathPrefix ?? "root",
    ignorePathGlobs: parseIgnorePaths(opts.ignorePaths),
    valueDepth: opts.valueDepth ?? 4,
    dictKeyOnly: opts.dictKeyOnly,
    arrayMode: opts.arrayMode ?? "id",
    maxChanges: opts.maxChanges ?? 2000,
  };

  const events = diffWalk(left, right, walkOpts);
  const truncated = events.length >= (walkOpts.maxChanges ?? 2000);
  const summary = buildSummaryRows(left, right, events, walkOpts.pathPrefix ?? "root");
  const groups = groupDiffEvents(events);

  const leftFile = opts.leftFile ?? "left.json";
  const rightFile = opts.rightFile ?? "right.json";
  const leftLabel = opts.leftLabel ?? basenameLabel(leftFile);
  const rightLabel = opts.rightLabel ?? basenameLabel(rightFile);
  const format = opts.format ?? "md";

  if (format === "json") {
    return buildDiffJSON(summary, groups, [leftLabel, rightLabel], walkOpts.pathPrefix ?? "root", events, truncated);
  }
  if (format === "md-flat") {
    return renderDiffFlat(events);
  }

  const fmtOpts: DiffFormatOptions = {
    leftFile,
    rightFile,
    leftLabel,
    rightLabel,
    pathPrefix: walkOpts.pathPrefix ?? "root",
    maxDetailBytes: opts.maxDetailBytes,
    ignoreNote: walkOpts.ignorePathGlobs?.slice(0, 5).join(", "),
  };
  return renderDiffMarkdown(summary, groups, fmtOpts, truncated);
}

export { diffWalk, parseIgnorePaths, DEFAULT_DIFF_IGNORE } from "./diff-walk.js";
export type { DiffEvent, DiffWalkOptions } from "./diff-walk.js";