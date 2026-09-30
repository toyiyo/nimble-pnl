import type { DashboardSection } from "@/components/dashboard/dashboardSections";

interface DashboardSectionRailProps {
  sections: DashboardSection[];
  activeSectionId: string | null;
  onNavigate: (sectionId: string) => void;
  variant?: "default" | "compact";
}

/**
 * The desktop section rail and the mobile chip row for the dashboard
 * (design doc section 4.8). Both variants render the same section list
 * and call the same `onNavigate` callback. The page owns scroll and
 * collapsible-open behavior; this component only reports intent.
 */
export function DashboardSectionRail({
  sections,
  activeSectionId,
  onNavigate,
  variant = "default",
}: DashboardSectionRailProps) {
  const isCompact = variant === "compact";
  const navLabel = isCompact ? "Dashboard sections (compact)" : "Dashboard sections";

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, sectionId: string) {
    event.preventDefault();
    onNavigate(sectionId);
  }

  if (isCompact) {
    return (
      <nav aria-label={navLabel} className="flex gap-2 overflow-x-auto px-4 py-2">
        {sections.map((section) => {
          const isActive = section.id === activeSectionId;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-label={`Go to ${section.label}`}
              aria-current={isActive ? "location" : undefined}
              onClick={(event) => handleClick(event, section.id)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {section.label}
            </a>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label={navLabel} className="hidden lg:block sticky top-20 space-y-1">
      {sections.map((section) => {
        const isActive = section.id === activeSectionId;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-label={`Go to ${section.label}`}
            aria-current={isActive ? "location" : undefined}
            onClick={(event) => handleClick(event, section.id)}
            className={`block rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              isActive
                ? "text-foreground bg-muted/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
