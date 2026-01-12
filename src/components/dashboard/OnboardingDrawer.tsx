
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Sheet, 
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  CheckCircle2, 
  Circle, 
  ChevronRight, 
  Users,
  UtensilsCrossed,
  Building2,
  ListTodo
} from 'lucide-react';
import { useOnboardingStatus, OnboardingStep } from '@/hooks/useOnboardingStatus';

export const OnboardingDrawer = () => {
  const { steps, completedCount, totalCount, percentage, isLoading, error, refetch } = useOnboardingStatus();
  const [isOpen, setIsOpen] = useState(true);
  const navigate = useNavigate();

  // Load dismissed state from local storage on mount
  useEffect(() => {
    const dismissed = localStorage.getItem('onboarding_drawer_dismissed');
    if (dismissed === 'true' && percentage < 100) {
      setIsOpen(false);
    }
  }, [percentage]);

  const handleOpen = () => {
    setIsOpen(true);
    localStorage.setItem('onboarding_drawer_dismissed', 'false');
  };

  const handleStepClick = (step: OnboardingStep) => {
    navigate(step.path);
    // On mobile, we might want to close the drawer, but for persistent desktop we keep it open
    // setIsOpen(false); 
  };

  if (isLoading) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="flex items-center gap-3 rounded-full bg-background/90 border shadow-lg px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" aria-label="Loading onboarding status" />
          <div className="space-y-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="rounded-lg border bg-destructive/10 text-destructive shadow-lg px-4 py-3" role="alert">
          <p className="text-sm font-medium">Unable to load onboarding steps.</p>
          <p className="text-xs text-destructive/80">Please retry or check your connection.</p>
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isOpen) {
    // Return a floating trigger button or handle this in the main layout
    // For this component, we'll return a fixed button if closed and incomplete
    if (percentage < 100) {
      return (
        <div className="fixed bottom-6 right-6 z-50">
           <Button 
            onClick={handleOpen} 
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg bg-primary hover:bg-primary/90 transition-all hover:scale-105"
            title="Resume Setup"
            aria-label="Resume Setup"
           >
             <ListTodo className="h-6 w-6" />
           </Button>
        </div>
      );
    }
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) {
        localStorage.setItem('onboarding_drawer_dismissed', 'true');
      }
    }} modal={false}>
      {/* 
        We don't render SheetTrigger here because we control open state manually 
        and with the floating button above 
      */}
      <SheetContent 
        side="right" 
        className="w-[400px] sm:w-[450px] p-0 border-l shadow-2xl bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        onInteractOutside={(e) => {
          // Prevent closing when interacting with the app
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
           // Prevent closing on escape if we want it strictly persistent, 
           // but user expectation is usually Escape closes. 
           // We'll allow it to close, which triggers onOpenChange(false)
        }}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b bg-muted/20">
            <div className="flex items-center justify-between mb-4">
              <SheetTitle className="text-lg font-semibold tracking-tight">Getting Started</SheetTitle>
              {/* Close button provided by SheetContent */}
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium text-muted-foreground">
                <SheetDescription>Your workspace is ready</SheetDescription>
                <span>{completedCount} / {totalCount} completed</span>
              </div>
              <Progress value={percentage} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                Most restaurants finish setup in ~20 minutes. You can do this anytime.
              </p>
            </div>
          </div>

          {/* Steps List */}
          <ScrollArea className="flex-1 px-6 py-6">
            <div className="space-y-6">
              {[
                { key: 'operations' as const, label: 'Operations', title: 'Get to Daily P&L', Icon: Users },
                { key: 'inventory' as const, label: 'Inventory', title: 'Track Inventory & COGS', Icon: UtensilsCrossed },
                { key: 'finance' as const, label: 'Finance', title: 'Get Paid & Track Cash', Icon: Building2 },
              ].map(({ key, label, title, Icon }) => (
                <div className="space-y-3" key={key}>
                  <h3 className="text-sm font-medium text-foreground/80 flex items-center gap-2">
                    <Badge variant="outline" className="h-5 px-1.5"><Icon className="h-3 w-3 mr-1"/>{label}</Badge>
                    {title}
                  </h3>
                  <div className="grid gap-3">
                    {steps.filter(s => s.category === key).map(step => (
                      <StepCard key={step.id} step={step} onClick={() => handleStepClick(step)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
};

const StepCard = ({ step, onClick }: { step: OnboardingStep; onClick: () => void }) => {
  return (
    <button 
      type="button"
      onClick={onClick}
      className={`
        group relative flex items-start gap-4 p-4 rounded-lg border transition-all cursor-pointer text-left w-full
        ${step.isCompleted 
          ? 'bg-muted/30 border-transparent hover:bg-muted/50' 
          : 'bg-card hover:border-primary/50 hover:shadow-sm'
        }
      `}
    >
      <div className={`mt-0.5 rounded-full p-0.5 ${step.isCompleted ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`}>
        {step.isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
      </div>
      
      <div className="flex-1 space-y-1">
        <p className={`text-sm font-medium leading-none ${step.isCompleted ? 'text-muted-foreground line-through decoration-transparent' : 'text-foreground'}`}>
          {step.label}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {step.description}
        </p>
        
        {!step.isCompleted && (
          <div className="pt-2">
            <span className="text-xs font-semibold text-primary group-hover:underline inline-flex items-center">
              {step.ctaText} <ChevronRight className="h-3 w-3 ml-0.5" />
            </span>
          </div>
        )}
      </div>
    </button>
  );
};
