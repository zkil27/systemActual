import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getAuthSecretKey as getSecretKey } from "./auth-secret";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { isOrderCancelledForPacking } from "@/lib/shipping/outbound";
import { shortenGarmentName } from "@/lib/waves/pick-list";

export const OWNER_COOKIE = "kyna_owner_session";
export const STAFF_COOKIE = "kyna_staff_session";

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
  tv?: number;
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

export async function getOwnerSession(): Promise<OwnerSessionPayload | null> {
  const store = await cookies();
  return verifyOwnerToken(store.get(OWNER_COOKIE)?.value);
}

export async function getStaffSession(): Promise<StaffSessionPayload | null> {
  const store = await cookies();
  const payload = await verifyStaffToken(store.get(STAFF_COOKIE)?.value);
  if (!payload) return null;
  const member = await prisma.staffMember.findUnique({
    where: { id: payload.staffId },
    select: { active: true, tokenVersion: true, name: true },
  });
  if (!member || !member.active) return null;
  if ((payload.tv ?? 1) !== member.tokenVersion) return null;
  return { ...payload, name: member.name };
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

export interface StaffSafeParcelLine {
  name: string;
  variationName: string | null;
  quantity: number;
  imageUrl: string | null;
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
  lines: StaffSafeParcelLine[];
  digitalReturnTaggedAt: string | null;
  courierReturnedToSellerAt: string | null;
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  alreadyScanned: boolean;
}

function parseStaffSafeReturnLines(rawItems: unknown): StaffSafeParcelLine[] {
  if (!Array.isArray(rawItems)) return [];
  const lines: StaffSafeParcelLine[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const rawQty = typeof rec.quantity === "number" ? rec.quantity : Number(rec.quantity);
    lines.push({
      name,
      variationName: typeof rec.variationName === "string" && rec.variationName.trim() ? rec.variationName.trim() : null,
      quantity: Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1,
      imageUrl: typeof rec.imageUrl === "string" && rec.imageUrl.trim() ? rec.imageUrl.trim() : null,
    });
  }
  return lines;
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
  itemsJson?: unknown;
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
    lines: parseStaffSafeReturnLines(parcel.itemsJson),
    digitalReturnTaggedAt: parcel.digitalReturnTaggedAt?.toISOString() ?? null,
    courierReturnedToSellerAt: parcel.courierReturnedToSellerAt?.toISOString() ?? null,
    physicallyReceivedAt: parcel.physicallyReceivedAt?.toISOString() ?? null,
    physicalCondition: parcel.physicalCondition,
    alreadyScanned: Boolean(parcel.physicallyReceivedAt),
  };
}

export interface StaffSafeOutboundLine {
  id: string;
  name: string;
  shortName: string;
  variationName: string | null;
  imageUrl: string | null;
  quantity: number;
}

export interface StaffSafeOutboundPackage {
  packageId: string;
  orderId: string;
  orderSn: string;
  platform: string;
  trackingNumber: string | null;
  courier: string;
  orderStatus: string;
  cancelRequested: boolean;
  isCancelled: boolean;
  totalPieces: number;
  isMultiPiece: boolean;
  packedAt: string | null;
  packedByName: string | null;
  wavePosition: number | null;
  waveTotal: number | null;
  canReprint: boolean;
  lines: StaffSafeOutboundLine[];
}

/**
 * Strictly strips all financial fields (totalPhp, unitPricePhp, isCod) before
 * sending outbound package details to warehouse staff on /scan.
 */
export function redactOutboundPackageForStaff(pkg: {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
  packedAt: Date | null;
  packedByStaff?: { name: string } | null;
  order: {
    id: string;
    orderSn: string;
    platform: string;
    status: string;
    cancelRequested: boolean;
    lines: Array<{
      id: string;
      name: string;
      variationName: string | null;
      imageUrl: string | null;
      quantity: number;
    }>;
  };
  waveItems?: Array<{
    status: string;
    position: number;
    wave: { parcelCount: number };
  }>;
}): StaffSafeOutboundPackage {
  const lines: StaffSafeOutboundLine[] = pkg.order.lines.map((l) => ({
    id: l.id,
    name: l.name,
    shortName: shortenGarmentName(l.name),
    variationName: l.variationName,
    imageUrl: l.imageUrl,
    quantity: l.quantity,
  }));
  const totalPieces = lines.reduce((sum, l) => sum + l.quantity, 0);
  const latestWave = pkg.waveItems?.[0];
  const canReprint = Boolean(
    latestWave && (latestWave.status === "LABEL_READY" || latestWave.status === "PRINTED")
  );

  return {
    packageId: pkg.id,
    orderId: pkg.order.id,
    orderSn: pkg.order.orderSn,
    platform: pkg.order.platform,
    trackingNumber: pkg.trackingNumber,
    courier: normalizeCourierName(pkg.carrier),
    orderStatus: pkg.order.status,
    cancelRequested: pkg.order.cancelRequested,
    isCancelled: isOrderCancelledForPacking(pkg.order),
    totalPieces,
    isMultiPiece: totalPieces > 1 || lines.length > 1,
    packedAt: pkg.packedAt?.toISOString() ?? null,
    packedByName: pkg.packedByStaff?.name ?? null,
    wavePosition: latestWave ? latestWave.position + 1 : null,
    waveTotal: latestWave ? latestWave.wave.parcelCount : null,
    canReprint,
    lines,
  };
}
