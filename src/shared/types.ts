export type InvoiceStatus =
  | 'waiting'
  | 'detected'
  | 'confirmed'
  | 'expired'
  | 'review'
  | 'cancelled';

export type TransferStatus =
  | 'detected'
  | 'confirming'
  | 'confirmed'
  | 'credited'
  | 'review'
  | 'rejected'
  | 'reorged';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface WalletBalanceSummary {
  asset: string;
  availableRaw: string;
  availableFormatted: string;
  confirmingRaw: string;
  confirmingFormatted: string;
  heldInReviewRaw: string;
  heldInReviewFormatted: string;
  totalCreditedCount: number;
}

export interface ChainTransferDTO {
  id: string;
  chain: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  tokenContract: string;
  tokenSymbolHint: string | null;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  amountFormatted: string;
  confirmations: number;
  invoiceId: string | null;
  userId: string | null;
  status: TransferStatus;
  validationCode: string | null;
  validationMessage: string | null;
  ledgerEntryId: string | null;
  creditedAt: string | null;
  observedAt: string;
  explorerUrl: string;
}

export interface DepositInvoiceDTO {
  id: string;
  userId: string;
  address: string;
  derivationIndex: number;
  derivationPath: string;
  asset: string;
  network: string;
  networkLabel: string;
  tokenContract: string;
  decimals: number;
  minimumAmountRaw: string;
  minimumAmountFormatted: string;
  expectedAmountRaw: string | null;
  expectedAmountFormatted: string | null;
  detectedAmountRaw: string;
  detectedAmountFormatted: string;
  creditedAmountRaw: string;
  creditedAmountFormatted: string;
  confirmations: number;
  requiredConfirmations: number;
  txHash: string | null;
  explorerUrl: string | null;
  status: InvoiceStatus;
  statusReason: string | null;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  transfers: ChainTransferDTO[];
}

export interface LedgerEntryDTO {
  id: string;
  userId: string;
  userEmail?: string;
  asset: string;
  direction: 'credit' | 'debit';
  amountRaw: string;
  amountFormatted: string;
  balanceAfterRaw: string;
  balanceAfterFormatted: string;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  invoiceId: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  note: string | null;
  createdAt: string;
}

export interface IndexerHealthDTO {
  chain: string;
  mode: 'rpc' | 'simulator';
  chainId: number;
  networkLabel: string;
  officialUsdtContract: string;
  requiredConfirmations: number;
  minimumDepositFormatted: string;
  lastProcessedBlock: number;
  chainHeadBlock: number;
  blockLag: number;
  rpcStatus: 'healthy' | 'degraded' | 'offline';
  lastHeartbeatAt: string;
  lastError: string | null;
  unmatchedTransfersCount: number;
  reviewQueueCount: number;
  autoMineEnabled: boolean;
}

export interface ReconciliationReportDTO {
  checkedAt: string;
  allMatched: boolean;
  usersChecked: number;
  mismatches: Array<{
    userId: string;
    email: string;
    cachedBalanceRaw: string;
    ledgerSumRaw: string;
    differenceRaw: string;
  }>;
  totalSystemLiabilityRaw: string;
  totalSystemLiabilityFormatted: string;
  totalLedgerEntries: number;
}

export interface AdminOverviewDTO {
  indexer: IndexerHealthDTO;
  reconciliation: ReconciliationReportDTO;
  recentTransfers: ChainTransferDTO[];
  reviewQueue: ChainTransferDTO[];
  recentInvoices: Array<DepositInvoiceDTO & { userEmail: string; userName: string }>;
  recentLedger: LedgerEntryDTO[];
}
