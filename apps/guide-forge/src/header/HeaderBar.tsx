/**
 * Header_Bar (Requirements 2.2, 2.4, 6.1, 7.1, 10.1): the brand mark and title, the Kit_Selector,
 * the upload control, the Hero_Toggle, the Clash_Badge and the offline manual export button. It reads App_State through the context
 * hooks of its children and changes it only by dispatching App_Actions.
 */
import type { ReactElement } from "react";
import { ClashBadge } from "./ClashBadge";
import { ExportManualButton } from "./ExportManualButton";
import { HeroToggle } from "./HeroToggle";
import { KitSelector } from "./KitSelector";
import { UploadButton } from "./UploadButton";

/**
 * Brand mark: an isometric part with a dimension line, drawn in the CAD icon style of `ui/icons`
 * (24 x 24 grid, 1.5 px square-cap strokes, `currentColor`). Decorative, because the title text
 * next to it names the app.
 */
function BrandMark(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.125}
      strokeLinecap="square"
      strokeLinejoin="miter"
      focusable="false"
      aria-hidden="true"
    >
      <polygon points="12,2.5 19.5,6.75 19.5,15.25 12,19.5 4.5,15.25 4.5,6.75" />
      <polyline points="4.5,6.75 12,11 19.5,6.75" />
      <line x1="12" y1="11" x2="12" y2="19.5" />
      <line x1="3" y1="22" x2="21" y2="22" strokeDasharray="2 1.5" />
      <line x1="3" y1="20.5" x2="3" y2="23.5" />
      <line x1="21" y1="20.5" x2="21" y2="23.5" />
    </svg>
  );
}

export function HeaderBar(): ReactElement {
  return (
    <header className="gf-header">
      <div className="gf-header__group">
        <BrandMark />
        <div className="gf-header__brand">
          <h1 className="gf-header__title">Guide Forge</h1>
          <span className="gf-header__subtitle">Disassembly manual studio</span>
        </div>
      </div>
      <KitSelector />
      <UploadButton />
      <div className="gf-header__spacer" />
      <HeroToggle />
      <ClashBadge />
      <ExportManualButton />
    </header>
  );
}
