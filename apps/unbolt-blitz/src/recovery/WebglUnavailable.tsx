import { useId } from "react";

export interface WebglUnavailableProps {
  /** Optional retry, for example reloading the page. The button is hidden when omitted. */
  onRetry?: () => void;
}

/** Shown when the browser cannot create a WebGL context. Same plate style as the recovery screens. */
export function WebglUnavailable({ onRetry }: WebglUnavailableProps) {
  const titleId = useId();
  const bodyId = useId();

  return (
    <div className="bz-recovery bz-recovery--webgl">
      <div className="bz-recovery__plate" role="alert" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 className="bz-recovery__title" id={titleId}>
          WebGL is required
        </h2>
        <p className="bz-recovery__body" id={bodyId}>
          The clockwork arena is drawn with WebGL, and this browser could not start it. Turn on hardware
          acceleration in the browser settings, update your graphics driver, or open Unbolt Blitz in another
          browser.
        </p>
        {onRetry ? (
          <div className="bz-recovery__actions">
            <button type="button" className="bz-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
