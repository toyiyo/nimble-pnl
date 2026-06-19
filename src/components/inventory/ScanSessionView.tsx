import { useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Package, Loader2, Check, ScanLine } from 'lucide-react';
import { SmartBarcodeScanner } from '@/components/SmartBarcodeScanner';
import { QuickInventoryDialog } from '@/components/QuickInventoryDialog';
import { ProductUpdateDialog, ProductUpdateSheet } from '@/components/ProductUpdateDialog';
import { useScanSession } from '@/hooks/useScanSession';
import type { Product } from '@/hooks/useProducts';

export interface ScanSessionViewProps {
  restaurantId: string | null;
  findProductByGtin: (gtin: string) => Promise<Product | null>;
  resolveNewProduct: (gtin: string) => Promise<Product>;
  onAddQuantity: (product: Product, quantity: number, location?: string) => Promise<void>;
  onUpdateProduct: (product: Product, updates: Partial<Product>, quantityToAdd: number) => Promise<void>;
  onEnhance?: (product: Product) => Promise<any>;
  onExit: () => void;
}

/** Best-effort haptic vibration. Fires on Android web; silently absent on iOS Safari/WKWebView. */
function vibrate() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(20);
    } catch {
      // no-op
    }
  }
}

export function ScanSessionView(props: ScanSessionViewProps) {
  const {
    restaurantId,
    findProductByGtin,
    resolveNewProduct,
    onAddQuantity,
    onUpdateProduct,
    onEnhance,
    onExit,
  } = props;

  const session = useScanSession({ findProductByGtin, resolveNewProduct, onExit });
  const { state, isScanning, itemsThisSession, activeProduct } = session;

  const { capture } = session;
  const handleScan = useCallback(
    (gtin: string, format: string) => {
      vibrate();
      void capture(gtin, format);
    },
    [capture],
  );

  // Test bridge: allow E2E / test harnesses to emit synthetic scans
  useEffect(() => {
    if (
      import.meta.env.MODE !== 'test' &&
      !(window as any).Cypress &&
      !(window as any).__E2E__
    )
      return;
    (window as any).__emitScan = (gtin: string) => handleScan(gtin, 'EAN_13');
    return () => {
      delete (window as any).__emitScan;
    };
  }, [handleScan]);

  const isMobile =
    Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  // An entry overlay is open in quickEntry or fullEntry states
  const entryOpen = state === 'quickEntry' || state === 'fullEntry';

  // The full-entry component: Sheet on mobile (no double-wrap, M1), Dialog on desktop
  const FullEntry = isMobile ? ProductUpdateSheet : ProductUpdateDialog;

  return (
    <div className="relative">
      {/* Visually-hidden live region for VoiceOver (m2) */}
      <div aria-live="polite" className="sr-only">
        {state === 'confirmed' && activeProduct
          ? `Added ${activeProduct.name}. ${itemsThisSession} items this session.`
          : ''}
      </div>

      {/*
        Camera layer — made inert while an entry overlay is open (C2).
        The `inert` attribute removes all descendants from the tab order and
        accessibility tree, so torch/flip/Done controls don't compete with the
        open dialog.
      */}
      <div
        {...(entryOpen ? { inert: '' as any, 'aria-hidden': true } : {})}
        className="relative rounded-xl overflow-hidden"
      >
        {/* Top bar: session counter + Done — safe-area aware (M2) */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-foreground">
            <Package className="h-3.5 w-3.5" aria-hidden="true" />
            {itemsThisSession} added
          </span>
          <Button
            variant="ghost"
            onClick={session.endSession}
            aria-label="Done scanning"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Done
          </Button>
        </div>

        {/* Controlled scanner — active only while state === 'scanning' */}
        <SmartBarcodeScanner onScan={handleScan} active={isScanning} autoStart />

        {/* lookingUp spinner overlay (M5) */}
        {state === 'lookingUp' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin text-foreground" aria-hidden="true" />
            <p className="text-[13px] text-muted-foreground">Looking up product…</p>
          </div>
        )}

        {/* Confirm beat overlay — appears after a successful fullEntry save */}
        {state === 'confirmed' && activeProduct && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center">
              <Check className="h-7 w-7 text-foreground" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Added to inventory
              </p>
              <p className="text-[17px] font-semibold text-foreground">{activeProduct.name}</p>
            </div>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {itemsThisSession} items this session
            </span>
            <div className="w-full max-w-xs space-y-2">
              <Button
                onClick={session.scanNext}
                className="w-full h-11 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
              >
                <ScanLine className="h-4 w-4 mr-2" aria-hidden="true" />
                Scan next item
              </Button>
              <Button
                variant="ghost"
                onClick={session.endSession}
                className="w-full h-10 rounded-lg text-[13px] text-muted-foreground hover:text-foreground"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>

      {/*
        Known item → QuickInventoryDialog (single instance, controlled open).
        The dialog is rendered outside the camera layer so it is not affected by
        the `inert` attribute on the camera wrapper.
      */}
      {activeProduct && (
        <QuickInventoryDialog
          open={state === 'quickEntry'}
          onOpenChange={(open) => {
            if (!open && state === 'quickEntry') session.cancelEntry();
          }}
          product={activeProduct}
          mode="add"
          restaurantId={restaurantId}
          onSave={async (quantity, location) => {
            await onAddQuantity(activeProduct, quantity, location);
            // commitQuick is success-only (M3): if onAddQuantity throws, the
            // dialog stays open at the entry state (the session stays in quickEntry).
            session.commitQuick();
          }}
        />
      )}

      {/*
        New item → full form (no double-wrap, M1).
        ProductUpdateSheet on mobile / ProductUpdateDialog on desktop —
        both render the shared ProductUpdateContent through a Radix Sheet/Dialog.
      */}
      {activeProduct && (
        <FullEntry
          open={state === 'fullEntry'}
          onOpenChange={(open) => {
            if (!open && state === 'fullEntry') session.cancelEntry();
          }}
          product={activeProduct}
          onEnhance={onEnhance}
          onUpdate={async (updates, quantityToAdd) => {
            await onUpdateProduct(activeProduct, updates, quantityToAdd);
            // commitFull is success-only (M3) → confirm beat.
            session.commitFull();
          }}
        />
      )}
    </div>
  );
}
