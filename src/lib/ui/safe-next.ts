/**
 * Where to go after sign-in. Only a same-site path is allowed; anything that
 * could leave the app (another host, a scheme, a backslash trick) goes home.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const v = raw.trim();
  if (!v.startsWith("/") || v.startsWith("//")) return "/";
  // Backslashes and control characters are normalised by browsers into "//host".
  if (/[\u0000-\u001f\\]/.test(v)) return "/";
  if (v.startsWith("/login")) return "/";
  try {
    const u = new URL(v, "http://kyna.local");
    if (u.host !== "kyna.local") return "/";
    return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    return "/";
  }
}
