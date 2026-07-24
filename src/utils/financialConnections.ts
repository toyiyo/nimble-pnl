export type BankStatus = 'connected' | 'disconnected' | 'error' | 'requires_reauth';

export interface BankBalance {
  id: string;
  connected_bank_id?: string | null;
  account_name: string;
  account_type: string | null;
  account_mask: string | null;
  current_balance: number;
  available_balance: number | null;
  currency: string;
  as_of_date: string;
  is_active: boolean;
  bankStatus: BankStatus;          // NEW — inherited from the owning connected_banks row
  dataCurrentThrough: string | null; // NEW — the owning row's data_current_through
}

export interface ConnectedBank {
  id: string;
  stripe_financial_account_id: string;
  institution_name: string;
  institution_logo_url: string | null;
  status: BankStatus;
  connected_at: string;
  disconnected_at: string | null;
  last_sync_at: string | null;
  sync_error: string | null;
  account_mask: string | null;
  deactivated_at: string | null;
  data_current_through: string | null;
  balances: BankBalance[];
}

export interface GroupedBank {
  id: string;
  institution_name: string;
  institution_logo_url: string | null;
  status: BankStatus;
  connected_at: string;
  last_sync_at: string | null;
  sync_error?: string | null;
  bankIds: string[];
  reauthBankIds: string[];   // NEW — the subset of bankIds needing reauthorization
  healthyBankIds: string[];  // NEW — the complement; drives which controls stay live
  balances: BankBalance[];
}

const STATUS_PRIORITY: BankStatus[] = ['error', 'requires_reauth', 'disconnected', 'connected'];

const pickStatus = (a: BankStatus | undefined, b: BankStatus) => {
  if (!a) return b;
  return STATUS_PRIORITY.indexOf(b) < STATUS_PRIORITY.indexOf(a) ? b : a;
};

// A single connected_banks row is "healthy" only when it is fully usable —
// 'requires_reauth' and 'error' both mean the account's own controls
// (Sync/Refresh) cannot work, so healthyBankIds/reauthBankIds partition on
// this, not on 'requires_reauth' alone.
const isHealthyStatus = (status: BankStatus): boolean => status === 'connected';

export const groupBanks = (connectedBanks: ConnectedBank[]): GroupedBank[] => {
  const map = new Map<string, GroupedBank>();

  connectedBanks.forEach((bank) => {
    const key = bank.institution_name || bank.id;
    const existing = map.get(key);
    const merged: GroupedBank = existing ?? {
      id: key,
      institution_name: bank.institution_name,
      institution_logo_url: bank.institution_logo_url,
      status: bank.status,
      connected_at: bank.connected_at,
      last_sync_at: bank.last_sync_at,
      sync_error: bank.sync_error,
      bankIds: [],
      reauthBankIds: [],
      healthyBankIds: [],
      balances: [],
    };

    merged.institution_logo_url = merged.institution_logo_url || bank.institution_logo_url;
    merged.status = pickStatus(merged.status, bank.status);
    merged.connected_at = merged.connected_at && new Date(merged.connected_at) < new Date(bank.connected_at)
      ? merged.connected_at
      : bank.connected_at;
    merged.last_sync_at = merged.last_sync_at && bank.last_sync_at && new Date(merged.last_sync_at) > new Date(bank.last_sync_at)
      ? merged.last_sync_at
      : bank.last_sync_at || merged.last_sync_at;
    merged.sync_error = merged.sync_error || bank.sync_error;
    merged.bankIds.push(bank.id);
    if (isHealthyStatus(bank.status)) {
      merged.healthyBankIds.push(bank.id);
    } else {
      merged.reauthBankIds.push(bank.id);
    }
    merged.balances = [
      ...merged.balances,
      ...bank.balances.map((bal) => ({
        ...bal,
        connected_bank_id: bal.connected_bank_id || bank.id,
        bankStatus: bank.status,
        dataCurrentThrough: bank.data_current_through,
      })),
    ];

    map.set(key, merged);
  });

  return Array.from(map.values());
};

export const totalBalance = (connectedBanks: ConnectedBank[]): number => {
  return connectedBanks
    .filter((bank) => isHealthyStatus(bank.status))
    .flatMap((bank) => bank.balances || [])
    .reduce((sum, balance) => sum + (Number(balance?.current_balance) || 0), 0);
};

export const quarantinedBalance = (connectedBanks: ConnectedBank[]): number => {
  return connectedBanks
    .filter((bank) => !isHealthyStatus(bank.status))
    .flatMap((bank) => bank.balances || [])
    .reduce((sum, balance) => sum + (Number(balance?.current_balance) || 0), 0);
};

export const accountCount = (connectedBanks: ConnectedBank[]): number => {
  return connectedBanks
    .filter((bank) => isHealthyStatus(bank.status))
    .reduce((sum, bank) => sum + (bank.balances?.length || 0), 0);
};
