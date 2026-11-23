import { describe, expect, it } from "vitest";
import {
  decideUpdate,
  isChunkLoadError,
  parseVersionResponse,
  releasesSince,
} from "@/lib/update-check";
import type { Release } from "@/lib/releases";

const rel = (id: number): Release => ({ id, date: "2026-11-23", title: `R${id}`, changes: ["x"] });

describe("decideUpdate", () => {
  it("is quiet when the running build is the live build", () => {
    expect(decideUpdate({ buildId: "abc", releaseId: 3 }, { buildId: "abc", releaseId: 3 })).toBe("none");
  });

  it("is quiet in local dev builds", () => {
    expect(decideUpdate({ buildId: "dev", releaseId: 1 }, { buildId: "abc", releaseId: 2 })).toBe("none");
    expect(decideUpdate({ buildId: "abc", releaseId: 1 }, { buildId: "dev", releaseId: 2 })).toBe("none");
    expect(decideUpdate({ buildId: "abc", releaseId: 1 }, { buildId: "", releaseId: 2 })).toBe("none");
  });

  it("flags a new deploy without new notes as minor", () => {
    expect(decideUpdate({ buildId: "abc", releaseId: 3 }, { buildId: "def", releaseId: 3 })).toBe("minor");
  });

  it("flags a deploy with new release notes as major", () => {
    expect(decideUpdate({ buildId: "abc", releaseId: 3 }, { buildId: "def", releaseId: 4 })).toBe("major");
  });

  it("does not call a rollback major", () => {
    expect(decideUpdate({ buildId: "abc", releaseId: 4 }, { buildId: "old", releaseId: 3 })).toBe("minor");
  });
});

describe("releasesSince", () => {
  it("returns every unseen release, newest first", () => {
    expect(releasesSince([rel(3), rel(5), rel(4), rel(2)], 3).map((r) => r.id)).toEqual([5, 4]);
  });

  it("returns nothing when the client is current", () => {
    expect(releasesSince([rel(2), rel(1)], 2)).toEqual([]);
  });
});

describe("isChunkLoadError", () => {
  it("matches stale-chunk errors from webpack and browsers", () => {
    const e = new Error("Loading chunk 123 failed.");
    e.name = "ChunkLoadError";
    expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /x.js"))).toBe(true);
    expect(isChunkLoadError("Importing a module script failed.")).toBe(true);
  });

  it("ignores ordinary errors", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("parseVersionResponse", () => {
  it("accepts the /api/version shape and drops malformed releases", () => {
    const parsed = parseVersionResponse({
      buildId: "abc",
      releaseId: 2,
      releases: [rel(2), { id: "bad" }, null],
    });
    expect(parsed).toEqual({ buildId: "abc", releaseId: 2, releases: [rel(2)] });
  });

  it("rejects bodies without a build id", () => {
    expect(parseVersionResponse({ releaseId: 1 })).toBeNull();
    expect(parseVersionResponse(null)).toBeNull();
    expect(parseVersionResponse("html error page")).toBeNull();
  });
});
