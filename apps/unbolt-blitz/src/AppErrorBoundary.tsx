import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RecoveryScreen } from "./recovery/RecoveryScreen";

export interface AppErrorBoundaryProps {
  /** Loads the Lockbox. The boundary clears its error first so the tree can render again. */
  onLoadLockbox: () => void;
  /** Opens the file picker. The boundary clears its error first. */
  onTryAnotherFile: () => void;
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** Shows the "unexpected" Recovery_Screen when a descendant throws while rendering. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(thrown: unknown): AppErrorBoundaryState {
    return { error: toError(thrown) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the failure visible in the console for debugging; the screen shows the message to the player.
    console.error("Unbolt Blitz render error", error, info.componentStack);
  }

  private readonly loadLockbox = (): void => {
    this.setState({ error: null });
    this.props.onLoadLockbox();
  };

  private readonly tryAnotherFile = (): void => {
    this.setState({ error: null });
    this.props.onTryAnotherFile();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <RecoveryScreen
        cause={{ reason: "unexpected", message: error.message }}
        onLoadLockbox={this.loadLockbox}
        onTryAnotherFile={this.tryAnotherFile}
      />
    );
  }
}
