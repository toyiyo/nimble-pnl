import { describe, expect, it } from "vitest";
import { groupBanks, totalBalance, accountCount, type ConnectedBank } from "@/utils/financialConnections";

const baseDate = (iso: string) => new Date(iso).toISOString();

const buildBank = (overrides: Partial<ConnectedBank>): ConnectedBank => ({
  id: "bank-1",
  stripe_financial_account_id: "fa_1",
  institution_name: "Mercury",
  institution_logo_url: "logo-1",
  status: "connected",
  connected_at: baseDate("2025-01-01"),
  disconnected_at: null,
  last_sync_at: baseDate("2025-01-02"),
  sync_error: null,
  balances: [
    {
      id: "balance-1",
      connected_bank_id: "bank-1",
      account_name: "Checking",
      account_type: "checking",
      account_mask: "1234",
      current_balance: 1000,
      available_balance: 900,
      currency: "USD",
      as_of_date: baseDate("2025-01-02"),
      is_active: true,
    },
  ],
  ...overrides,
});

describe("financialConnections grouping", () => {
  it("merges banks by institution name and preserves highest-priority status and metadata", () => {
    const banks: ConnectedBank[] = [
      buildBank({ id: "bank-1", connected_at: baseDate("2025-01-01"), last_sync_at: baseDate("2025-01-03") }),
      buildBank({
        id: "bank-2",
        status: "error",
        institution_logo_url: "logo-2",
        connected_at: baseDate("2025-01-05"),
        last_sync_at: baseDate("2025-01-06"),
        sync_error: "Oops",
        balances: [
          {
            id: "balance-2",
            connected_bank_id: "bank-2",
            account_name: "Savings",
            account_type: "savings",
            account_mask: "5678",
            current_balance: 500,
            available_balance: 500,
            currency: "USD",
            as_of_date: baseDate("2025-01-05"),
            is_active: true,
          },
        ],
      }),
      buildBank({
        id: "bank-3",
        institution_name: "Chase",
        institution_logo_url: "logo-chase",
        status: "connected",
        balances: [
          {
            id: "balance-3",
            connected_bank_id: "bank-3",
            account_name: "Chase Checking",
            account_type: "checking",
            account_mask: "9999",
            current_balance: 200,
            available_balance: 180,
            currency: "USD",
            as_of_date: baseDate("2025-01-03"),
            is_active: true,
          },
        ],
      }),
    ];

    const grouped = groupBanks(banks);
    expect(grouped).toHaveLength(2);

    const mercury = grouped.find((b) => b.institution_name === "Mercury")!;
    expect(mercury.status).toBe("error"); // higher priority than connected
    expect(mercury.institution_logo_url).toBe("logo-1"); // first non-null preserved
    expect(mercury.bankIds).toEqual(["bank-1", "bank-2"]);
    expect(mercury.balances).toHaveLength(2);
    expect(mercury.connected_at).toBe(baseDate("2025-01-01")); // earliest connection kept
    expect(mercury.last_sync_at).toBe(baseDate("2025-01-06")); // latest sync kept
    expect(mercury.sync_error).toBe("Oops");

    const chase = grouped.find((b) => b.institution_name === "Chase")!;
    expect(chase.bankIds).toEqual(["bank-3"]);
    expect(chase.balances[0].account_name).toBe("Chase Checking");
  });
});

describe("financialConnections totals", () => {
  it("computes total balance across all banks", () => {
    const banks: ConnectedBank[] = [
      buildBank({
        id: "bank-1",
        balances: [
          { ...buildBank({}).balances[0], id: "b1", current_balance: 100 },
          { ...buildBank({}).balances[0], id: "b2", current_balance: 50 },
        ],
      }),
      buildBank({
        id: "bank-2",
        institution_name: "Chase",
        balances: [{ ...buildBank({}).balances[0], id: "b3", current_balance: 25 }],
      }),
    ];

    expect(totalBalance(banks)).toBe(175);
  });

  it("counts accounts across all banks", () => {
    const banks: ConnectedBank[] = [
      buildBank({ balances: [buildBank({}).balances[0], { ...buildBank({}).balances[0], id: "extra" }] }),
      buildBank({ id: "bank-2", institution_name: "Chase", balances: [buildBank({}).balances[0]] }),
    ];

    expect(accountCount(banks)).toBe(3);
  });
});
