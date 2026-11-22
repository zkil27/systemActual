import Link from "next/link";

type Variant = "primary" | "secondary" | "plain" | "danger";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-solid text-on-brand hover:bg-brand-solid-hover disabled:bg-brand-solid/50",
  secondary: "bg-surface-muted text-ink hover:bg-surface-track disabled:text-ink-3",
  plain: "text-brand hover:bg-brand-soft disabled:text-ink-3",
  danger: "bg-missing-soft text-missing-ink hover:bg-missing/15",
};

const SIZES: Record<Size, string> = {
  md: "h-12 px-5 text-[16px]",
  lg: "h-14 px-6 text-[17px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", full = false) {
  return `pressable inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-bold disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""}`;
}

export function Button({
  variant = "primary",
  size = "md",
  full = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`${buttonClass(variant, size, full)} ${className}`}
    />
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  full = false,
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`${buttonClass(variant, size, full)} ${className}`}>
      {children}
    </Link>
  );
}

/** Grouped container, iOS "inset grouped" style. */
export function Group({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Section heading above a group, with an optional trailing link. */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <h2 className="text-[20px] font-extrabold tracking-[-0.01em] text-ink">{title}</h2>
      {action}
    </div>
  );
}
