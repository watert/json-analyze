import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveInputTargets } from "./input-resolve.js";

describe("resolveInputTargets", () => {
  const base = join(tmpdir(), `json-analyze-resolve-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "a.json"), "{}");
    writeFileSync(join(base, "b.json"), "[]");
    mkdirSync(join(base, "sub"));
    writeFileSync(join(base, "sub", "c.json"), '{"x":1}');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("目录递归收集 json", async () => {
    const r = await resolveInputTargets(base, { maxFiles: 50 });
    expect(r.targets.length).toBe(3);
    expect(r.targets.every((t) => t.kind === "file")).toBe(true);
  });

  it("glob 匹配", async () => {
    const r = await resolveInputTargets("*.json", { maxFiles: 50, cwd: base });
    expect(r.targets.length).toBeGreaterThanOrEqual(2);
  });

  it("max-files 截断", async () => {
    const r = await resolveInputTargets(base, { maxFiles: 1 });
    expect(r.targets.length).toBe(1);
    expect(r.omitted).toBeGreaterThan(0);
  });

  it("无 spec 为 stdin", async () => {
    const r = await resolveInputTargets(undefined, {});
    expect(r.targets).toEqual([{ path: "<stdin>", kind: "stdin" }]);
  });
});