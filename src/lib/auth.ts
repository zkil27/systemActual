import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

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

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
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

export async function getOwnerSession(): Promise<OwnerSessionPayload | null> {
  const store = await cookies();
  return verifyOwnerToken(store.get(OWNER_COOKIE)?.value);
}

export async function getStaffSession(): Promise<StaffSessionPayload | null> {
  const store = await cookies();
  return verifyStaffToken(store.get(STAFF_COOKIE)?.value);
}

export async function getScannerSession(): Promise<
  | { actorType: "staff"; staffId: string; name: string }
  | { actorType: "owner"; userId: string; name: string }
  | null
> {
  const staff = await getStaffSession();
  if (staff) {
    return { actorType: "staff", staffId: staff.staffId, name: staff.name };
  }
  const owner = await getOwnerSession();
  if (owner) {
    return { actorType: "owner", userId: owner.userId, name: owner.name };
  }
  return null;
}

export interface StaffSafeParcel {
  id: string;
  platform: string;
  orderSn: string;
  returnSn: string | null;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: string;
  digitalStatus: string;
  returnReason: string | null;
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  itemImageUrl: string | null;
  digitalReturnTaggedAt: string | null;
  courierReturnedToSellerAt: string | null;
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  alreadyScanned: boolean;
}

/**
 * Strictly strips all financial fields (orderTotalPhp, estimatedUnitCostPhp)
 * before sending any parcel data to warehouse staff endpoints.
 */
export function redactParcelForStaff(parcel: {
  id: string;
  platform: string;
  orderSn: string;
  returnSn: string | null;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: string;
  digitalStatus: string;
  returnReason: string | null;
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  itemImageUrl: string | null;
  digitalReturnTaggedAt: Date | null;
  courierReturnedToSellerAt: Date | null;
  physicallyReceivedAt: Date | null;
  physicalCondition: string | null;
}): StaffSafeParcel {
  return {
    id: parcel.id,
    platform: parcel.platform,
    orderSn: parcel.orderSn,
    returnSn: parcel.returnSn,
    forwardTrackingNumber: parcel.forwardTrackingNumber,
    rtsTrackingNumber: parcel.rtsTrackingNumber,
    courier: parcel.courier,
    category: parcel.category,
    digitalStatus: parcel.digitalStatus,
    returnReason: parcel.returnReason,
    itemSummary: parcel.itemSummary,
    variationName: parcel.variationName,
    quantity: parcel.quantity,
    itemImageUrl: parcel.itemImageUrl,
    digitalReturnTaggedAt: parcel.digitalReturnTaggedAt?.toISOString() ?? null,
    courierReturnedToSellerAt: parcel.courierReturnedToSellerAt?.toISOString() ?? null,
    physicallyReceivedAt: parcel.physicallyReceivedAt?.toISOString() ?? null,
    physicalCondition: parcel.physicalCondition,
    alreadyScanned: Boolean(parcel.physicallyReceivedAt),
  };
}
