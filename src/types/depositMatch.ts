/**
 * Payload and status contracts for the Deposit Match feature.
 *
 * The shapes here mirror the JSONB payload built by
 * `get_deposit_match_report` (supabase/migrations/20260901160000_deposit_match_refresh_engine.sql)
 * and the `deposit_match_rules` table
 * (supabase/migrations/20260901140000_deposit_match_tables.sql). The SQL
 * side is authoritative — change both together on a schema change.
 */

export const DEPOSIT_MATCH_STATUSES = [
  'matched',
  'matched_net',
  'pending',
  'late',
  'short',
  'over',
  'needs_review',
  'incomplete',
] as const;

export type DepositMatchStatus = (typeof DEPOSIT_MATCH_STATUSES)[number];

export const DEPOSIT_MATCH_RESOLUTIONS = ['accepted', 'disputed'] as const;

export type DepositMatchResolution = (typeof DEPOSIT_MATCH_RESOLUTIONS)[number];

export const DEPOSIT_MATCH_LINK_METHODS = ['auto', 'manual'] as const;

export type DepositMatchLinkMethod = (typeof DEPOSIT_MATCH_LINK_METHODS)[number];

export const DEPOSIT_MATCH_LINK_STATES = ['suggested', 'confirmed'] as const;

export type DepositMatchLinkState = (typeof DEPOSIT_MATCH_LINK_STATES)[number];

// Statuses that count toward the report's `needs_attention_count`. This set
// must match the SQL filter in `get_deposit_match_report` exactly:
// `status IN ('short', 'over', 'late', 'needs_review')`.
const NEEDS_ATTENTION_STATUSES: ReadonlySet<DepositMatchStatus> = new Set([
  'short',
  'over',
  'late',
  'needs_review',
]);

export function isDepositMatchStatus(value: unknown): value is DepositMatchStatus {
  return (
    typeof value === 'string' &&
    (DEPOSIT_MATCH_STATUSES as readonly string[]).includes(value)
  );
}

export function isDepositMatchResolution(
  value: unknown
): value is DepositMatchResolution | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      (DEPOSIT_MATCH_RESOLUTIONS as readonly string[]).includes(value))
  );
}

/** True when a ledger row's status belongs in the attention queue. */
export function needsAttention(status: DepositMatchStatus): boolean {
  return NEEDS_ATTENTION_STATUSES.has(status);
}

/**
 * The fee rate an item paid, as a percent of the expected amount.
 * Returns null when `expectedAmount` is zero, so a caller does not divide
 * by zero.
 */
export function feePercent(
  feeAmount: number,
  expectedAmount: number
): number | null {
  if (!expectedAmount) return null;
  return (feeAmount / expectedAmount) * 100;
}

/** The money a stream still needs to settle: expected minus received minus fees. */
export function settlingAmount(stream: {
  expected_total: number;
  received_total: number;
  fee_total: number;
}): number {
  return stream.expected_total - stream.received_total - stream.fee_total;
}

export interface DepositMatchLink {
  link_id: string;
  bank_transaction_id: string;
  allocated_amount: number;
  method: DepositMatchLinkMethod;
  state: DepositMatchLinkState;
  match_reason: string | null;
}

export interface DepositMatchLedgerRow {
  item_id: string;
  rule_id: string;
  pos_source: string;
  business_date: string;
  expected_amount: number;
  received_amount: number;
  fee_amount: number;
  status: DepositMatchStatus;
  status_reason: string | null;
  resolution: DepositMatchResolution | null;
  resolution_note: string | null;
  links: DepositMatchLink[];
}

export interface DepositMatchStreamSummary {
  rule_id: string;
  pos_source: string;
  rail: string;
  active: boolean;
  expected_total: number;
  received_total: number;
  fee_total: number;
  item_count: number;
}

export interface DepositMatchSummary {
  total_expected: number;
  total_received: number;
  total_fees: number;
  pending_count: number;
  needs_attention_count: number;
}

export interface DepositMatchBank {
  connected_bank_id: string;
  institution_name: string;
  status: string;
  data_current_through: string | null;
}

export interface DepositMatchReport {
  summary: DepositMatchSummary;
  streams: DepositMatchStreamSummary[];
  ledger: DepositMatchLedgerRow[];
  banks: DepositMatchBank[];
}

export class DepositMatchPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepositMatchPayloadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses and checks the `get_deposit_match_report` RPC payload. Throws
 * `DepositMatchPayloadError` when the shape does not match the contract —
 * a shape mismatch must fail loud, not render a wrong ledger.
 */
export function parseDepositMatchReport(raw: unknown): DepositMatchReport {
  if (!isRecord(raw)) {
    throw new DepositMatchPayloadError('deposit match report payload is not an object');
  }

  const { summary, streams, ledger, banks } = raw;

  if (!isRecord(summary)) {
    throw new DepositMatchPayloadError('deposit match report payload is missing summary');
  }
  if (!Array.isArray(streams)) {
    throw new DepositMatchPayloadError('deposit match report payload is missing streams');
  }
  if (!Array.isArray(ledger)) {
    throw new DepositMatchPayloadError('deposit match report payload is missing ledger');
  }
  if (!Array.isArray(banks)) {
    throw new DepositMatchPayloadError('deposit match report payload is missing banks');
  }

  for (const row of ledger) {
    if (!isRecord(row) || !isDepositMatchStatus(row.status)) {
      const badStatus = isRecord(row) ? row.status : undefined;
      throw new DepositMatchPayloadError(
        `deposit match ledger row has an unknown status: ${String(badStatus)}`
      );
    }
    if (!isDepositMatchResolution(row.resolution)) {
      throw new DepositMatchPayloadError(
        `deposit match ledger row has an unknown resolution: ${String(row.resolution)}`
      );
    }
  }

  return raw as unknown as DepositMatchReport;
}

/** Row shape of `deposit_match_rules`. The SQL table is authoritative. */
export interface DepositMatchRule {
  id: string;
  restaurant_id: string;
  pos_source: string;
  rail: 'card';
  connected_bank_id: string;
  settlement: 'gross' | 'net';
  lag_days_min: number;
  lag_days_max: number;
  fee_pct_min: number;
  fee_pct_max: number;
  amount_tolerance: number;
  amount_tolerance_pct: number;
  source_config: Record<string, unknown>;
  descriptor_pattern: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Payload for creating a rule. Columns with a SQL default are optional. */
export interface DepositMatchRuleInput {
  restaurant_id: string;
  pos_source: string;
  rail: 'card';
  connected_bank_id: string;
  settlement: 'gross' | 'net';
  lag_days_min: number;
  lag_days_max: number;
  fee_pct_min?: number;
  fee_pct_max?: number;
  amount_tolerance?: number;
  amount_tolerance_pct?: number;
  source_config?: Record<string, unknown>;
  descriptor_pattern?: string | null;
  active?: boolean;
}

/** Payload for updating a rule. `restaurant_id` never changes after create. */
export type DepositMatchRuleUpdate = Partial<
  Omit<DepositMatchRuleInput, 'restaurant_id'>
>;

/** Payload for writing a manual resolution (accept/dispute) on an item. */
export interface DepositMatchResolutionInput {
  item_id: string;
  resolution: DepositMatchResolution;
  resolution_note?: string | null;
}

/** Payload for confirming a suggested link. */
export interface DepositMatchLinkConfirmInput {
  link_id: string;
}
