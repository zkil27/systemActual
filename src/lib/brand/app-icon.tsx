import { ImageResponse } from "next/og";
import { BRAND_TEAL } from "./icons";

/**
 * Draws the Kyna Ops mark: a rounded-stroke "K" on a full-bleed teal square.
 * The phone applies its own corner mask, so the square stays square unless
 * `rounded` is set (browser tab favicon).
 *
 * `glyphScale` is the share of the canvas the mark occupies. Maskable icons
 * keep it inside the 80% safe zone.
 */
export function renderAppIcon(
  size: number,
  { glyphScale = 0.56, rounded = false }: { glyphScale?: number; rounded?: boolean } = {}
) {
  const glyph = Math.round(size * glyphScale);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_TEAL,
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 100 100">
          <g
            fill="none"
            stroke="#ffffff"
            strokeWidth={13}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="30" y1="18" x2="30" y2="82" />
            {/* Arm meets the stem; the leg starts on the arm, so no caps show. */}
            <line x1="74" y1="18" x2="31" y2="61" />
            <line x1="47" y1="45" x2="76" y2="82" />
          </g>
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
