/**
 * Transient toast in the viewport corner. It shows the latest `feedback.toast` for a few seconds
 * and then hides itself, for example `Manual exported: keyboard-manual.html` or
 * `Switched to Naive Radial Explode · 54264 clashes`.
 *
 * The toast is visual only. The same text reaches screen readers through `LiveRegion`, so this copy
 * is hidden from the accessibility tree to avoid a double read.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useAppState } from "../state/AppStateProvider";
import { CheckIcon, InterlockIcon, WarnIcon } from "../ui/icons";
import type { ToastTone } from "../state/types";

/** How long a toast stays visible, in milliseconds. */
export const TOAST_VISIBLE_MS = 3600;

function ToastIcon({ tone }: { tone: ToastTone }): ReactElement {
  switch (tone) {
    case "ok":
      return <CheckIcon size={16} />;
    case "warn":
      return <WarnIcon size={16} />;
    case "info":
      return <InterlockIcon size={16} />;
  }
}

export function ToastHost(): ReactElement | null {
  const toast = useAppState().feedback.toast;
  const seq = toast === null ? null : toast.seq;
  // Sequence number of the toast whose timer is still running. A new `seq` restarts the timer.
  const [shownSeq, setShownSeq] = useState<number | null>(null);

  useEffect(() => {
    if (seq === null) return undefined;
    setShownSeq(seq);
    const timer = window.setTimeout(() => setShownSeq(null), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [seq]);

  if (toast === null || shownSeq !== toast.seq) return null;
  return (
    <div className="gf-toast-slot" aria-hidden="true">
      <p key={toast.seq} className={`gf-toast gf-toast--${toast.tone}`} data-testid="toast">
        <ToastIcon tone={toast.tone} />
        <span>{toast.text}</span>
      </p>
    </div>
  );
}
