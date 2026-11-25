"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  AMBIENT_MOODS,
  AMBIENT_TONES,
  BLOOM_MS,
  getAmbientSnapshot,
  getServerAmbientSnapshot,
  resolveSurface,
  subscribeAmbient,
  type AmbientMoodId,
  type AmbientPulse,
} from "@/lib/ui/ambient";

const MOOD_IDS = Object.keys(AMBIENT_MOODS) as AmbientMoodId[];

type Vars = React.CSSProperties & Record<`--${string}`, string>;

/**
 * The soft color wash behind every screen. Mounted once in the root layout so
 * it survives navigation and can morph between moods instead of restarting.
 * It sits under the page content and never takes a tap.
 */
export function AmbientField() {
  const pathname = usePathname();
  const surface = resolveSurface(pathname);
  const { mood, pulse } = useSyncExternalStore(
    subscribeAmbient,
    getAmbientSnapshot,
    getServerAmbientSnapshot
  );

  // A bloom stays mounted just long enough to play, so coming back to a
  // screen never replays an old one.
  const [bloom, setBloom] = useState<AmbientPulse | null>(null);
  useEffect(() => {
    if (!pulse) return;
    setBloom(pulse);
    const t = setTimeout(() => setBloom((b) => (b?.id === pulse.id ? null : b)), BLOOM_MS);
    return () => clearTimeout(t);
  }, [pulse]);

  // iOS Safari only shows :active press states when the page listens for touches.
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);

  return (
    <div aria-hidden="true" className="ambient-field" data-surface={surface}>
      {MOOD_IDS.map((id) => (
        <div key={id} className="ambient-layer" data-active={id === mood ? "" : undefined}>
          {AMBIENT_MOODS[id].blobs.map((b, i) => (
            <span
              key={i}
              className="ambient-blob"
              style={
                {
                  left: b.x,
                  top: b.y,
                  width: b.w,
                  height: b.h,
                  "--c-light": b.light,
                  "--c-dark": b.dark,
                } as Vars
              }
            />
          ))}
        </div>
      ))}
      {bloom && (
        <span
          key={bloom.id}
          className="ambient-bloom"
          style={
            {
              "--c-light": AMBIENT_TONES[bloom.tone].light,
              "--c-dark": AMBIENT_TONES[bloom.tone].dark,
            } as Vars
          }
        />
      )}
    </div>
  );
}
