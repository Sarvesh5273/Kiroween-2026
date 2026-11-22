import { useEffect, useId, useRef } from "react";
import { recoveryCopyFor } from "./recoveryCopy";
import type { RecoveryCause } from "./recoveryCopy";

export interface RecoveryScreenProps {
  cause: RecoveryCause;
  /** Loads the Lockbox Bundled_Level and dismisses the screen. */
  onLoadLockbox: () => void;
  /** Opens the file picker. */
  onTryAnotherFile: () => void;
}

/** Full-screen recovery plate: explains what happened and offers two next steps. */
export function RecoveryScreen({ cause, onLoadLockbox, onTryAnotherFile }: RecoveryScreenProps) {
  const copy = recoveryCopyFor(cause);
  const titleId = useId();
  const bodyId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [cause]);

  return (
    <div className="bz-recovery">
      <div
        className="bz-recovery__plate"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <h2 className="bz-recovery__title" id={titleId}>
          {copy.title}
        </h2>
        <p className="bz-recovery__body" id={bodyId}>
          {copy.body}
        </p>
        <div className="bz-recovery__actions">
          <button type="button" className="bz-button" ref={primaryRef} onClick={onLoadLockbox}>
            Load Lockbox
          </button>
          <button type="button" className="bz-button bz-button--ghost" onClick={onTryAnotherFile}>
            Try another file
          </button>
        </div>
      </div>
    </div>
  );
}
