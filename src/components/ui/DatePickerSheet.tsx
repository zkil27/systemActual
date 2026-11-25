"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { getManilaTodayStr } from "@/lib/time";
import { manilaDayLabel } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/motion";

/*
 * In-app calendar that replaces the browser / iOS / Android date pickers.
 * All dates are Manila calendar days as "YYYY-MM-DD" strings, which sort
 * and compare correctly as plain strings.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const monthFmt = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
const fullFmt = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function toYmd(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function addDays(ymd: string, n: number): string {
  const p = parseYmd(ymd)!;
  return toYmd(p.y, p.m, p.d + n);
}

function utcDate(ymd: string): Date {
  const p = parseYmd(ymd)!;
  return new Date(Date.UTC(p.y, p.m, p.d));
}

function clamp(ymd: string, min?: string, max?: string): string {
  if (min && ymd < min) return min;
  if (max && ymd > max) return max;
  return ymd;
}

/** Month index (y * 12 + m) so months compare and step as integers. */
function monthKey(ymd: string): number {
  const p = parseYmd(ymd)!;
  return p.y * 12 + p.m;
}

type SingleProps = {
  mode?: "single";
  value: string;
  onChange: (ymd: string) => void;
};

type RangeProps = {
  mode: "range";
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  /** Shows a Clear button that removes the range. */
  onClear?: () => void;
};

export type DatePickerSheetProps = (SingleProps | RangeProps) & {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Earliest pickable day. */
  min?: string;
  /** Latest pickable day. Defaults to today in Manila. */
  max?: string;
};

export function DatePickerSheet(props: DatePickerSheetProps) {
  const { open, onClose } = props;
  const isRange = props.mode === "range";
  const title = props.title ?? (isRange ? "Pick dates" : "Pick a date");

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {/* Remount on each open so the calendar starts from the current value. */}
      {open && <Picker {...props} />}
    </Sheet>
  );
}

function Picker(props: DatePickerSheetProps) {
  const today = useMemo(() => getManilaTodayStr(), []);
  const max = props.max ?? today;
  const min = props.min;
  const isRange = props.mode === "range";

  const initialFrom = isRange ? (props as RangeProps).from : (props as SingleProps).value;
  const initialTo = isRange ? (props as RangeProps).to : "";

  const [start, setStart] = useState(parseYmd(initialFrom) ? initialFrom : "");
  const [end, setEnd] = useState(parseYmd(initialTo) ? initialTo : "");
  const [focusDay, setFocusDay] = useState(() => clamp(start || end || today, min, max));
  const [month, setMonth] = useState(() => monthKey(focusDay));
  const [direction, setDirection] = useState<"prev" | "next" | null>(null);
  // "days" is the calendar; "months" and "years" are quick jumps opened from the title.
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [browseYear, setBrowseYear] = useState(() => Math.floor(monthKey(focusDay) / 12));
  const [yearPageEnd, setYearPageEnd] = useState(() => Number(max.slice(0, 4)));
  const gridRef = useRef<HTMLDivElement>(null);
  const keyboardMove = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const year = Math.floor(month / 12);
  const monthIndex = month % 12;
  const minYear = min ? Number(min.slice(0, 4)) : -Infinity;
  const maxYear = Number(max.slice(0, 4));
  const todayMonth = monthKey(today);

  // The arrows step whatever the current view shows: a month, a year, or 12 years.
  const canPrev =
    view === "days" ? !min || month > monthKey(min) : view === "months" ? browseYear > minYear : yearPageEnd - 11 > minYear;
  const canNext = view === "days" ? month < monthKey(max) : view === "months" ? browseYear < maxYear : yearPageEnd < maxYear;

  function stepView(delta: number) {
    if (delta < 0 ? !canPrev : !canNext) return;
    if (view === "days") goMonth(delta);
    else if (view === "months") setBrowseYear((y) => y + delta);
    else setYearPageEnd((y) => y + delta * 12);
  }

  function openMonths() {
    setBrowseYear(year);
    setView("months");
  }

  function openYears() {
    // Show the page of years that contains the year being browsed.
    setYearPageEnd(maxYear - 12 * Math.floor((maxYear - browseYear) / 12));
    setView("years");
  }

  function pickMonth(m: number) {
    haptic("select");
    setDirection(null);
    setMonth(browseYear * 12 + m);
    setView("days");
  }

  function pickYear(y: number) {
    haptic("select");
    setBrowseYear(y);
    setView("months");
  }

  // Days to render: leading blanks for the first weekday, then the month.
  const cells = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let d = 1; d <= days; d++) out.push(toYmd(year, monthIndex, d));
    return out;
  }, [year, monthIndex]);

  // Keep the roving focus target inside the visible month.
  const visibleFocus = monthKey(focusDay) === month ? focusDay : clamp(toYmd(year, monthIndex, 1), min, max);

  useEffect(() => {
    if (!keyboardMove.current) return;
    keyboardMove.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${visibleFocus}"]`)?.focus();
  }, [visibleFocus, month]);

  function goMonth(delta: number) {
    if (delta < 0 && !canPrev) return;
    if (delta > 0 && !canNext) return;
    setDirection(delta < 0 ? "prev" : "next");
    setMonth((m) => m + delta);
  }

  function moveFocus(next: string) {
    const target = clamp(next, min, max);
    keyboardMove.current = true;
    if (monthKey(target) !== month) setDirection(monthKey(target) < month ? "prev" : "next");
    setFocusDay(target);
    setMonth(monthKey(target));
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in steps) {
      e.preventDefault();
      moveFocus(addDays(visibleFocus, steps[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const p = parseYmd(visibleFocus)!;
      const delta = e.key === "PageUp" ? -1 : 1;
      const lastDay = new Date(Date.UTC(p.y, p.m + delta + 1, 0)).getUTCDate();
      moveFocus(toYmd(p.y, p.m + delta, Math.min(p.d, lastDay)));
    }
  }

  function pick(day: string) {
    haptic("select");
    setFocusDay(day);
    if (!isRange) {
      (props as SingleProps).onChange(day);
      props.onClose();
      return;
    }
    // First tap starts a range, second tap ends it. A tap before the start restarts it.
    if (!start || end || day < start) {
      setStart(day);
      setEnd("");
    } else {
      setEnd(day);
    }
  }

  function apply() {
    if (!isRange || !start) return;
    (props as RangeProps).onApply(start, end || start);
    props.onClose();
  }

  const rangeEnd = end || start;
  const summary = !start
    ? "Tap the first day"
    : !end
      ? `${manilaDayLabel(start)} – tap the last day`
      : start === end
        ? manilaDayLabel(start)
        : `${manilaDayLabel(start)} – ${manilaDayLabel(end)}`;

  return (
    <div className="space-y-4 pt-1">
      {isRange && (
        <p aria-live="polite" className="tabular-nums text-[16px] font-semibold text-ink">
          {summary}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {view === "years" ? (
          <button
            type="button"
            aria-label="Back to months"
            onClick={() => setView("months")}
            className="pressable -ml-2.5 flex h-11 items-center gap-1 rounded-full px-2.5 text-[17px] font-bold tabular-nums text-ink hover:bg-surface-muted"
          >
            {Math.max(yearPageEnd - 11, minYear)} – {yearPageEnd}
            <ChevronDown className="h-[18px] w-[18px] rotate-180 text-brand" strokeWidth={2.6} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={view === "days" ? "Choose month and year" : "Choose year"}
            onClick={view === "days" ? openMonths : openYears}
            className="pressable -ml-2.5 flex h-11 items-center gap-1 rounded-full px-2.5 text-[17px] font-bold tabular-nums text-ink hover:bg-surface-muted"
          >
            <span aria-live="polite">
              {view === "days" ? monthFmt.format(new Date(Date.UTC(year, monthIndex, 1))) : browseYear}
            </span>
            <ChevronDown
              className={`h-[18px] w-[18px] text-brand transition-transform duration-200 ${view === "months" ? "rotate-180" : ""}`}
              strokeWidth={2.6}
            />
          </button>
        )}
        <div className="-mr-2 flex items-center">
          <button
            type="button"
            aria-label={view === "days" ? "Previous month" : view === "months" ? "Previous year" : "Earlier years"}
            disabled={!canPrev}
            onClick={() => stepView(-1)}
            className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-brand-soft disabled:text-ink-3/40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            aria-label={view === "days" ? "Next month" : view === "months" ? "Next year" : "Later years"}
            disabled={!canNext}
            onClick={() => stepView(1)}
            className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-brand-soft disabled:text-ink-3/40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {view === "months" && (
        <div key={`m-${browseYear}`} role="group" aria-label={`Months in ${browseYear}`} className="anim-fade-in grid grid-cols-3 gap-2">
          {MONTHS.map((label, m) => {
            const key = browseYear * 12 + m;
            const disabled = key > monthKey(max) || Boolean(min && key < monthKey(min));
            const selected = key === month;
            const isNow = key === todayMonth;
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                aria-label={`${FULL_MONTHS[m]} ${browseYear}`}
                onClick={() => pickMonth(m)}
                className={`pressable h-16 rounded-[var(--radius-control)] text-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  selected
                    ? "bg-brand-solid font-bold text-on-brand"
                    : disabled
                      ? "cursor-not-allowed text-ink-3/40"
                      : isNow
                        ? "bg-surface-muted font-bold text-brand hover:bg-brand-soft"
                        : "bg-surface-muted font-semibold text-ink hover:bg-surface-track"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {view === "years" && (
        <div key={`y-${yearPageEnd}`} role="group" aria-label="Years" className="anim-fade-in grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, i) => yearPageEnd - 11 + i).map((y) => {
            const disabled = y < minYear || y > maxYear;
            const selected = y === browseYear;
            const isNow = y === Number(today.slice(0, 4));
            return (
              <button
                key={y}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => pickYear(y)}
                className={`pressable h-16 rounded-[var(--radius-control)] text-[16px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  selected
                    ? "bg-brand-solid font-bold text-on-brand"
                    : disabled
                      ? "cursor-not-allowed text-ink-3/40"
                      : isNow
                        ? "bg-surface-muted font-bold text-brand hover:bg-brand-soft"
                        : "bg-surface-muted font-semibold text-ink hover:bg-surface-track"
                }`}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}

      <div className={view === "days" ? "" : "hidden"}>
        <div aria-hidden="true" className="grid grid-cols-7 pb-1">
          {WEEKDAYS.map((w) => (
            <span key={w} className="text-center text-[12px] font-semibold uppercase tracking-[0.02em] text-ink-3">
              {w.slice(0, 1)}
            </span>
          ))}
        </div>

        <div
          ref={gridRef}
          key={month}
          role="group"
          aria-label={monthFmt.format(new Date(Date.UTC(year, monthIndex, 1)))}
          onKeyDown={onGridKeyDown}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goMonth(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => (swipe.current = null)}
          className={`grid touch-pan-y grid-cols-7 gap-y-1 ${
            direction === "next" ? "anim-month-next" : direction === "prev" ? "anim-month-prev" : ""
          }`}
        >
          {cells.map((day, i) => {
            if (!day) return <span key={`blank-${i}`} aria-hidden="true" />;
            const disabled = Boolean((min && day < min) || day > max);
            const isStart = day === start;
            const isEnd = isRange ? day === rangeEnd && Boolean(start) : false;
            const selected = isRange ? isStart || isEnd : day === start;
            const inRange = isRange && Boolean(start && end) && day > start && day < end;
            const hasBand = isRange && Boolean(start && end) && start !== end;
            const isToday = day === today;
            const d = Number(day.slice(8));
            const weekday = i % 7;

            return (
              <div key={day} className="relative flex h-12 items-center justify-center">
                {hasBand && (inRange || isStart || isEnd) && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-1 bg-brand-soft ${
                      isStart ? "left-1/2 right-0" : isEnd ? "left-0 right-1/2" : "inset-x-0"
                    } ${weekday === 0 && !isStart ? "rounded-l-full" : ""} ${
                      weekday === 6 && !isEnd ? "rounded-r-full" : ""
                    }`}
                  />
                )}
                <button
                  type="button"
                  data-day={day}
                  tabIndex={day === visibleFocus ? 0 : -1}
                  disabled={disabled}
                  aria-pressed={selected || inRange}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${fullFmt.format(utcDate(day))}${isToday ? ", today" : ""}`}
                  onClick={() => pick(day)}
                  className={`pressable relative flex h-11 w-11 flex-col items-center justify-center rounded-full text-[16px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                    selected
                      ? "bg-brand-solid font-bold text-on-brand"
                      : disabled
                        ? "cursor-not-allowed text-ink-3/40"
                        : isToday
                          ? "font-bold text-brand hover:bg-brand-soft"
                          : inRange
                            ? "font-semibold text-ink"
                            : "font-medium text-ink hover:bg-surface-muted"
                  }`}
                >
                  {d}
                  {isToday && (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-[7px] h-1 w-1 rounded-full ${selected ? "bg-on-brand" : "bg-brand"}`}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {isRange && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          {(props as RangeProps).onClear ? (
            <Button
              variant="secondary"
              onClick={() => {
                (props as RangeProps).onClear?.();
                props.onClose();
              }}
            >
              Clear
            </Button>
          ) : (
            <Button variant="secondary" onClick={props.onClose}>
              Cancel
            </Button>
          )}
          <Button onClick={apply} disabled={!start}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
