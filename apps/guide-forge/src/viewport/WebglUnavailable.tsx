/**
 * Text panel shown in place of the canvas when WebGL cannot start or its context is lost
 * (Requirement 3.11). The Manifest_Panel is a sibling in the layout and stays usable.
 */
import type { ReactElement } from "react";
import { WarnIcon } from "../ui/icons";

export interface WebglUnavailableProps {
  /** Technical reason reported by the scene controller, shown as detail text when present. */
  reason?: string | null;
}

export function WebglUnavailable({ reason = null }: WebglUnavailableProps): ReactElement {
  return (
    <div className="gf-webgl-unavailable" role="alert">
      <WarnIcon size={32} />
      <h2 className="gf-webgl-unavailable__heading">WebGL is unavailable</h2>
      <p className="gf-webgl-unavailable__body">
        WebGL is unavailable in this browser, so the 3D view cannot be shown. The step list and bill
        of materials still work.
      </p>
      {reason !== null && reason !== "" ? (
        <p className="gf-webgl-unavailable__body">Reason: {reason}</p>
      ) : null}
    </div>
  );
}
