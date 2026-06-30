// DiffEvent 聚合为 summary 与按 path 分组
import isPlainObject from "lodash/isPlainObject.js";
import { getByPath } from "./paths.js";
import type { DiffEvent } from "./diff-walk.js";

export interface DiffSummaryRow {
  metric: string;
  left: string;
  right: string;
  delta: string;
}

export interface DiffGroup {
  path: string;
  kind: "record" | "object";
  added: string[];
  removed: string[];
  valueChanges: DiffEvent[];
  typeChanges: DiffEvent[];
  bytes: number;
  weight: number;
}

function countRecordKeys(v: unknown): number | null {
  if (isPlainObject(v)) return Object.keys(v as object).length;
  if (Array.isArray(v)) return v.length;
  return null;
}

export function buildSummaryRows(
  leftRoot: unknown,
  rightRoot: unknown,
  events: DiffEvent[],
  pathPrefix: string,
): DiffSummaryRow[] {
  const rows: DiffSummaryRow[] = [];
  const added = events.filter((e) => e.kind === "keyAdded").length;
  const removed = events.filter((e) => e.kind === "keyRemoved").length;
  const changed = events.filter((e) => e.kind === "valueChanged").length;
  const typed = events.filter((e) => e.kind === "typeChanged").length;

  rows.push({
    metric: "events (key +/- / value / type)",
    left: "—",
    right: "—",
    delta: `+${added} / -${removed} / ~${changed} / Δtype ${typed}`,
  });

  const entityPaths = ["root.entities.answers", "root.entities.questions", "root.entities.users", "root.entities.articles"];
  for (const p of entityPaths) {
    const l = getByPath(leftRoot, p, { limit: 1 })[0];
    const r = getByPath(rightRoot, p, { limit: 1 })[0];
    const lc = countRecordKeys(l);
    const rc = countRecordKeys(r);
    if (lc == null && rc == null) continue;
    const lStr = lc == null ? "—" : String(lc);
    const rStr = rc == null ? "—" : String(rc);
    const d = (rc ?? 0) - (lc ?? 0);
    rows.push({
      metric: p.replace(/^root\./, ""),
      left: lStr,
      right: rStr,
      delta: d === 0 ? "0" : d > 0 ? `+${d}` : String(d),
    });
  }

  rows.push({ metric: "scope", left: pathPrefix, right: pathPrefix, delta: "—" });
  return rows;
}

function parentGroupPath(path: string): string {
  if (path === "root") return "root";
  const m = path.match(/^(root(?:\.[^.\[]+|\["[^"]+"\])*)/);
  if (m) {
    const parts = path.split(".");
    if (parts.length <= 2) return path;
    return parts.slice(0, 2).join(".");
  }
  const segs = path.replace(/^root\.?/, "").split(/\.|\[/);
  const top = segs[0] ?? "";
  return top ? `root.${top.replace(/\]$/, "")}` : "root";
}

export function groupDiffEvents(events: DiffEvent[]): DiffGroup[] {
  const byPath = new Map<string, DiffGroup>();

  const ensure = (path: string): DiffGroup => {
    let g = byPath.get(path);
    if (!g) {
      g = {
        path,
        kind: path.includes("entities") ? "record" : "object",
        added: [],
        removed: [],
        valueChanges: [],
        typeChanges: [],
        bytes: 0,
        weight: 0,
      };
      byPath.set(path, g);
    }
    return g;
  };

  for (const e of events) {
    const gp = e.kind === "keyAdded" || e.kind === "keyRemoved" ? e.path : parentGroupPath(e.path);
    const g = ensure(gp);
    g.bytes += e.bytes;
    if (e.kind === "keyAdded" && e.key) g.added.push(e.key);
    if (e.kind === "keyRemoved" && e.key) g.removed.push(e.key);
    if (e.kind === "valueChanged") g.valueChanges.push(e);
    if (e.kind === "typeChanged") g.typeChanges.push(e);
  }

  for (const g of byPath.values()) {
    g.weight = g.bytes + g.added.length * 8 + g.removed.length * 8 + g.valueChanges.length * 12;
  }

  return [...byPath.values()].sort((a, b) => b.weight - a.weight);
}

export interface DiffJSONResult {
  labels: [string, string];
  pathPrefix: string;
  summary: DiffSummaryRow[];
  groups: Array<{
    path: string;
    added: string[];
    removed: string[];
    valueChanges: Array<{ path: string; left: unknown; right: unknown }>;
    typeChanges: Array<{ path: string; leftType?: string; rightType?: string }>;
  }>;
  truncated: boolean;
  totalEvents: number;
}