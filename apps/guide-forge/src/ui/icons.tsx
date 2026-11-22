import type { ReactElement, ReactNode } from "react";

/**
 * Inline SVG icons in a technical CAD drafting style.
 *
 * - 24 x 24 design grid, square line caps, mitred joins, `currentColor` strokes.
 * - Stroke width is compensated for `size`, so the rendered line is always 1.5 px.
 * - No raster image and no icon font.
 * - Decorative by default (`aria-hidden`). Pass `title` to make an icon a labelled image.
 */

export interface IconProps {
  /** Rendered width and height in CSS pixels. Default 20. */
  size?: number;
  /** When set, the icon is exposed as an image with this accessible name and an SVG `<title>`. */
  title?: string;
  className?: string;
}

const GRID = 24;
const STROKE_PX = 1.5;
const DEFAULT_SIZE = 20;

interface IconFrameProps extends IconProps {
  children: ReactNode;
}

function IconFrame({ size = DEFAULT_SIZE, title, className, children }: IconFrameProps): ReactElement {
  const labelled = title !== undefined && title.length > 0;
  // Rendered stroke = strokeWidth * size / GRID, so divide to hold it at 1.5 px.
  const strokeWidth = (STROKE_PX * GRID) / size;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      focusable="false"
      className={className}
      {...(labelled ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {labelled ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Circle with a tick: a passed check. */
export function CheckIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="7.5,12.5 10.5,15.5 16.5,9" />
    </IconFrame>
  );
}

/** Triangle with an exclamation mark. */
export function WarnIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polygon points="12,3 22,20 2,20" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <line x1="12" y1="16.5" x2="12" y2="17.5" />
    </IconFrame>
  );
}

/** Two interlocked chain links. */
export function InterlockIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <rect x="2.5" y="7.5" width="12" height="9" rx="4.5" />
      <rect x="9.5" y="7.5" width="12" height="9" rx="4.5" />
    </IconFrame>
  );
}

/** One solid body inside a dashed enclosure: a single connected island. */
export function IslandIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" />
      <rect x="8" y="8" width="8" height="8" />
    </IconFrame>
  );
}

/** Empty tray. */
export function EmptyIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polyline points="3,13 5.5,5 18.5,5 21,13" strokeDasharray="3 2" />
      <polyline points="3,13 7,13 9,16 15,16 17,13 21,13" />
      <polyline points="3,13 3,19 21,19 21,13" />
    </IconFrame>
  );
}

/** Isometric cube. */
export function GeometryIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" />
      <polyline points="4,7.5 12,12 20,7.5" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </IconFrame>
  );
}

/** Two slider rails with knobs. */
export function ConfigIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <line x1="4" y1="7" x2="6.5" y2="7" />
      <line x1="11.5" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.5" />
      <line x1="4" y1="17" x2="12.5" y2="17" />
      <line x1="17.5" y1="17" x2="20" y2="17" />
      <circle cx="15" cy="17" r="2.5" />
    </IconFrame>
  );
}

/** Page with a folded corner and text rules. */
export function FileIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polygon points="6,3 14,3 19,8 19,21 6,21" />
      <polyline points="14,3 14,8 19,8" />
      <line x1="9" y1="13" x2="16" y2="13" />
      <line x1="9" y1="17" x2="16" y2="17" />
    </IconFrame>
  );
}

/** Processor package with pins: the background worker. */
export function WorkerIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <rect x="7" y="7" width="10" height="10" />
      <line x1="10" y1="3" x2="10" y2="7" />
      <line x1="14" y1="3" x2="14" y2="7" />
      <line x1="10" y1="17" x2="10" y2="21" />
      <line x1="14" y1="17" x2="14" y2="21" />
      <line x1="3" y1="10" x2="7" y2="10" />
      <line x1="3" y1="14" x2="7" y2="14" />
      <line x1="17" y1="10" x2="21" y2="10" />
      <line x1="17" y1="14" x2="21" y2="14" />
    </IconFrame>
  );
}

export function PlayIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polygon points="7,4 19,12 7,20" />
    </IconFrame>
  );
}

export function PauseIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </IconFrame>
  );
}

/** Downward chevron. Rotate it with CSS for the expanded state. */
export function ChevronDownIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polyline points="5,9 12,16 19,9" />
    </IconFrame>
  );
}

/** Bar and left-pointing triangle: previous step. */
export function StepBackIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <line x1="5" y1="5" x2="5" y2="19" />
      <polygon points="19,5 9,12 19,19" />
    </IconFrame>
  );
}

/** Right-pointing triangle and bar: next step. */
export function StepForwardIcon(props: IconProps): ReactElement {
  return (
    <IconFrame {...props}>
      <polygon points="5,5 15,12 5,19" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </IconFrame>
  );
}

export const ICONS = {
  check: CheckIcon,
  warn: WarnIcon,
  interlock: InterlockIcon,
  island: IslandIcon,
  empty: EmptyIcon,
  geometry: GeometryIcon,
  config: ConfigIcon,
  file: FileIcon,
  worker: WorkerIcon,
  play: PlayIcon,
  pause: PauseIcon,
  chevronDown: ChevronDownIcon,
  stepBack: StepBackIcon,
  stepForward: StepForwardIcon,
} as const;

export type IconName = keyof typeof ICONS;
