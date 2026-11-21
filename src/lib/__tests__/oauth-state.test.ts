import { describe, expect, it } from "vitest";
import { newOAuthState, statesMatch } from "@/lib/oauth-state";
import { buildTikTokAuthUrl } from "@/lib/connectors/tiktok";

describe("OAuth state", () => {
  it("generates unguessable, distinct values", () => {
    const a = newOAuthState();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(newOAuthState()).not.toBe(a);
  });

  it("only accepts the exact value from this browser's cookie", () => {
    const s = newOAuthState();
    expect(statesMatch(s, s)).toBe(true);
    // Change the last character to a different one (never the same by chance).
    const tampered = s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
    expect(statesMatch(s, tampered)).toBe(false);
    expect(statesMatch(undefined, s)).toBe(false);
    expect(statesMatch(s, null)).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });

  it("puts the state on the TikTok seller authorization link", () => {
    const url = new URL(buildTikTokAuthUrl("abc123"));
    expect(url.origin + url.pathname).toBe("https://services.tiktokshop.com/open/authorize");
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.has("service_id")).toBe(true);
  });
});
