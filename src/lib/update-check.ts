import type { Release } from "@/lib/releases";

export type UpdateKind = "none" | "minor" | "major";

export interface BuildInfo {
  buildId: string;
  releaseId: number;
}

export interface VersionResponse extends BuildInfo {
  releases: Release[];
}

/** Local dev builds have no commit SHA; never nag there. */
export const DEV_BUILD_ID = "dev";

/** Compare the running bundle with what the server is now serving. */
export function decideUpdate(client: BuildInfo, server: BuildInfo): UpdateKind {
  if (!server.buildId || server.buildId === DEV_BUILD_ID || client.buildId === DEV_BUILD_ID) return "none";
  if (server.buildId === client.buildId) return "none";
  return server.releaseId > client.releaseId ? "major" : "minor";
}

/** Release notes the user hasn't seen yet, newest first. */
export function releasesSince(releases: Release[], clientReleaseId: number): Release[] {
  return releases.filter((r) => r.id > clientReleaseId).sort((a, b) => b.id - a.id);
}

/**
 * Release notes to show as "What's new" when the app is already up to date.
 * `seenId` is the last release this device has shown; null means none recorded
 * yet, in which case only the newest release is shown.
 */
export function unseenReleases(releases: Release[], seenId: number | null): Release[] {
  const sorted = [...releases].sort((a, b) => b.id - a.id);
  if (seenId === null) return sorted.slice(0, 1);
  return sorted.filter((r) => r.id > seenId).slice(0, 5);
}

/** Parse a stored seen-release id; anything invalid counts as not recorded. */
export function parseSeenId(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Errors thrown when an old bundle asks for a JS chunk the new deploy no longer serves. */
export function isChunkLoadError(value: unknown): boolean {
  const text =
    value instanceof Error
      ? `${value.name} ${value.message}`
      : typeof value === "string"
        ? value
        : "";
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    text
  );
}

/** Narrow an untrusted /api/version body. */
export function parseVersionResponse(body: unknown): VersionResponse | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.buildId !== "string" || typeof b.releaseId !== "number") return null;
  const releases = Array.isArray(b.releases)
    ? (b.releases as unknown[]).filter(
        (r): r is Release =>
          !!r &&
          typeof r === "object" &&
          typeof (r as Release).id === "number" &&
          typeof (r as Release).title === "string" &&
          typeof (r as Release).date === "string" &&
          Array.isArray((r as Release).changes)
      )
    : [];
  return { buildId: b.buildId, releaseId: b.releaseId, releases };
}
