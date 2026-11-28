// Extra fields on the shift rows of the MCP scheduling read tools.
// Pure, with no Deno imports, so Vitest can import this file.

export type PositionFields =
  | { position_mismatch: false }
  | { position_mismatch: true; shift_position: string; employee_position: string };

/**
 * position_mismatch for a shift row: true when the shift position and the
 * employee position are both set and differ. Case and outer spaces do not
 * count. The two values appear only on a mismatch, so the rows stay small.
 */
export function positionFields(
  shiftPosition: string | null | undefined,
  employeePosition: string | null | undefined,
): PositionFields {
  const a = (shiftPosition ?? "").trim();
  const b = (employeePosition ?? "").trim();
  return a !== "" && b !== "" && a.toLowerCase() !== b.toLowerCase()
    ? { position_mismatch: true, shift_position: shiftPosition as string, employee_position: employeePosition as string }
    : { position_mismatch: false };
}
