import { Link } from 'react-router-dom';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

import { HelpCircle } from 'lucide-react';

/**
 * "How is 'needed' set?" explainer popover for the coverage panel header.
 *
 * A keyboard-focusable ghost button with a HelpCircle icon triggers a compact
 * popover that explains the demand formula:
 *   Needed staff = projected sales ÷ SPLH, never below minimum crew.
 *
 * Design spec: docs/superpowers/specs/2026-07-03-timeline-area-coverage-design.md
 * Section: "Demand legibility (aggregate panel)"
 */
export function CoverageDemandInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How is needed staff calculated?"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>How is &lsquo;needed&rsquo; set?</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-72 space-y-2 text-[13px]" align="start" sideOffset={6}>
        <p className="text-foreground">
          <strong>Needed staff</strong> = each hour&apos;s projected sales &divide; your target{' '}
          <strong>sales per labor hour (SPLH)</strong>, never below your minimum crew.
        </p>
        <p className="text-muted-foreground">
          <strong>Covered</strong> = scheduled &ge; needed.{' '}
          <strong>Short</strong> = scheduled is below it.
        </p>
        <Link
          to="/settings"
          className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          aria-label="Adjust targets in Staffing settings"
        >
          Adjust targets in Staffing settings &rarr;
        </Link>
      </PopoverContent>
    </Popover>
  );
}
