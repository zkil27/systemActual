/**
 * What keeps each table small, for the Developer › Database tab. Mirrors the
 * daily prune (src/lib/worker/prune.ts and the helpers it calls). Update this
 * when a table or a retention rule changes; the test checks every Prisma model
 * is listed.
 *
 * kind:
 * - "rule": rows are deleted or emptied after a fixed time
 * - "bounded": stays small by nature (settings, catalog, one row per shop/month)
 * - "cascade": deleted together with its parent
 * - "none": grows forever. Needs a rule before it gets big (roadmap rule).
 */
export type RetentionKind = "rule" | "bounded" | "cascade" | "none";

export interface RetentionRule {
  kind: RetentionKind;
  note: string;
}

export const RETENTION_RULES: Record<string, RetentionRule> = {
  OwnerUser: { kind: "bounded", note: "Owner accounts" },
  PushSubscription: { kind: "rule", note: "Removed on 404/410, sign-out-all, or 90 days unused" },
  StaffMember: { kind: "bounded", note: "Staff list" },
  ShopConnection: { kind: "bounded", note: "One row per shop" },
  AppSettings: { kind: "bounded", note: "One row" },
  AiSettings: { kind: "bounded", note: "One row" },
  WorkerLock: { kind: "bounded", note: "Locks and markers" },
  PrintDevice: { kind: "bounded", note: "Printer PCs" },
  Supplier: { kind: "bounded", note: "Supplier list" },
  ShopAnswer: { kind: "bounded", note: "Saved shop answers" },
  Garment: { kind: "bounded", note: "Catalog" },
  GarmentVariant: { kind: "bounded", note: "Catalog" },
  ListingVariant: { kind: "bounded", note: "Catalog (shop listings)" },
  ChannelProduct: { kind: "bounded", note: "Catalog (shop products)" },
  FinanceMonth: { kind: "bounded", note: "Monthly totals, kept for good" },
  ItemProfitMonth: { kind: "bounded", note: "Monthly per-item totals, kept for good" },

  Order: { kind: "rule", note: "Finished orders 90 days, stuck ones 180 days" },
  OrderLine: { kind: "cascade", note: "With its order" },
  Package: { kind: "cascade", note: "With its order" },
  ChatConversation: { kind: "rule", note: "90 days" },
  ChatMessage: { kind: "rule", note: "90 days" },
  ChatDraft: { kind: "cascade", note: "With its chat" },
  AuditLog: { kind: "rule", note: "365 days" },
  IntegrationEvent: { kind: "rule", note: "Processed 3 days, failed 30 days" },
  ImportJob: { kind: "rule", note: "180 days" },
  WalletTransaction: { kind: "rule", note: "180 days" },
  OrderFinance: { kind: "rule", note: "120 days (breakdown 14 days)" },
  OrderFinanceLine: { kind: "cascade", note: "With its order finance row" },
  StockMovement: { kind: "rule", note: "180 days, then rolled into one row per variant" },
  AlertLog: { kind: "rule", note: "30 days" },
  PrintJob: { kind: "rule", note: "Printed/failed 30 days" },
  Wave: { kind: "rule", note: "Done/cancelled 90 days" },
  WaveItem: { kind: "cascade", note: "With its wave" },
  ActionRequest: { kind: "rule", note: "Decided 60 days" },
  AiUsage: { kind: "rule", note: "90 days" },
  AiEvent: { kind: "rule", note: "30 days" },
  ReturnEvent: { kind: "cascade", note: "With its return parcel; raw payload emptied after 14 days" },
  AppError: { kind: "rule", note: "30 days after last seen" },
  WorkerRun: { kind: "rule", note: "3 days" },
  ApiCallStat: { kind: "rule", note: "30 days" },

  ReturnParcel: { kind: "rule", note: "Closed/received non-disputed parcels 365 days" },
  PhysicalScan: { kind: "cascade", note: "With its return parcel (proof photos 90 days)" },
  ReturnItemCheck: { kind: "cascade", note: "With its return parcel" },
  PriceChange: { kind: "rule", note: "365 days" },
  ItemPublish: { kind: "cascade", note: "With its garment; payload cleared once pushed" },
  PurchaseOrder: { kind: "rule", note: "Received/cancelled orders 730 days (2 years)" },
  PurchaseOrderLine: { kind: "cascade", note: "With its purchase order" },
};

export function retentionFor(table: string): RetentionRule {
  return RETENTION_RULES[table] ?? { kind: "none", note: "Not listed" };
}
