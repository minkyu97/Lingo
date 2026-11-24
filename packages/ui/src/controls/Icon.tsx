import type { LucideIcon } from "lucide-react";

export type { LucideIcon };

/**
 * The design draws icons with a 2px stroke on a 24px grid, scaled to 20px,
 * and keeps that weight at every size.
 */
const STROKE_WIDTH = (2 * 20) / 24;

export interface IconProps {
  icon: LucideIcon;
  /** Edge length in px. */
  size?: 14 | 16 | 20;
}

/**
 * A Lucide icon at the design's stroke weight. It takes the color of the text
 * around it, and it is decorative: the control it sits in carries the name.
 */
export function Icon({ icon: Glyph, size = 16 }: IconProps) {
  return (
    <Glyph
      className="lingo-icon"
      size={size}
      strokeWidth={STROKE_WIDTH}
      nonScalingStroke
    />
  );
}
