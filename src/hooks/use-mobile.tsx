import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const viewportMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const standaloneMql = window.matchMedia('(display-mode: standalone)');

    const update = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT || standaloneMql.matches);
    };

    viewportMql.addEventListener("change", update);
    standaloneMql.addEventListener("change", update);
    update();

    return () => {
      viewportMql.removeEventListener("change", update);
      standaloneMql.removeEventListener("change", update);
    };
  }, []);

  return !!isMobile;
}
