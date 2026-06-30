// 路径工具：转义、解析、拼接、getParent
import type { PathSegment } from "./types.js";

/** 判断 key 是否需要 bracket 转义 */
function needEscape(key: string): boolean {
  return /[.\[\]"\\\s]/.test(key);
}

/** 构建父路径 → 子路径 */
export function appendPathKey(parentPath: string, key: string): string {
  if (needEscape(key)) return `${parentPath}["${key}"]`;
  return `${parentPath}.${key}`;
}

/** 构建数组元素字段路径: parent → parent[].key */
export function appendArrayFieldKey(parentPath: string, key: string): string {
  if (needEscape(key)) return `${parentPath}[].["${key}"]`;
  return `${parentPath}[].${key}`;
}

/** 构建内层数组路径: parent → parent[] */
export function appendInnerArray(parentPath: string): string {
  return `${parentPath}[]`;
}

/** 将路径拆为 PathSegment[] */
export function splitPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      continue;
    }
    // bracket: ["..."] 或 []
    if (path.startsWith("[]", i)) {
      segments.push({ type: "wildcard" });
      i += 2;
      continue;
    }
    if (path.startsWith('["', i)) {
      const end = path.indexOf('"]', i + 2);
      if (end === -1) throw new Error(`unclosed bracket in path: ${path}`);
      segments.push({ type: "key", value: path.slice(i + 2, end) });
      i = end + 2;
      continue;
    }
    // 数组下标: [0]
    if (path[i] === "[") {
      // [?...] filter 表达式
      if (path.startsWith("[?", i)) {
        const end = path.indexOf("?]", i + 2);
        if (end === -1) {
          const end2 = path.indexOf("]", i);
          if (end2 === -1) throw new Error(`unclosed bracket in path: ${path}`);
          segments.push({ type: "filter", value: path.slice(i + 2, end2) });
          i = end2 + 1;
        } else {
          segments.push({ type: "filter", value: path.slice(i + 2, end) });
          i = end + 2;
        }
        continue;
      }
      const end = path.indexOf("]", i);
      if (end === -1) throw new Error(`unclosed bracket in path: ${path}`);
      segments.push({ type: "index", value: path.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // 普通 key 段
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    const key = path.slice(i, j);
    if (key === "*") {
      segments.push({ type: "globstar" });
    } else {
      segments.push({ type: "key", value: key });
    }
    i = j;
  }
  return segments;
}

/** 获取指定 path 的父节点路径 */
export function getParent(path: string): string | null {
  if (path === "root") return null;
  const segs = splitPath(path);
  // 去掉开头的 "root" segment（splitPath 会把 root 作为普通 segment）
  if (segs.length > 0 && segs[0].type === "key" && segs[0].value === "root") {
    segs.shift();
  }
  if (segs.length === 0) return null;
  // 去掉最后一个 segment
  segs.pop();
  // [ ] /*/[?] are qualifiers, not standalone nodes — strip trailing
  while (segs.length > 0 && (segs[segs.length - 1].type === "wildcard" || segs[segs.length - 1].type === "globstar" || segs[segs.length - 1].type === "filter")) {
    segs.pop();
  }
  if (segs.length === 0) return "root";
  return joinSegments("root", segs);
}

/** 拼接一段 segments 到 parent 路径后 */
function joinSegments(parent: string, segments: PathSegment[]): string {
  let result = parent;
  for (const seg of segments) {
    if (seg.type === "wildcard") {
      result += "[]";
    } else if (seg.type === "globstar") {
      result += ".*";
    } else if (seg.type === "filter") {
      result += `[?${seg.value}]`;
    } else if (seg.type === "index") {
      result += `[${seg.value}]`;
    } else {
      result = appendPathKey(result, seg.value!);
    }
  }
  return result;
}

/** 去掉 "root" 前缀的后缀路径（用于 pathGlob 匹配） */
export function subPath(path: string): string {
  return path.startsWith("root.") ? path.slice(5) : path === "root" ? "" : path;
}

/** 计算路径深度(排除 root segment) */
export function countPathDepth(path: string): number {
  const segs = splitPath(path);
  // 去除开头的 root segment
  let start = 0;
  if (segs.length > 0 && segs[0].type === "key" && segs[0].value === "root") start = 1;
  return segs.length - start;
}
