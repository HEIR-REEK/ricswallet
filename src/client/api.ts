import {
  AdminOverviewDTO,
  ChainTransferDTO,
  DepositInvoiceDTO,
  IndexerHealthDTO,
  LedgerEntryDTO,
  ReconciliationReportDTO,
  UserProfile,
  WalletBalanceSummary,
} from '../shared/types.js';

export interface PublicSystemConfig {
  asset: string;
  networkKey: string;
  networkLabel: string;
  chainId: number;
  explorerUrl: string;
  usdtTokenContract: string;
  usdtDecimals: number;
  minDepositFormatted: string;
  minDepositRaw: string;
  requiredConfirmations: number;
  invoiceExpiryMinutes: number;
  lateDepositPolicy: 'review' | 'auto_credit';
  simulatorEnabled: boolean;
  demoAuthEnabled: boolean;
  isLiveChain: boolean;
  isDefaultDemoXpub: boolean;
  dbDialect: 'sqlite' | 'postgres';
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: UserProfile | null;
  balance: WalletBalanceSummary | null;
  system: PublicSystemConfig;
  demoAccounts: UserProfile[];
}

export interface WalletSummaryResponse {
  balance: WalletBalanceSummary;
  activeInvoice: DepositInvoiceDTO | null;
  invoices: DepositInvoiceDTO[];
  ledger: LedgerEntryDTO[];
  indexer: IndexerHealthDTO;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getMe: () => apiFetch<AuthMeResponse>('/api/auth/me'),

  demoLogin: (email?: string) =>
    apiFetch<{
      authenticated: boolean;
      user: UserProfile;
      balance: WalletBalanceSummary;
      system: PublicSystemConfig;
    }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  login: (email: string, password: string) =>
    apiFetch<{
      authenticated: boolean;
      user: UserProfile;
      balance: WalletBalanceSummary;
      system: PublicSystemConfig;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string) =>
    apiFetch<{
      authenticated: boolean;
      user: UserProfile;
      balance: WalletBalanceSummary;
      system: PublicSystemConfig;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getWalletSummary: () => apiFetch<WalletSummaryResponse>('/api/deposits/summary'),

  createOrGetInvoice: (params: { expectedAmountUsdt?: string; forceNew?: boolean } = {}) =>
    apiFetch<{ invoice: DepositInvoiceDTO; balance: WalletBalanceSummary }>(
      '/api/deposits/invoices',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    ),

  getInvoice: (invoiceId: string) =>
    apiFetch<{
      invoice: DepositInvoiceDTO;
      balance: WalletBalanceSummary;
      indexer: IndexerHealthDTO;
    }>(`/api/deposits/invoices/${encodeURIComponent(invoiceId)}`),

  cancelInvoice: (invoiceId: string) =>
    apiFetch<{ invoice: DepositInvoiceDTO }>(
      `/api/deposits/invoices/${encodeURIComponent(invoiceId)}/cancel`,
      { method: 'POST' }
    ),

  getLedger: () =>
    apiFetch<{ balance: WalletBalanceSummary; entries: LedgerEntryDTO[] }>('/api/deposits/ledger'),

  // Simulator / Devnet Test Lab
  simulateSendTransfer: (params: {
    toAddress: string;
    amountUsdt: string;
    fromAddress?: string;
    tokenContract?: string;
    chainId?: number;
    txHash?: string;
    logIndex?: number;
    advanceBlocks?: number;
  }) =>
    apiFetch<{
      transfer: ChainTransferDTO;
      indexer: IndexerHealthDTO;
      balance: WalletBalanceSummary;
    }>('/api/simulator/send-transfer', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  mineBlocks: (blocks: number) =>
    apiFetch<{ indexer: IndexerHealthDTO; balance: WalletBalanceSummary }>(
      '/api/simulator/mine-blocks',
      {
        method: 'POST',
        body: JSON.stringify({ blocks }),
      }
    ),

  simulateReorg: (txHash: string) =>
    apiFetch<{ transfer: ChainTransferDTO; indexer: IndexerHealthDTO }>('/api/simulator/reorg', {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }),

  expireInvoiceNow: (invoiceId: string) =>
    apiFetch<{ invoice: DepositInvoiceDTO }>('/api/simulator/expire-invoice', {
      method: 'POST',
      body: JSON.stringify({ invoiceId }),
    }),

  setAutoMine: (enabled: boolean) =>
    apiFetch<{ indexer: IndexerHealthDTO }>('/api/simulator/auto-mine', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  // Admin & Monitoring
  getAdminOverview: () => apiFetch<AdminOverviewDTO>('/api/admin/overview'),

  adminSearch: (q: string) =>
    apiFetch<{
      query: string;
      invoices: Array<DepositInvoiceDTO & { userEmail: string; userName: string }>;
      transfers: ChainTransferDTO[];
    }>(`/api/admin/search?q=${encodeURIComponent(q)}`),

  runReconciliation: () =>
    apiFetch<{ reconciliation: ReconciliationReportDTO }>('/api/admin/reconcile', {
      method: 'POST',
    }),

  resolveReviewTransfer: (id: string, action: 'approve_credit' | 'reject', note: string) =>
    apiFetch<{ transfer: ChainTransferDTO; reconciliation: ReconciliationReportDTO }>(
      `/api/admin/transfers/${encodeURIComponent(id)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      }
    ),
};

/**
 * Reliable clipboard copy helper that works both in top-level windows
 * and inside sandboxed preview iframes.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to textarea fallback when iframe permissions block Clipboard API
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
