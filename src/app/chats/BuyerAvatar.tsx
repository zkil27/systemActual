/** Buyer photo, or their first letter on a soft brand circle. */
export function BuyerAvatar({ name, src, size = "md" }: { name: string; src: string | null; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-9 text-[15px]" : "h-11 w-11 text-[17px]";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={`${box} shrink-0 rounded-full bg-surface-muted object-cover`} />;
  }
  const letter = name.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand`}>
      {letter}
    </span>
  );
}
