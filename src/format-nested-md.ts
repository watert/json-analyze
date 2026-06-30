// object 大组: 按父 path 分节 + 子弹一层；map entry 不单独成节
import { getParent } from "./path-utils.js";
import type { FlatSchemaItem } from "./types.js";
import { buildExtraLine, buildTypeLabel, formatPlainList, inlineValue } from "./format.js";

const CONTAINER = new Set(["object", "record", "array"]);

function childSegmentName(parentPath: string, childPath: string): string {
  if (parentPath === "root") {
    const rest = childPath.replace(/^root\./, "");
    return rest.split(".")[0]?.replace(/\[\]/g, "") ?? childPath;
  }
  const prefix = parentPath + ".";
  if (!childPath.startsWith(prefix)) return childPath.split(".").pop()?.replace(/\[\]/g, "") ?? childPath;
  const tail = childPath.slice(prefix.length);
  return (tail.split(".")[0] ?? tail).replace(/\[\]/g, "");
}

function relPath(groupPath: string, path: string): string {
  if (path === groupPath) return path.replace(/^root\.?/, "") || "root";
  const dot = groupPath + ".";
  if (path.startsWith(dot)) return path.slice(dot.length);
  return path.replace(/^root\.?/, "");
}

function indexChildren(items: FlatSchemaItem[]): Map<string, FlatSchemaItem[]> {
  const m = new Map<string, FlatSchemaItem[]>();
  for (const it of items) {
    const p = getParent(it.path);
    if (!p) continue;
    const arr = m.get(p) ?? [];
    arr.push(it);
    m.set(p, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.path.localeCompare(b.path));
  return m;
}

function keysSig(item: FlatSchemaItem): string {
  if (item.type !== "object" || !item.keys?.length) return "";
  return item.keys.join("\0");
}

/** 父节点下多个 object 子节点 → 视为 map entry，不单独开节 */
function isMapEntryPath(path: string, groupPath: string, childrenOf: Map<string, FlatSchemaItem[]>): boolean {
  if (path === groupPath) return false;
  const par = getParent(path);
  if (!par) return false;
  const kids = childrenOf.get(par) ?? [];
  const objs = kids.filter((k) => k.type === "object");
  if (objs.length < 2) return false;
  return objs.some((o) => o.path === path);
}

function shouldEmitSection(path: string, groupPath: string, childrenOf: Map<string, FlatSchemaItem[]>): boolean {
  if (path === groupPath) return true;
  return !isMapEntryPath(path, groupPath, childrenOf);
}

/** 仅结构节计数，map entry 不计入缩进层级 */
function sectionIndentLevel(groupPath: string, path: string, childrenOf: Map<string, FlatSchemaItem[]>): number {
  if (path === groupPath) return 0;
  let level = 0;
  let cur: string | null = path;
  while (cur && cur !== groupPath) {
    if (shouldEmitSection(cur, groupPath, childrenOf)) level++;
    cur = getParent(cur);
  }
  return Math.max(0, level - 1);
}

function siblingShapeOverlap(children: FlatSchemaItem[]): string {
  const objs = children.filter((c) => c.type === "object" && c.keys?.length);
  if (objs.length < 2) return "";
  const sig = keysSig(objs[0]!);
  if (!sig || !objs.every((o) => keysSig(o) === sig)) return "";
  return ", entry shape overlap 100%";
}

function scalarBullet(item: FlatSchemaItem): string {
  const t = buildTypeLabel(item);
  if (item.sampleValue !== undefined && !item.longText) return `${t}, sample: ${inlineValue(item.sampleValue)}`;
  if (item.longText && item.originalLength) return `${t}, length: ${item.originalLength}`;
  if (item.type === "mixed" && item.variants?.length) {
    return `mixed, ${item.variants.map((x) => `${x.type}(${x.count})`).join(", ")}`;
  }
  const extra = buildExtraLine(item);
  return extra ? `${t}; ${extra}` : t;
}

function containerBullet(parentPath: string, item: FlatSchemaItem): string {
  const name = childSegmentName(parentPath, item.path);
  if (item.type === "record" && item.keysCount != null) return `* **${name}**: record[${item.keysCount}]`;
  if (item.type === "array" && item.itemTypes) {
    const n = item.itemTypes.reduce((s, it) => s + it.count, 0);
    return `* **${name}**: array[${n}]`;
  }
  const k = item.keys?.length ?? 0;
  return `* **${name}**: object (${k} keys);`;
}

function entryFieldsBlock(
  parentPath: string,
  entryObjs: FlatSchemaItem[],
  childrenOf: Map<string, FlatSchemaItem[]>
): string | null {
  if (entryObjs.length < 2) return null;
  const sig = keysSig(entryObjs[0]!);
  if (!sig || !entryObjs.every((o) => keysSig(o) === sig)) return null;
  const grand = childrenOf.get(entryObjs[0]!.path) ?? [];
  if (!grand.length) return null;
  const lines = grand.map((g) => `* **${childSegmentName(entryObjs[0]!.path, g.path)}**: ${scalarBullet(g)}`);
  return `fields per entry:\n${lines.join("\n")}`;
}

function sectionForParent(
  groupPath: string,
  parentPath: string,
  node: FlatSchemaItem | undefined,
  children: FlatSchemaItem[],
  childrenOf: Map<string, FlatSchemaItem[]>
): string {
  const label = relPath(groupPath, parentPath);
  const objs = children.filter((c) => c.type === "object");
  const allMapEntries = objs.length >= 2 && objs.length === children.filter((c) => CONTAINER.has(c.type)).length;

  const headType =
    node?.type === "object" && node.keys?.length
      ? `object (${node.keys.length} keys${siblingShapeOverlap(children)})`
      : node
        ? buildTypeLabel(node)
        : "object";
  const head = `\`${label}\`: ${headType}`;
  const meta = node ? buildExtraLine(node) : null;
  const bullets: string[] = [];

  for (const c of children) {
    const hasKids = (childrenOf.get(c.path)?.length ?? 0) > 0;
    if (c.type === "record") bullets.push(containerBullet(parentPath, c));
    else if (CONTAINER.has(c.type) && hasKids && !isMapEntryPath(c.path, groupPath, childrenOf)) {
      bullets.push(containerBullet(parentPath, c));
    } else if (c.type === "object" && isMapEntryPath(c.path, groupPath, childrenOf)) {
      bullets.push(containerBullet(parentPath, c));
    } else if (CONTAINER.has(c.type)) bullets.push(`* **${childSegmentName(parentPath, c.path)}**: object;`);
    else bullets.push(`* **${childSegmentName(parentPath, c.path)}**: ${scalarBullet(c)}`);
  }

  const entryFields = allMapEntries ? entryFieldsBlock(parentPath, objs, childrenOf) : null;

  if (!bullets.length && node?.type === "object" && node.keys?.length) {
    return `${head}\nkeys: ${formatPlainList(node.keys, 40)}${meta ? `\n${meta}` : ""}`;
  }
  return [head, meta, bullets.join("\n"), entryFields].filter(Boolean).join("\n");
}

function sectionParents(groupPath: string, paths: FlatSchemaItem[], childrenOf: Map<string, FlatSchemaItem[]>): string[] {
  const parents = new Set<string>();
  const under = (p: string) => p === groupPath || p.startsWith(groupPath + ".") || p.startsWith(groupPath + "[].");
  for (const it of paths) {
    if (it.path === groupPath) parents.add(groupPath);
    let cur: string | null = it.path;
    while (cur) {
      const par = getParent(cur);
      if (!par || !under(par)) break;
      if (shouldEmitSection(par, groupPath, childrenOf)) parents.add(par);
      cur = par;
    }
  }
  return [...parents].sort(
    (a, b) => sectionIndentLevel(groupPath, a, childrenOf) - sectionIndentLevel(groupPath, b, childrenOf) || a.localeCompare(b)
  );
}

export function renderNestedObjectGroup(groupPath: string, paths: FlatSchemaItem[]): string {
  const byPath = new Map(paths.map((p) => [p.path, p]));
  const childrenOf = indexChildren(paths);
  const parents = sectionParents(groupPath, paths, childrenOf);
  const blocks: string[] = [];

  for (const par of parents) {
    const node = byPath.get(par);
    const kids = childrenOf.get(par) ?? [];
    if (!kids.length && !(node?.keys?.length)) continue;
    const depth = sectionIndentLevel(groupPath, par, childrenOf);
    const indent = depth > 0 ? "  ".repeat(depth) : "";
    const body = sectionForParent(groupPath, par, node, kids, childrenOf);
    blocks.push(indent + body.split("\n").join("\n" + indent));
  }

  return `<group path="${groupPath}">\n${blocks.join("\n\n")}\n</group>`;
}

export function estimateNestedGroupBytes(groupPath: string, paths: FlatSchemaItem[]): number {
  return new TextEncoder().encode(renderNestedObjectGroup(groupPath, paths)).length;
}