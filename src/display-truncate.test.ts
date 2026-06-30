import { describe, expect, it } from "bun:test";
import { truncateForDisplay } from "./display-truncate.js";

describe("truncateForDisplay", () => {
  it("短文本不截断", () => {
    expect(truncateForDisplay("abc", 10)).toBe("abc");
  });
  it("超长截断", () => {
    const s = "x".repeat(5000);
    const out = truncateForDisplay(s, 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain("truncated");
  });
});