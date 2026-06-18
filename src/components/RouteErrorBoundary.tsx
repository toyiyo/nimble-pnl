/**
 * RouteErrorBoundary — catches chunk-load errors from lazy routes and renders
 * a recoverable "Reload page" UI instead of a white screen.
 *
 * Accessibility:
 * - role="alert" on the error container so assistive technology announces the
 *   failure immediately (assertive live region).
 * - tabIndex={-1} + focus() via componentDidUpdate moves keyboard focus to the
 *   container when the error state flips in (WCAG 2.4.3).
 * - "Reload page" button has a descriptive visible label (WCAG 2.4.6 / 4.1.2).
 * - outline-none prevents the default focus ring on the non-interactive container;
 *   the button retains its own focus styling.
 */
import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Injectable reload function; defaults to globalThis.location.reload() for testability. */
  onReload?: () => void;
  /**
   * Pass the current route pathname so the boundary resets when the user
   * navigates to a different route. Without this, a prior chunk-load error
   * blocks all subsequent navigations for the entire session.
   * In App.tsx this is supplied by the LocationKeyedErrorBoundary wrapper.
   */
  location?: string;
}

interface State {
  hasError: boolean;
  /** Mirrors props.location so getDerivedStateFromProps can detect changes. */
  location?: string;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, location: undefined };
  private readonly containerRef = createRef<HTMLDivElement>();

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Reset the error boundary whenever the user navigates to a new route.
    if (props.location !== state.location) {
      return { hasError: false, location: props.location };
    }
    return null;
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RouteErrorBoundary caught an error:', error, info.componentStack);
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    // Move keyboard focus to the alert container as soon as the error state appears,
    // so keyboard-only users reach the Reload button in a single Tab press.
    if (!prevState.hasError && this.state.hasError) {
      this.containerRef.current?.focus();
    }
  }

  private readonly handleReload = () => {
    (this.props.onReload ?? (() => globalThis.location.reload()))();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div
          ref={this.containerRef}
          role="alert"
          tabIndex={-1}
          className="w-full max-w-md rounded-xl border border-border/40 bg-background p-6 text-center outline-none"
        >
          <h2 className="text-[17px] font-semibold text-foreground">
            Couldn&apos;t load this page
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            A network hiccup interrupted loading. Reloading usually fixes it.
          </p>
          <button
            onClick={this.handleReload}
            className="mt-4 h-9 rounded-lg bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/90"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default RouteErrorBoundary;
