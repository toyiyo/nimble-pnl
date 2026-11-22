import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StripeEmbeddedConnect } from '@/components/StripeEmbeddedConnect';
import type { usePaymentSetup } from '@/hooks/usePaymentSetup';

interface PaymentSetupSheetProps {
  setup: ReturnType<typeof usePaymentSetup>;
  restaurantId: string | null;
}

export function PaymentSetupSheet({ setup, restaurantId }: PaymentSetupSheetProps) {
  const { isSheetOpen, closeSetup } = setup;

  return (
    <Sheet open={isSheetOpen} onOpenChange={(open) => !open && closeSetup()}>
      <SheetContent
        className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40 text-left">
          <SheetTitle className="text-[17px] font-semibold text-foreground">
            Set up payments
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            Stripe keeps your bank and tax details. EasyShiftHQ does not see them.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isSheetOpen && (
            <StripeEmbeddedConnect
              restaurantId={restaurantId}
              component="account_onboarding"
              onCompleted={closeSetup}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
