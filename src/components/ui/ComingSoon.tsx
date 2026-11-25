/** Grey "Coming soon" label for features that wait on a shop's approval (Shopee for now). */
export function ComingSoonPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2.5 py-1 text-[13px] font-bold text-ink-2 ${className}`}
    >
      Coming soon
    </span>
  );
}
