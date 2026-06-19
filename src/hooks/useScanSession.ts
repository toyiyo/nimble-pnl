import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Product } from '@/hooks/useProducts';
import { createScanGate } from '@/utils/scannerConfig';

export type ScanSessionState =
  | 'scanning'
  | 'lookingUp'
  | 'quickEntry'
  | 'fullEntry'
  | 'confirmed'
  | 'ended';

export interface UseScanSessionDeps {
  /** Look up an existing product by scanned GTIN. May resolve null or reject. */
  findProductByGtin: (gtin: string) => Promise<Product | null>;
  /** Build a prefilled NEW product for the full form. Must NOT throw (fall back to a blank product). */
  resolveNewProduct: (gtin: string) => Promise<Product>;
  onError?: (message: string) => void;
  /** Called when the user ends the session (Done). */
  onExit?: () => void;
}

export interface ScanSession {
  state: ScanSessionState;
  /** Synchronously-mirrored state ref — safe to read in stale-closure callbacks. */
  stateRef: RefObject<ScanSessionState>;
  isScanning: boolean;
  itemsThisSession: number;
  activeProduct: Product | null;
  /** Camera capture entry-point. Guarded: only acts while scanning AND when the gate allows the code. */
  capture: (gtin: string, format?: string) => Promise<void>;
  /** Manual-entry / AI-OCR path: open the full form with a prebuilt product. */
  enterFullEntry: (product: Product) => void;
  commitQuick: () => void;
  commitFull: () => void;
  cancelEntry: () => void;
  scanNext: () => void;
  endSession: () => void;
}

export function useScanSession(deps: UseScanSessionDeps): ScanSession {
  const { findProductByGtin, resolveNewProduct, onError, onExit } = deps;

  const [state, setState] = useState<ScanSessionState>('scanning');
  const [itemsThisSession, setItems] = useState(0);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

  const gateRef = useRef(createScanGate());
  const lastGtinRef = useRef<string | null>(null);

  // Synchronously-mirrored state so the async `capture` guard reads the latest value
  // without forcing `capture` to change identity every transition.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Unmount guard for setState after the await chain (lesson 2026-05-16).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const capture = useCallback(async (gtin: string, _format?: string) => {
    if (stateRef.current !== 'scanning') return;            // only one capture in flight
    if (!gateRef.current.shouldAccept(gtin)) return;        // suppress lingering same code
    lastGtinRef.current = gtin;
    stateRef.current = 'lookingUp';            // synchronous guard — prevents second scan racing in before React commits
    setState('lookingUp');

    let existing: Product | null = null;
    try {
      existing = await findProductByGtin(gtin);
    } catch (err) {
      existing = null;                                      // treat lookup failure as not-found
      onError?.(err instanceof Error ? err.message : 'Product lookup failed');
    }
    if (!mountedRef.current) return;

    if (existing) {
      setActiveProduct(existing);
      setState('quickEntry');
      return;
    }

    let created: Product;
    try {
      created = await resolveNewProduct(gtin);
    } catch (err) {
      // resolveNewProduct contract says it must not throw, but guard anyway.
      // On failure return to scanning so the camera re-arms (no stuck state).
      if (!mountedRef.current) return;
      onError?.(err instanceof Error ? err.message : 'Failed to resolve product');
      setState('scanning');
      return;
    }
    if (!mountedRef.current) return;
    setActiveProduct(created);
    setState('fullEntry');
  }, [findProductByGtin, resolveNewProduct, onError]);

  const enterFullEntry = useCallback((product: Product) => {
    if (stateRef.current !== 'scanning') return;
    lastGtinRef.current = product.gtin || `manual-${product.sku}`;
    setActiveProduct(product);
    setState('fullEntry');
  }, []);

  const commitQuick = useCallback(() => {
    if (lastGtinRef.current) gateRef.current.markAccepted(lastGtinRef.current);
    setItems((n) => n + 1);
    setActiveProduct(null);
    stateRef.current = 'scanning';
    setState('scanning');
  }, []);

  const commitFull = useCallback(() => {
    setItems((n) => n + 1);
    // Synchronously update stateRef BEFORE setState so that any synchronous code
    // running after commitFull() (e.g. Radix onOpenChange(false) in the same microtask)
    // reads 'confirmed' from stateRef.current rather than the stale 'fullEntry'.
    stateRef.current = 'confirmed';
    setState('confirmed');                                  // gate marked on scanNext
  }, []);

  const cancelEntry = useCallback(() => {
    if (lastGtinRef.current) gateRef.current.markAccepted(lastGtinRef.current);
    setActiveProduct(null);
    setState('scanning');
  }, []);

  const scanNext = useCallback(() => {
    if (lastGtinRef.current) gateRef.current.markAccepted(lastGtinRef.current);
    setActiveProduct(null);
    setState('scanning');
  }, []);

  const endSession = useCallback(() => {
    gateRef.current.reset();
    setItems(0);
    setActiveProduct(null);
    setState('ended');
    onExit?.();
  }, [onExit]);

  return {
    state,
    stateRef,
    isScanning: state === 'scanning',
    itemsThisSession,
    activeProduct,
    capture,
    enterFullEntry,
    commitQuick,
    commitFull,
    cancelEntry,
    scanNext,
    endSession,
  };
}
