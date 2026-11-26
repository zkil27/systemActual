export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  trailing?: string;
  keywords?: string;
  pinned?: boolean;
  disabled?: boolean;
}

/**
 * Filter options by whitespace-separated tokens matched case-insensitively
 * across label, description, trailing text, and hidden keywords.
 */
export function filterPickerOptions(
  options: readonly PickerOption[],
  query: string
): PickerOption[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...options];

  return options.filter((opt) => {
    const haystack = [opt.label, opt.description, opt.trailing, opt.keywords]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * Step to the next enabled option index wrapping around, or -1 if none are enabled.
 */
export function stepActiveIndex(
  options: readonly PickerOption[],
  current: number,
  delta: 1 | -1
): number {
  const len = options.length;
  if (len === 0) return -1;

  const start = current >= 0 && current < len ? current : delta === 1 ? -1 : 0;
  for (let offset = 1; offset <= len; offset++) {
    const next = (start + delta * offset + len * 2) % len;
    if (!options[next]?.disabled) return next;
  }
  return -1;
}
