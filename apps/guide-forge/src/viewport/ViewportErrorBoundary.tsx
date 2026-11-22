/**
 * Error boundary around the viewport (design: Error Handling, last row).
 *
 * A primitive lookup or `pose` failure on the Main_Thread means a Core contract was broken. It is
 * not caught where it happens. It reaches this boundary, which shows the error text and offers the
 * sample-kit action, so the failure stays visible and the user has a next step.
 */
import { Component, useEffect, useRef, type ErrorInfo, type ReactElement, type ReactNode } from "react";
import { DEFAULT_KIT_NAME, KIT_TITLES } from "../kits";
import { useAppState, useSolver } from "../state/AppStateProvider";
import { WarnIcon } from "../ui/icons";

interface BoundaryProps {
  /** When this value changes, a shown error is cleared and the children render again. */
  resetKey: unknown;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

interface FallbackProps {
  error: Error;
  onLoadSample: () => void;
}

function ViewportErrorFallback({ error, onLoadSample }: FallbackProps): ReactElement {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    cardRef.current?.focus();
  }, []);
  return (
    <div className="gf-viewport__stage">
      <div ref={cardRef} className="gf-recovery" role="alert" tabIndex={-1}>
        <span className="gf-recovery__icon">
          <WarnIcon size={32} />
        </span>
        <h2 className="gf-recovery__heading">The 3D view stopped because of an error</h2>
        <p className="gf-recovery__body">
          The viewport could not draw this assembly. The step list and bill of materials are not
          affected.
        </p>
        <div className="gf-recovery__details">
          <span>
            {error.name}: {error.message}
          </span>
        </div>
        <div className="gf-recovery__actions">
          <button type="button" className="gf-btn gf-btn--primary" onClick={onLoadSample}>
            Load sample kit: {KIT_TITLES[DEFAULT_KIT_NAME]}
          </button>
        </div>
      </div>
    </div>
  );
}

class ErrorBoundaryCore extends Component<
  BoundaryProps & { onLoadSample: () => void },
  BoundaryState
> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(thrown: unknown): BoundaryState {
    return { error: toError(thrown) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the component stack in the console for developers. The user sees the text card.
    console.error("Viewport error", error, info.componentStack);
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return <ViewportErrorFallback error={error} onLoadSample={this.props.onLoadSample} />;
  }
}

/** Wrap the viewport stage. The boundary clears itself when a new Solve_Result or solve starts. */
export function ViewportErrorBoundary({ children }: { children: ReactNode }): ReactElement {
  const state = useAppState();
  const solver = useSolver();
  return (
    <ErrorBoundaryCore
      resetKey={state.solve.activeRequestId}
      onLoadSample={() => solver.solveKit(DEFAULT_KIT_NAME)}
    >
      {children}
    </ErrorBoundaryCore>
  );
}
