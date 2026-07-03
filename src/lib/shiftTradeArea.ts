export interface AreaMismatch {
  offeredArea: string; // trimmed, original casing preserved for display
  claimerArea: string;
}

/** Normalize an area value: trimmed string, or null when unknown/blank. */
function normalizeArea(area: string | null | undefined): string | null {
  const t = (area ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Returns mismatch info ONLY when both areas are known and differ
 * (case-insensitive, trimmed comparison). Returns null otherwise —
 * i.e. either area unknown/blank, or the two areas match.
 */
export function getAreaMismatch(
  offeredArea: string | null | undefined,
  claimerArea: string | null | undefined,
): AreaMismatch | null {
  const offered = normalizeArea(offeredArea);
  const claimer = normalizeArea(claimerArea);
  if (!offered || !claimer) return null;
  if (offered.toLocaleLowerCase() === claimer.toLocaleLowerCase()) return null;
  return { offeredArea: offered, claimerArea: claimer };
}
