import { describe, expect, it } from "vitest";
import { certificateLevel } from "./certificate-badge";

describe("certificateLevel", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 86400000);
  it("soglie dei badge", () => {
    expect(certificateLevel(inDays(-1), now)).toBe("expired");
    expect(certificateLevel(inDays(7), now)).toBe("critical");
    expect(certificateLevel(inDays(8), now)).toBe("warning");
    expect(certificateLevel(inDays(30), now)).toBe("warning");
    expect(certificateLevel(inDays(31), now)).toBe("ok");
  });
});
