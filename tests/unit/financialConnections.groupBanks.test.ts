import { describe, expect, it } from "vitest";
import {
  groupBanks,
  totalBalance,
  quarantinedBalance,
  type ConnectedBank,
} from "@/utils/financialConnections";

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
  account_mask: "1234",
  deactivated_at: null,
  data_current_through: baseDate("2025-01-02"),
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
    } as ConnectedBank["balances"][number],
  ],
  ...overrides,
});

describe("groupBanks — per-account status", () => {
  it("stamps bankStatus and dataCurrentThrough onto every balance as it merges", () => {
    const banks: ConnectedBank[] = [
      buildBank({
        id: "bank-1",
        status: "connected",
        data_current_through: baseDate("2025-01-10"),
      }),
      buildBank({
        id: "bank-2",
        status: "requires_reauth",
        data_current_through: baseDate("2025-01-05"),
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
          } as ConnectedBank["balances"][number],
        ],
      }),
    ];

    const [mercury] = groupBanks(banks);
    const balance1 = mercury.balances.find((b) => b.connected_bank_id === "bank-1")!;
    const balance2 = mercury.balances.find((b) => b.connected_bank_id === "bank-2")!;

    expect(balance1.bankStatus).toBe("connected");
    expect(balance1.dataCurrentThrough).toBe(baseDate("2025-01-10"));
    expect(balance2.bankStatus).toBe("requires_reauth");
    expect(balance2.dataCurrentThrough).toBe(baseDate("2025-01-05"));
  });

  it("partitions bankIds into reauthBankIds / healthyBankIds when 1 of 3 accounts is quarantined", () => {
    const banks: ConnectedBank[] = [
      buildBank({ id: "bank-1", status: "connected" }),
      buildBank({ id: "bank-2", status: "connected" }),
      buildBank({ id: "bank-3", status: "requires_reauth" }),
    ];

    const [mercury] = groupBanks(banks);

    expect(mercury.bankIds).toHaveLength(3);
    expect(mercury.reauthBankIds).toEqual(["bank-3"]);
    expect(mercury.healthyBankIds).toEqual(["bank-1", "bank-2"]);
  });

  it("treats an `error` account as needing reauth too — healthyBankIds is the strict complement", () => {
    const banks: ConnectedBank[] = [
      buildBank({ id: "bank-1", status: "connected" }),
      buildBank({ id: "bank-2", status: "error" }),
    ];

    const [mercury] = groupBanks(banks);

    expect(mercury.reauthBankIds).toEqual(["bank-2"]);
    expect(mercury.healthyBankIds).toEqual(["bank-1"]);
  });

  it("still drives the group headline status via the STATUS_PRIORITY worst-of roll-up", () => {
    const banks: ConnectedBank[] = [
      buildBank({ id: "bank-1", status: "connected" }),
      buildBank({ id: "bank-2", status: "requires_reauth" }),
      buildBank({ id: "bank-3", status: "error" }),
    ];

    const [mercury] = groupBanks(banks);

    // 'error' outranks 'requires_reauth' which outranks 'connected'
    expect(mercury.status).toBe("error");
  });
});

describe("computeTotalBalance / quarantinedBalance", () => {
  it("excludes quarantined accounts from totalBalance and reports them via quarantinedBalance", () => {
    const banks: ConnectedBank[] = [
      buildBank({
        id: "bank-1",
        status: "connected",
        balances: [
          { ...buildBank({}).balances[0], id: "b1", current_balance: 100 },
        ],
      }),
      buildBank({
        id: "bank-2",
        status: "requires_reauth",
        balances: [
          { ...buildBank({}).balances[0], id: "b2", current_balance: 50 },
        ],
      }),
      buildBank({
        id: "bank-3",
        status: "error",
        balances: [
          { ...buildBank({}).balances[0], id: "b3", current_balance: 25 },
        ],
      }),
    ];

    const oldUnfilteredTotal = banks
      .flatMap((bank) => bank.balances || [])
      .reduce((sum, balance) => sum + (Number(balance?.current_balance) || 0), 0);

    expect(totalBalance(banks)).toBe(100);
    expect(quarantinedBalance(banks)).toBe(75);
    expect(totalBalance(banks) + quarantinedBalance(banks)).toBe(oldUnfilteredTotal);
  });
});
