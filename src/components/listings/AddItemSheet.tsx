"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, ImagePlus, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import {
  buildVariantMatrix,
  computeShopPublishStock,
  DEFAULT_WEIGHT_KG,
  MAX_LISTING_PHOTOS,
  type CategoryChip,
  type CategoryPreset,
  type PublishMode,
  type ShopPlatform,
  type TierSpec,
} from "@/lib/listings/create-rules";
import type { CreateItemBootstrapDto, ItemPublishResultDto } from "@/lib/listings/create-service";
import { CategoryPickerSheet } from "./CategoryPickerSheet";

type Stage = "form" | "preview" | "results";
type VariantMode = "single" | "multi";

interface SelectedCategory {
  categoryId: string;
  categoryName: string | null;
}

export function AddItemSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>("form");
  const [bootstrap, setBootstrap] = useState<CreateItemBootstrapDto | null>(null);
  const [loadingBoot, setLoadingBoot] = useState(false);

  // Photos
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  // Core item fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [publishMode, setPublishMode] = useState<PublishMode>("DRAFT");
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [categoriesByShop, setCategoriesByShop] = useState<Record<string, SelectedCategory>>({});
  const [pickerShopId, setPickerShopId] = useState<string | null>(null);

  // Variations & stock
  const [variantMode, setVariantMode] = useState<VariantMode>("single");
  const [singlePrice, setSinglePrice] = useState("199");
  const [singleStock, setSingleStock] = useState("10");
  const [tier1Name, setTier1Name] = useState("Color");
  const [tier1Options, setTier1Options] = useState<string[]>([]);
  const [tier1Draft, setTier1Draft] = useState("");
  const [useTier2, setUseTier2] = useState(false);
  const [tier2Name, setTier2Name] = useState("Size");
  const [tier2Options, setTier2Options] = useState<string[]>([]);
  const [tier2Draft, setTier2Draft] = useState("");
  const [variantEdits, setVariantEdits] = useState<
    Record<string, { pricePhp: number; stock: number; skuCode?: string | null }>
  >({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");

  // Optional details
  const [weightKg, setWeightKg] = useState(String(DEFAULT_WEIGHT_KG));
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [unitCostPhp, setUnitCostPhp] = useState("");
  const [binLocation, setBinLocation] = useState("");
  const [safetyBuffer, setSafetyBuffer] = useState("");

  // Submission / results
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ItemPublishResultDto[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("form");
    setImageUrls([]);
    setTitle("");
    setDescription("");
    setPublishMode("DRAFT");
    setCategoriesByShop({});
    setPickerShopId(null);
    setVariantMode("single");
    setTier1Name("Color");
    setTier1Options([]);
    setTier1Draft("");
    setUseTier2(false);
    setTier2Name("Size");
    setTier2Options([]);
    setTier2Draft("");
    setVariantEdits({});
    setBulkPrice("");
    setBulkStock("");
    setWeightKg(String(DEFAULT_WEIGHT_KG));
    setLengthCm("");
    setWidthCm("");
    setHeightCm("");
    setBinLocation("");
    setSafetyBuffer("");
    setResults([]);

    let cancelled = false;
    setLoadingBoot(true);
    fetch("/api/listings/categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: CreateItemBootstrapDto) => {
        if (cancelled) return;
        setBootstrap(data);
        const connectedIds = (data.shops ?? []).filter((s) => s.connected).map((s) => s.id);
        setSelectedShopIds(connectedIds);
        const defPrice = data.defaults?.sellingPricePhp ?? 199;
        const defCost = data.defaults?.unitCostPhp ?? 82;
        setSinglePrice(String(defPrice));
        setSingleStock("10");
        setUnitCostPhp(String(defCost));
      })
      .catch(() => {
        if (!cancelled) toast("Couldn't load shop list.", "error");
      })
      .finally(() => {
        if (!cancelled) setLoadingBoot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const connectedShops = useMemo(
    () => (bootstrap?.shops ?? []).filter((s) => s.connected),
    [bootstrap]
  );

  const selectedShops = useMemo(
    () => connectedShops.filter((s) => selectedShopIds.includes(s.id)),
    [connectedShops, selectedShopIds]
  );

  const hasShopeeSelected = selectedShops.some((s) => s.platform === "SHOPEE");
  const maxTitleLen = hasShopeeSelected ? 120 : 255;

  const activeTiers: TierSpec[] = useMemo(() => {
    if (variantMode === "single") return [];
    const list: TierSpec[] = [];
    if (tier1Name.trim() && tier1Options.length > 0) {
      list.push({ name: tier1Name.trim(), options: tier1Options });
    }
    if (useTier2 && tier2Name.trim() && tier2Options.length > 0) {
      list.push({ name: tier2Name.trim(), options: tier2Options });
    }
    return list;
  }, [variantMode, tier1Name, tier1Options, useTier2, tier2Name, tier2Options]);

  const matrix = useMemo(() => {
    const defPrice = Number.parseFloat(singlePrice) || bootstrap?.defaults?.sellingPricePhp || 199;
    const defStock = Number.parseInt(singleStock, 10);
    const editMap = new Map(Object.entries(variantEdits));
    return buildVariantMatrix(
      activeTiers,
      defPrice,
      Number.isFinite(defStock) && defStock >= 0 ? defStock : 0,
      editMap
    );
  }, [activeTiers, singlePrice, singleStock, variantEdits, bootstrap]);

  function toggleShop(id: string) {
    setSelectedShopIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function applyPreset(preset: CategoryPreset) {
    setCategoriesByShop((prev) => {
      const next = { ...prev };
      for (const s of connectedShops) {
        if (s.platform === "SHOPEE") {
          next[s.id] = {
            categoryId: preset.shopeeCategoryId,
            categoryName: preset.shopeeCategoryName,
          };
        } else {
          next[s.id] = {
            categoryId: preset.tiktokCategoryId,
            categoryName: preset.tiktokCategoryName,
          };
        }
      }
      return next;
    });
    toast(`Selected ${preset.label}`);
  }

  function addOption(tier: 1 | 2) {
    const raw = tier === 1 ? tier1Draft : tier2Draft;
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    if (tier === 1) {
      setTier1Options((prev) => {
        const seen = new Set(prev.map((x) => x.toLowerCase()));
        const next = [...prev];
        for (const p of parts) {
          if (!seen.has(p.toLowerCase())) {
            seen.add(p.toLowerCase());
            next.push(p);
          }
        }
        return next;
      });
      setTier1Draft("");
    } else {
      setTier2Options((prev) => {
        const seen = new Set(prev.map((x) => x.toLowerCase()));
        const next = [...prev];
        for (const p of parts) {
          if (!seen.has(p.toLowerCase())) {
            seen.add(p.toLowerCase());
            next.push(p);
          }
        }
        return next;
      });
      setTier2Draft("");
    }
  }

  async function handlePhotoUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MAX_LISTING_PHOTOS - imageUrls.length;
    if (remaining <= 0) {
      toast(`At most ${MAX_LISTING_PHOTOS} photos allowed.`, "error");
      return;
    }
    const batch = Array.from(files).slice(0, remaining);
    setUploadingPhotos(true);
    try {
      const uploaded: string[] = [];
      for (const file of batch) {
        const form = new FormData();
        form.append("photo", file);
        const res = await fetch("/api/listings/photos", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data.error || "Couldn't upload a photo.", "error");
          continue;
        }
        if (typeof data.url === "string") uploaded.push(data.url);
      }
      if (uploaded.length) {
        setImageUrls((prev) => [...prev, ...uploaded].slice(0, MAX_LISTING_PHOTOS));
      }
    } catch {
      toast("Photo upload failed. Try again.", "error");
    } finally {
      setUploadingPhotos(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function applyBulk(field: "price" | "stock") {
    if (!matrix.ok) return;
    if (field === "price") {
      const n = Number.parseFloat(bulkPrice);
      if (!Number.isFinite(n) || n < 1) return toast("Enter a valid price.", "error");
      const rounded = Number(n.toFixed(2));
      setVariantEdits((prev) => {
        const next = { ...prev };
        for (const v of matrix.variants) {
          next[v.label] = {
            pricePhp: rounded,
            stock: prev[v.label]?.stock ?? v.stock,
            skuCode: prev[v.label]?.skuCode ?? v.skuCode,
          };
        }
        return next;
      });
      setBulkPrice("");
    } else {
      const n = Number.parseInt(bulkStock, 10);
      if (!Number.isInteger(n) || n < 0) return toast("Enter a whole number.", "error");
      setVariantEdits((prev) => {
        const next = { ...prev };
        for (const v of matrix.variants) {
          next[v.label] = {
            pricePhp: prev[v.label]?.pricePhp ?? v.pricePhp,
            stock: n,
            skuCode: prev[v.label]?.skuCode ?? v.skuCode,
          };
        }
        return next;
      });
      setBulkStock("");
    }
  }

  function goToPreview() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return toast("Enter an item name.", "error");
    if (cleanTitle.length > maxTitleLen) {
      return toast(`Item name can be at most ${maxTitleLen} characters.`, "error");
    }
    if (!matrix.ok) return toast(matrix.error, "error");
    if (variantMode === "multi" && activeTiers.length === 0) {
      return toast("Add at least one option choice (like Black or M), or switch to Single item.", "error");
    }
    for (const s of selectedShops) {
      if (!categoriesByShop[s.id]?.categoryId?.trim()) {
        return toast(`Pick a ${s.platform === "SHOPEE" ? "Shopee" : "TikTok"} category.`, "error");
      }
    }
    setStage("preview");
  }

  async function submitCreate() {
    if (!matrix.ok) return;
    setSubmitting(true);
    try {
      const parsedWeight = Number.parseFloat(weightKg);
      const l = Number.parseFloat(lengthCm);
      const w = Number.parseFloat(widthCm);
      const h = Number.parseFloat(heightCm);
      const hasDims =
        Number.isFinite(l) && l > 0 && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
      const parsedCost = unitCostPhp.trim() ? Number.parseFloat(unitCostPhp) : null;
      const parsedBuffer = safetyBuffer.trim() ? Number.parseInt(safetyBuffer, 10) : null;

      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createItem",
          title: title.trim(),
          description: description.trim(),
          publishMode,
          imageUrls,
          weightKg: Number.isFinite(parsedWeight) ? parsedWeight : DEFAULT_WEIGHT_KG,
          dimensionsCm: hasDims ? { length: l, width: w, height: h } : null,
          unitCostPhp: parsedCost !== null && Number.isFinite(parsedCost) ? parsedCost : null,
          safetyBuffer: parsedBuffer !== null && Number.isInteger(parsedBuffer) ? parsedBuffer : null,
          binLocation: binLocation.trim() || null,
          tiers: activeTiers,
          variants: matrix.variants,
          targets: selectedShops.map((s) => ({
            shopConnectionId: s.id,
            platform: s.platform,
            categoryId: categoriesByShop[s.id]?.categoryId ?? "",
            categoryName: categoriesByShop[s.id]?.categoryName ?? null,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't create item.", "error");
        return;
      }
      setResults(Array.isArray(data.results) ? data.results : []);
      setStage("results");
      await onCreated();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryShop(itemPublishId: string, forceDraft = false) {
    setRetryingId(itemPublishId);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retryPublish",
          itemPublishId,
          ...(forceDraft ? { publishMode: "DRAFT" } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Retry failed.", "error");
        return;
      }
      if (data.result) {
        setResults((prev) =>
          prev.map((r) => (r.itemPublishId === itemPublishId ? data.result : r))
        );
      }
      await onCreated();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setRetryingId(null);
    }
  }

  const parsedSafetyBuffer = safetyBuffer.trim() ? Number.parseInt(safetyBuffer, 10) : null;
  const effectiveSafetyBuffer =
    parsedSafetyBuffer !== null && Number.isInteger(parsedSafetyBuffer) && parsedSafetyBuffer >= 0
      ? parsedSafetyBuffer
      : bootstrap?.defaults?.safetyBuffer ?? 0;

  const pickerShop = connectedShops.find((s) => s.id === pickerShopId) ?? null;
  const pickerRecent: CategoryChip[] = pickerShop
    ? bootstrap?.recentByPlatform[pickerShop.platform] ?? []
    : [];

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={
          stage === "form"
            ? "Add item"
            : stage === "preview"
              ? "Review & push"
              : "Item added"
        }
        footer={
          stage === "form" ? (
            <Button
              full
              size="lg"
              onClick={goToPreview}
              disabled={loadingBoot || uploadingPhotos || !title.trim()}
            >
              Preview &amp; confirm
            </Button>
          ) : stage === "preview" ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setStage("form")}
                disabled={submitting}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                size="lg"
                onClick={submitCreate}
                disabled={submitting}
                className="flex-[2]"
              >
                {submitting
                  ? "Creating & pushing..."
                  : selectedShops.length > 0
                    ? "Create & push to shops"
                    : "Save item"}
              </Button>
            </div>
          ) : (
            <Button full size="lg" onClick={onClose}>
              Done
            </Button>
          )
        }
      >
        {stage === "form" && (
          <div className="space-y-5">
            {/* Photos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink-2">
                  Photos ({imageUrls.length}/{MAX_LISTING_PHOTOS})
                </span>
                {uploadingPhotos && (
                  <span className="text-[12px] font-semibold text-brand">Uploading...</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => handlePhotoUpload(e.target.files)}
              />
              <div className="flex flex-wrap gap-2">
                {imageUrls.map((url, idx) => (
                  <div
                    key={url}
                    className="relative h-20 w-20 overflow-hidden rounded-[var(--radius-control)] border border-ink/10 bg-surface-subtle"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Photo ${idx + 1}`} className="h-full w-full object-cover" />
                    {idx === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        Cover
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => setImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {imageUrls.length < MAX_LISTING_PHOTOS && (
                  <button
                    type="button"
                    disabled={uploadingPhotos}
                    onClick={() => fileInputRef.current?.click()}
                    className="pressable flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed border-ink/25 bg-surface-subtle text-[12px] font-semibold text-ink-2 hover:border-brand hover:text-brand"
                  >
                    <ImagePlus className="h-5 w-5" />
                    Add
                  </button>
                )}
              </div>
            </div>

            {/* Name & description */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-semibold text-ink-2">Item name</label>
                  <span
                    className={`text-[12px] tabular-nums ${
                      title.trim().length > maxTitleLen ? "font-bold text-missing-ink" : "text-ink-3"
                    }`}
                  >
                    {title.trim().length}/{maxTitleLen}
                  </span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Kyna Ribbed Polo Dress"
                  className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-ink-2">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Fabric, fit, measurements, care notes..."
                  className="w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface p-3 text-[16px] text-ink outline-none focus:border-brand"
                />
              </div>
            </div>

            {/* Target shops & Publish mode */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="block text-[13px] font-semibold text-ink-2">
                  Reflect to shops
                </span>
                {connectedShops.length === 0 ? (
                  <p className="rounded-[var(--radius-control)] bg-surface-subtle p-3 text-[13px] text-ink-2">
                    No shops connected yet. Saving creates this item inside Kyna Ops only.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {connectedShops.map((s) => {
                      const active = selectedShopIds.includes(s.id);
                      const label = s.platform === "SHOPEE" ? "Shopee" : "TikTok";
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleShop(s.id)}
                          className={`pressable flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-[14px] font-bold ${
                            active
                              ? "bg-brand-solid text-on-brand"
                              : "bg-surface-muted text-ink-2"
                          }`}
                        >
                          <span>{label}</span>
                          {!s.writesEnabled && (
                            <span className="rounded bg-black/15 px-1.5 py-0.5 text-[11px] font-semibold">
                              Writes off
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedShops.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-semibold text-ink-2">
                    Shop listing status
                  </span>
                  <SegmentedControl
                    label="Publish mode"
                    value={publishMode}
                    onChange={setPublishMode}
                    options={[
                      { id: "DRAFT", label: "Draft / Unlisted" },
                      { id: "LIVE", label: "Publish live" },
                    ]}
                  />
                  <p className="text-[12px] text-ink-3">
                    {publishMode === "DRAFT"
                      ? "Creates a TikTok Draft and Unlisted Shopee item so you can double-check photos and attributes first."
                      : "Submits live to buyers right away. If a category requires extra attributes, you can switch failed shops to Draft on retry."}
                  </p>
                </div>
              )}
            </div>

            {/* Categories */}
            {selectedShops.length > 0 && (
              <div className="space-y-2.5">
                <span className="block text-[13px] font-semibold text-ink-2">Categories</span>
                {(bootstrap?.presets.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1 text-[12px] font-semibold text-brand">
                      <Sparkles className="h-3.5 w-3.5" />
                      1-tap from your existing items
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {bootstrap!.presets.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => applyPreset(p)}
                          className="pressable min-h-9 rounded-full bg-brand-soft px-3 py-1 text-[12px] font-bold text-brand hover:bg-brand/15"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {selectedShops.map((s) => {
                    const chosen = categoriesByShop[s.id];
                    const platformLabel = s.platform === "SHOPEE" ? "Shopee" : "TikTok";
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setPickerShopId(s.id)}
                        className="pressable-row flex min-h-12 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3.5 py-2 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-ink-3">
                            {platformLabel} category
                          </span>
                          <span className="block truncate text-[14px] font-semibold text-ink">
                            {chosen?.categoryId
                              ? chosen.categoryName
                                ? `${chosen.categoryName} (${chosen.categoryId})`
                                : `ID ${chosen.categoryId}`
                              : "Tap to search or enter ID"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Variations & stock */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="block text-[13px] font-semibold text-ink-2">
                  Sizes, colors &amp; stock
                </span>
                <SegmentedControl
                  label="Variations mode"
                  value={variantMode}
                  onChange={setVariantMode}
                  options={[
                    { id: "single", label: "Single item" },
                    { id: "multi", label: "Has variations" },
                  ]}
                />
              </div>

              {variantMode === "single" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-ink-2">
                      Price (₱)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={singlePrice}
                      onChange={(e) => setSinglePrice(e.target.value)}
                      className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] font-bold text-ink outline-none focus:border-brand"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-ink-2">
                      On-shelf stock
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={singleStock}
                      onChange={(e) => setSingleStock(e.target.value)}
                      className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] font-bold text-ink outline-none focus:border-brand"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-[var(--radius-card)] bg-surface-subtle p-3">
                  {/* Tier 1 */}
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={tier1Name}
                      onChange={(e) => setTier1Name(e.target.value)}
                      placeholder="Option 1 name (e.g. Color)"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] font-semibold text-ink outline-none focus:border-brand"
                    />
                    {tier1Options.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tier1Options.map((opt) => (
                          <span
                            key={opt}
                            className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[13px] font-semibold text-ink shadow-xs"
                          >
                            {opt}
                            <button
                              type="button"
                              aria-label={`Remove ${opt}`}
                              onClick={() =>
                                setTier1Options((prev) => prev.filter((x) => x !== opt))
                              }
                              className="text-ink-3 hover:text-ink"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tier1Draft}
                        onChange={(e) => setTier1Draft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addOption(1);
                          }
                        }}
                        placeholder="Add choices (e.g. Black, White)"
                        className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] text-ink outline-none focus:border-brand"
                      />
                      <Button variant="secondary" onClick={() => addOption(1)} className="!h-10 !px-3">
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Tier 2 */}
                  {!useTier2 ? (
                    <button
                      type="button"
                      onClick={() => setUseTier2(true)}
                      className="pressable inline-flex items-center gap-1 text-[13px] font-bold text-brand"
                    >
                      <Plus className="h-4 w-4" />
                      Add 2nd option (e.g. Size)
                    </button>
                  ) : (
                    <div className="space-y-2 border-t border-hairline pt-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={tier2Name}
                          onChange={(e) => setTier2Name(e.target.value)}
                          placeholder="Option 2 name (e.g. Size)"
                          className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] font-semibold text-ink outline-none focus:border-brand"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setUseTier2(false);
                            setTier2Options([]);
                          }}
                          className="text-[12px] font-semibold text-ink-3 hover:text-ink"
                        >
                          Remove
                        </button>
                      </div>
                      {tier2Options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {tier2Options.map((opt) => (
                            <span
                              key={opt}
                              className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[13px] font-semibold text-ink shadow-xs"
                            >
                              {opt}
                              <button
                                type="button"
                                aria-label={`Remove ${opt}`}
                                onClick={() =>
                                  setTier2Options((prev) => prev.filter((x) => x !== opt))
                                }
                                className="text-ink-3 hover:text-ink"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={tier2Draft}
                          onChange={(e) => setTier2Draft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addOption(2);
                            }
                          }}
                          placeholder="Add choices (e.g. S, M, L)"
                          className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] text-ink outline-none focus:border-brand"
                        />
                        <Button variant="secondary" onClick={() => addOption(2)} className="!h-10 !px-3">
                          Add
                        </Button>
                      </div>
                    </div>
                  )}

                  {!matrix.ok ? (
                    <p className="text-[13px] font-semibold text-missing-ink">{matrix.error}</p>
                  ) : (
                    activeTiers.length > 0 && (
                      <div className="space-y-2 border-t border-hairline pt-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              min={1}
                              step="0.01"
                              value={bulkPrice}
                              onChange={(e) => setBulkPrice(e.target.value)}
                              placeholder="All ₱"
                              className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2.5 text-[14px] text-ink"
                            />
                            <Button
                              variant="secondary"
                              onClick={() => applyBulk("price")}
                              className="!h-9 !px-2.5 !text-[12px]"
                            >
                              Apply
                            </Button>
                          </div>
                          <div className="flex gap-1">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={bulkStock}
                              onChange={(e) => setBulkStock(e.target.value)}
                              placeholder="All stock"
                              className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2.5 text-[14px] text-ink"
                            />
                            <Button
                              variant="secondary"
                              onClick={() => applyBulk("stock")}
                              className="!h-9 !px-2.5 !text-[12px]"
                            >
                              Apply
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                          {matrix.variants.map((v) => (
                            <div
                              key={v.label}
                              className="flex items-center gap-2 rounded-[var(--radius-control)] bg-surface px-2.5 py-2"
                            >
                              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                                {v.label}
                              </span>
                              <input
                                type="number"
                                min={1}
                                step="0.01"
                                aria-label={`${v.label} price`}
                                value={v.pricePhp}
                                onChange={(e) => {
                                  const val = Number.parseFloat(e.target.value);
                                  setVariantEdits((prev) => ({
                                    ...prev,
                                    [v.label]: {
                                      pricePhp: Number.isFinite(val) ? val : 0,
                                      stock: prev[v.label]?.stock ?? v.stock,
                                    },
                                  }));
                                }}
                                className="h-9 w-20 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2 text-right text-[14px] font-bold tabular-nums text-ink"
                              />
                              <input
                                type="number"
                                min={0}
                                step={1}
                                aria-label={`${v.label} stock`}
                                value={v.stock}
                                onChange={(e) => {
                                  const val = Number.parseInt(e.target.value, 10);
                                  setVariantEdits((prev) => ({
                                    ...prev,
                                    [v.label]: {
                                      pricePhp: prev[v.label]?.pricePhp ?? v.pricePhp,
                                      stock: Number.isFinite(val) ? Math.max(0, val) : 0,
                                    },
                                  }));
                                }}
                                className="h-9 w-16 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2 text-right text-[14px] font-bold tabular-nums text-ink"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Optional details */}
            <Disclosure
              className="rounded-[var(--radius-card)] border border-ink/10 px-3.5 py-2.5"
              label={
                <span className="text-[14px] font-semibold text-ink-2">
                  Details: weight, cost, bin
                </span>
              }
            >
              <div className="mt-3 space-y-3 border-t border-hairline pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-ink-2">
                      Weight (kg)
                    </label>
                    <input
                      type="number"
                      min={0.01}
                      max={50}
                      step="0.05"
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] text-ink"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-ink-2">
                      Unit cost / puhunan (₱)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={unitCostPhp}
                      onChange={(e) => setUnitCostPhp(e.target.value)}
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] text-ink"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-ink-2">
                      Bin / shelf label
                    </label>
                    <input
                      type="text"
                      value={binLocation}
                      onChange={(e) => setBinLocation(e.target.value)}
                      placeholder="e.g. A3"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] text-ink"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-ink-2">
                      Safety buffer override
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={safetyBuffer}
                      onChange={(e) => setSafetyBuffer(e.target.value)}
                      placeholder={`Default (${bootstrap?.defaults?.safetyBuffer ?? 0})`}
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] text-ink"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-[12px] font-semibold text-ink-2">
                    Package L × W × H (cm, optional)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      min={1}
                      value={lengthCm}
                      onChange={(e) => setLengthCm(e.target.value)}
                      placeholder="L"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2.5 text-[15px] text-ink"
                    />
                    <input
                      type="number"
                      min={1}
                      value={widthCm}
                      onChange={(e) => setWidthCm(e.target.value)}
                      placeholder="W"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2.5 text-[15px] text-ink"
                    />
                    <input
                      type="number"
                      min={1}
                      value={heightCm}
                      onChange={(e) => setHeightCm(e.target.value)}
                      placeholder="H"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-2.5 text-[15px] text-ink"
                    />
                  </div>
                </div>
              </div>
            </Disclosure>
          </div>
        )}

        {stage === "preview" && matrix.ok && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface-subtle p-3.5">
              {imageUrls[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imageUrls[0]}
                  alt={title}
                  className="h-16 w-16 shrink-0 rounded-[var(--radius-control)] object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-muted text-[12px] font-semibold text-ink-3">
                  No photo
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-[16px] font-extrabold text-ink">{title.trim()}</p>
                <p className="text-[13px] text-ink-2 tabular-nums">
                  {matrix.variants.length} variant{matrix.variants.length === 1 ? "" : "s"} ·{" "}
                  {matrix.variants.reduce((sum, v) => sum + v.stock, 0)} on shelf ·{" "}
                  {imageUrls.length} photo{imageUrls.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {effectiveSafetyBuffer > 0 && (
              <p className="rounded-[var(--radius-control)] bg-brand-soft px-3 py-2 text-[12px] font-semibold text-brand">
                Safety buffer of {effectiveSafetyBuffer} holds back stock per variation: shops will receive{" "}
                {matrix.variants
                  .slice(0, 3)
                  .map(
                    (v) =>
                      `${v.label}: ${computeShopPublishStock(v.stock, parsedSafetyBuffer, effectiveSafetyBuffer)}`
                  )
                  .join(", ")}
                {matrix.variants.length > 3 ? "…" : ""}
              </p>
            )}

            <div className="space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.03em] text-ink-3">
                Targets
              </p>
              <div className="rounded-[var(--radius-control)] border border-ink/10 bg-surface px-3.5 py-2.5 text-[14px]">
                <span className="font-bold text-ink">Kyna Ops</span>
                <span className="block text-[12px] text-ink-2">
                  Creates item, variants, and starting shelf stock immediately.
                </span>
              </div>
              {selectedShops.map((s) => {
                const cat = categoriesByShop[s.id];
                const modeLabel =
                  s.platform === "SHOPEE"
                    ? publishMode === "LIVE"
                      ? "Live (NORMAL)"
                      : "Unlisted"
                    : publishMode === "LIVE"
                      ? "Live (Review)"
                      : "Draft";
                return (
                  <div
                    key={s.id}
                    className="rounded-[var(--radius-control)] border border-ink/10 bg-surface px-3.5 py-2.5 text-[14px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-ink">{s.shopName}</span>
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-ink-2">
                        {s.writesEnabled ? modeLabel : "Writes off · Skip"}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-3">
                      Category:{" "}
                      {cat?.categoryName ? `${cat.categoryName} (${cat.categoryId})` : cat?.categoryId}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stage === "results" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] bg-emerald-500/12 p-3.5 text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-[14px] font-bold">Saved in Kyna Ops</p>
                <p className="text-[12px]">
                  Your item and starting shelf counts are ready in Items &amp; stock.
                </p>
              </div>
            </div>

            {results.map((r) => {
              const isOk = r.status === "PUSHED";
              const isSkipped = r.status === "SKIPPED";
              const busy = retryingId === r.itemPublishId;
              return (
                <div
                  key={r.itemPublishId}
                  className="space-y-2 rounded-[var(--radius-card)] border border-ink/10 bg-surface p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold text-ink">{r.shopName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        isOk
                          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                          : isSkipped
                            ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                            : "bg-missing-soft text-missing-ink"
                      }`}
                    >
                      {isOk
                        ? r.publishMode === "LIVE"
                          ? "Published"
                          : r.platform === "SHOPEE"
                            ? "Unlisted"
                            : "Draft"
                        : isSkipped
                          ? "Skipped"
                          : "Failed"}
                    </span>
                  </div>

                  {r.externalListingId && (
                    <p className="text-[12px] text-ink-3 tabular-nums">
                      Shop listing ID: {r.externalListingId}
                    </p>
                  )}

                  {r.error && (
                    <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-amber-500/10 p-2.5 text-[12px] text-amber-900 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{r.error}</span>
                    </div>
                  )}

                  {!isOk && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => retryShop(r.itemPublishId, false)}
                        className="!h-10 !px-3 !text-[13px]"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {busy ? "Pushing..." : `Retry ${r.platform === "SHOPEE" ? "Shopee" : "TikTok"}`}
                      </Button>
                      {r.publishMode === "LIVE" && (
                        <Button
                          variant="plain"
                          disabled={busy}
                          onClick={() => retryShop(r.itemPublishId, true)}
                          className="!h-10 !px-3 !text-[13px]"
                        >
                          Save as draft instead
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Sheet>

      {pickerShop && (
        <CategoryPickerSheet
          open={Boolean(pickerShop)}
          onClose={() => setPickerShopId(null)}
          shopId={pickerShop.id}
          shopName={pickerShop.shopName}
          platform={pickerShop.platform as ShopPlatform}
          selectedCategoryId={categoriesByShop[pickerShop.id]?.categoryId ?? ""}
          recentCategories={pickerRecent}
          onSelect={(categoryId, categoryName) =>
            setCategoriesByShop((prev) => ({
              ...prev,
              [pickerShop.id]: { categoryId, categoryName },
            }))
          }
        />
      )}
    </>
  );
}
