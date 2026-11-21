import { Shirt } from "lucide-react";

const SIZES = {
  sm: "h-11 w-11 rounded-[10px]",
  md: "h-14 w-14 rounded-[var(--radius-control)]",
  lg: "h-24 w-24 rounded-[var(--radius-card)]",
  xl: "h-28 w-28 rounded-[var(--radius-card)]",
} as const;

const SHOPEE_CDN_RE = /^https?:\/\/(?:cf\.shopee\.ph|down-ph\.img\.susercontent\.com)\//i;

function thumbUrl(src: string, size: keyof typeof SIZES): string {
  if ((size !== "sm" && size !== "md") || !SHOPEE_CDN_RE.test(src)) return src;
  const qIdx = src.indexOf("?");
  const base = qIdx >= 0 ? src.slice(0, qIdx) : src;
  const query = qIdx >= 0 ? src.slice(qIdx) : "";
  if (base.endsWith("_tn")) return src;
  return `${base}_tn${query}`;
}

/** Garment photo. Zero-SKU items are recognised by sight, so this leads every row. */
export function ItemThumb({
  src,
  alt,
  size = "md",
}: {
  src: string | null;
  alt: string;
  size?: keyof typeof SIZES;
}) {
  if (!src) {
    return (
      <div
        className={`${SIZES[size]} flex shrink-0 items-center justify-center bg-slate-100 text-slate-400`}
        aria-label={alt}
        role="img"
      >
        <Shirt className={size === "lg" || size === "xl" ? "h-9 w-9" : "h-5 w-5"} strokeWidth={1.6} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbUrl(src, size)}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${SIZES[size]} shrink-0 bg-slate-100 object-cover outline outline-1 -outline-offset-1 outline-black/5`}
    />
  );
}
