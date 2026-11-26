import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { isOrderCancelledForPacking } from "@/lib/shipping/outbound";
import { shortenGarmentName } from "@/lib/waves/pick-list";
import { expectedLinesFromItems } from "@/lib/returns/item-check";
import {
  OWNER_COOKIE,
  STAFF_COOKIE,
  createOwnerToken,
  createStaffToken,
  verifyOwnerToken,
  verifyStaffToken,
  type OwnerSessionPayload,
  type StaffSessionPayload,
} from "./session-edge";

export {
  OWNER_COOKIE,
  STAFF_COOKIE,
  createOwnerToken,
  createStaffToken,
  verifyOwnerToken,
  verifyStaffToken,
  type OwnerSessionPayload,
  type StaffSessionPayload,
};

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function getOwnerSession(): Promise<OwnerSessionPayload | null> {
  const store = await cookies();
  const payload = await verifyOwnerToken(store.get(OWNER_COOKIE)?.value);
  if (!payload) return null;
  const user = await prisma.ownerUser.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, tokenVersion: true },
  });
  if (!user) return null;
  if ((payload.tv ?? 1) !== user.tokenVersion) return null;
  return {
    role: "owner",
    userId: user.id,
    email: user.email,
    name: user.name,
    tv: user.tokenVersion,
  };
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
  /** Matches the line in an item check (see src/lib/returns/item-check.ts). */
  lineKey: string;
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
  // Only name, colour/size, count and photo: never prices or shop ids.
  return expectedLinesFromItems(rawItems).map((l) => ({
    lineKey: l.lineKey,
    name: l.name,
    variationName: l.variationName,
    quantity: l.quantity,
    imageUrl: l.imageUrl,
  }));
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
