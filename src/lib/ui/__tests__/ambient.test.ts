import { afterEach, describe, expect, it } from "vitest";
import {
  AMBIENT_MOODS,
  AMBIENT_TONES,
  composite,
  contrastRatio,
  getAmbientSnapshot,
  moodForShop,
  parseAmbientPreference,
  pulseAmbient,
  registerAmbientShop,
  resetAmbientForTests,
  resolveSurface,
  subscribeAmbient,
  type AmbientMoodId,
} from "@/lib/ui/ambient";

// Tokens from globals.css. Text that sits on the ground (titles, subtitles,
// section headers, captions) must stay readable over the most tinted spot.
const THEMES = {
  light: { ground: "#f4f7f8", ink: "#0f172a", ink3: "#556477" },
  dark: { ground: "#09090b", ink: "#f4f4f5", ink3: "#9a9aa4" },
} as const;

const MOOD_IDS = Object.keys(AMBIENT_MOODS) as AmbientMoodId[];

afterEach(() => resetAmbientForTests());

describe("resolveSurface", () => {
  it("gives owner screens the full field", () => {
    for (const p of ["/", "/returns", "/chats", "/chats/abc", "/items", "/settings", "/waves", "/profit"]) {
      expect(resolveSurface(p)).toBe("full");
    }
  });

  it("keeps staff screens plain at rest, blooms only", () => {
    expect(resolveSurface("/scan")).toBe("bloom-only");
    expect(resolveSurface("/stock-in")).toBe("bloom-only");
    expect(resolveSurface("/scan/anything")).toBe("bloom-only");
  });

  it("shows nothing on login", () => {
    expect(resolveSurface("/login")).toBe("none");
  });

  it("doesn't match look-alike paths", () => {
    expect(resolveSurface("/scanner")).toBe("full");
    expect(resolveSurface("/loginx")).toBe("full");
    expect(resolveSurface(null)).toBe("full");
  });
});

describe("moodForShop", () => {
  it("maps shops to their mood and anything else to Kyna pink", () => {
    expect(moodForShop("TIKTOK")).toBe("TIKTOK");
    expect(moodForShop("SHOPEE")).toBe("SHOPEE");
    expect(moodForShop("LAZADA")).toBe("kyna");
    expect(moodForShop(null)).toBe("kyna");
    expect(moodForShop("kyna")).toBe("kyna");
  });
});

describe("parseAmbientPreference", () => {
  it("is on unless explicitly off", () => {
    expect(parseAmbientPreference("off")).toBe("off");
    expect(parseAmbientPreference("on")).toBe("on");
    expect(parseAmbientPreference("junk")).toBe("on");
    expect(parseAmbientPreference(null)).toBe("on");
  });
});

describe("shop registrations", () => {
  it("falls back to pink with nothing registered", () => {
    expect(getAmbientSnapshot().mood).toBe("kyna");
  });

  it("lets the last registration win and restores the one under it", () => {
    const releaseChats = registerAmbientShop("TIKTOK");
    expect(getAmbientSnapshot().mood).toBe("TIKTOK");
    const releaseSheet = registerAmbientShop("SHOPEE");
    expect(getAmbientSnapshot().mood).toBe("SHOPEE");
    releaseSheet();
    expect(getAmbientSnapshot().mood).toBe("TIKTOK");
    releaseChats();
    expect(getAmbientSnapshot().mood).toBe("kyna");
  });

  it("handles releases out of order", () => {
    const a = registerAmbientShop("TIKTOK");
    const b = registerAmbientShop("SHOPEE");
    a();
    expect(getAmbientSnapshot().mood).toBe("SHOPEE");
    b();
    expect(getAmbientSnapshot().mood).toBe("kyna");
  });

  it("is safe to release twice", () => {
    const a = registerAmbientShop("TIKTOK");
    const b = registerAmbientShop("TIKTOK");
    a();
    a();
    expect(getAmbientSnapshot().mood).toBe("TIKTOK");
    b();
    expect(getAmbientSnapshot().mood).toBe("kyna");
  });

  it("only notifies when the mood actually changes", () => {
    let calls = 0;
    const unsub = subscribeAmbient(() => calls++);
    const a = registerAmbientShop("TIKTOK");
    const b = registerAmbientShop("TIKTOK");
    b();
    expect(calls).toBe(1);
    a();
    expect(calls).toBe(2);
    unsub();
  });
});

describe("pulseAmbient", () => {
  it("restarts with a new id each time instead of stacking", () => {
    pulseAmbient("success");
    const first = getAmbientSnapshot().pulse;
    pulseAmbient("success");
    const second = getAmbientSnapshot().pulse;
    expect(first?.tone).toBe("success");
    expect(second?.id).toBeGreaterThan(first!.id);
  });

  it("keeps the mood while blooming", () => {
    const release = registerAmbientShop("SHOPEE");
    pulseAmbient("error");
    expect(getAmbientSnapshot()).toMatchObject({ mood: "SHOPEE", pulse: { tone: "error" } });
    release();
  });

  it("never uses the Missing crimson for errors", () => {
    const missing = { light: "#dc2626", dark: "#99333a" };
    for (const theme of ["light", "dark"] as const) {
      const [r, g, b] = composite("#000000", [AMBIENT_TONES.error[theme].replace(/\/\s*[\d.]+\)/, "/ 1)")]);
      const [mr, mg, mb] = composite("#000000", [missing[theme]]);
      expect(Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb)).toBeGreaterThan(80);
    }
  });
});

describe("contrast over the field", () => {
  it("computes known ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const theme of ["light", "dark"] as const) {
    const t = THEMES[theme];
    for (const id of MOOD_IDS) {
      it(`${theme} ${id}: ink and ink-3 stay at 4.5:1 where both top blobs peak`, () => {
        const [a, b] = AMBIENT_MOODS[id].blobs;
        // Worst case: both top blobs at full strength on the same spot.
        const top = composite(t.ground, [a[theme], b[theme]]);
        expect(contrastRatio(t.ink3, top)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.ink, top)).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const tone of Object.keys(AMBIENT_TONES) as (keyof typeof AMBIENT_TONES)[]) {
      it(`${theme} ${tone} bloom: ink-3 stays at 4.5:1 over the low blob`, () => {
        for (const id of MOOD_IDS) {
          const low = AMBIENT_MOODS[id].blobs[2][theme];
          const spot = composite(t.ground, [low, AMBIENT_TONES[tone][theme]]);
          expect(contrastRatio(t.ink3, spot)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
