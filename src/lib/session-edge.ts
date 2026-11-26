import { SignJWT, jwtVerify } from "jose";
import { getAuthSecretKey as getSecretKey } from "./auth-secret";

export const OWNER_COOKIE = "kyna_owner_session";
export const STAFF_COOKIE = "kyna_staff_session";

export interface OwnerSessionPayload {
  role: "owner";
  userId: string;
  email: string;
  name: string;
  tv?: number;
}

export interface StaffSessionPayload {
  role: "staff";
  staffId: string;
  name: string;
  tv?: number;
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
    const tv = typeof payload.tv === "number" ? payload.tv : undefined;
    return {
      role: "owner",
      userId: payload.userId,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      ...(tv !== undefined ? { tv } : {}),
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
    const tv = typeof payload.tv === "number" ? payload.tv : undefined;
    return {
      role: "staff",
      staffId: payload.staffId,
      name: String(payload.name ?? ""),
      ...(tv !== undefined ? { tv } : {}),
    };
  } catch {
    return null;
  }
}
