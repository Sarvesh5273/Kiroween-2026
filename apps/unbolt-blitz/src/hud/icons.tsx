/** Tray with an up arrow: the "upload a custom .glb" glyph. Decorative, so it is hidden from assistive tech. */
export function UploadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="bz-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 10.5V2.5" />
      <path d="M5 5.5 8 2.5l3 3" />
      <path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
