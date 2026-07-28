import * as React from "react";

/**
 * Context that marks a subtree as living inside an overlay that already
 * owns the page's scroll lock (a Radix `Dialog`/`Sheet`/`AlertDialog`
 * content region). Popovers and comboboxes nested inside such a boundary
 * should open `modal` so Radix shards `hideOthers`/scroll-lock scope to
 * the dialog instead of racing the dialog's own lock — see design
 * "Root cause 2" / "The fix: `modal` follows the scroll-lock context".
 *
 * Defaults to `false`: free-standing comboboxes (not nested in any
 * dialog-like overlay) must keep opening non-modal so the page behind
 * them stays visible and scrollable.
 */
const ScrollLockContext = React.createContext(false);

export interface ScrollLockBoundaryProps {
  children: React.ReactNode;
}

/**
 * Marks `children` as inside a scroll-lock-owning overlay. Rendered around
 * the content of `DialogContent`, `SheetContent`, and `AlertDialogContent`
 * so any combobox nested inside picks up `useInsideScrollLock() === true`.
 */
export function ScrollLockBoundary({ children }: ScrollLockBoundaryProps) {
  return (
    <ScrollLockContext.Provider value={true}>
      {children}
    </ScrollLockContext.Provider>
  );
}

/**
 * Returns `true` when called from within a `ScrollLockBoundary` ancestor,
 * `false` otherwise (including when there is no provider at all).
 */
export function useInsideScrollLock(): boolean {
  return React.useContext(ScrollLockContext);
}
