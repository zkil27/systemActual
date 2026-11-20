import { SignJWT, jwtVerify } from "jose";

export const OWNER_COOKIE = "kyna_owner_session";
export const STAFF_COOKIE = "kyna_staff_session";

function getSecretKey(): Uint8Array {
  const raw =
    process.env.AUTH_SECRET || "kyna-ops-dev-secret-change-in-production-32chars";
  return new TextEncoder().encode(raw);
}

export interface OwnerSessionPayload {
  role: "owner";
  userId: string;
  email: string;
  name: string;
}

export interface StaffSessionPayload {
  role: "staff";
  staffId: string;
  name: string;
}

export async function createOwnerToken(payload: OwnerSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecretKey());
}

export async function createStaffToken(payload: StaffSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14h")
    .sign(getSecretKey());
}

export async function verifyOwnerToken(
  token: string | undefined
): Promise<OwnerSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.role !== "owner" || typeof payload.userId !== "string") return null;
    return {
      role: "owner",
      userId: payload.userId,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
    };
  } catch {
    return null;
  }
}

export async function verifyStaffToken(
  token: string | undefined
): Promise<StaffSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.role !== "staff" || typeof payload.staffId !== "string") return null;
    return {
      role: "staff",
      staffId: payload.staffId,
      name: String(payload.name ?? ""),
    };
  } catch {
    return null;
  }
}
