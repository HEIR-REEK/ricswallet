import React from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FlaskConical,
  Loader2,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import {
  DepositInvoiceDTO,
  IndexerHealthDTO,
  LedgerEntryDTO,
  WalletBalanceSummary,
} from '../../shared/types.js';
import { INVOICE_UI_COPY } from '../../shared/constants.js';
import { PublicSystemConfig } from '../api.js';
import { BscChainIcon, TetherIcon } from './TetherIcon.js';

interface WalletDashboardProps {
  balance: WalletBalanceSummary;
  activeInvoice: DepositInvoiceDTO | null;
  recentInvoices: DepositInvoiceDTO[];
  recentLedger: LedgerEntryDTO[];
  system: PublicSystemConfig;
  indexer: IndexerHealthDTO | null;
  onOpenDepositModal: (invoice?: DepositInvoiceDTO) => void;
  onNavigateTab: (tab: 'wallet' | 'history' | 'ledger' | 'admin') => void;
  onOpenTestLab: () => void;
}

export const WalletDashboard: React.FC<WalletDashboardProps> = ({
  balance,
  activeInvoice,
  recentInvoices,
  recentLedger,
  system,
  indexer,
  onOpenDepositModal,
  onNavigateTab,
  onOpenTestLab,
}) => {
  const hasConfirming = BigInt(balance.confirmingRaw) > 0n;
  const hasReview = BigInt(balance.heldInReviewRaw) > 0n;

  return (
    <div className="space-y-6">
      {/* Hero Wallet Card ("TOTAL ASSETS" + "Details >" inspired directly by the reference UI) */}
      <div className="rounded-3xl bg-white border border-slate-200/85 shadow-[0_12px_40px_-14px_rgba(15,23,42,0.09)] p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-gradient-to-br from-amber-200/35 via-indigo-200/25 to-emerald-200/20 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center justify-between sm:justify-start gap-4 mb-3">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                TOTAL ASSETS
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('ledger')}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                Details
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <TetherIcon className="w-10 h-10 shadow-xs rounded-full shrink-0" />
                <span
                  data-testid="hero-available-balance"
                  className="text-4xl sm:text-5xl font-extrabold tracking-tight text-[#181F36] tabular-nums"
                >
                  {balance.availableFormatted}
                </span>
              </div>
              <span className="text-lg font-bold text-slate-500">USDT</span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FBF0D9] border border-[#F2DCAD] text-[#8B5E15] text-xs font-semibold">
                <BscChainIcon className="w-3.5 h-3.5" />
                {system.networkLabel}
              </span>
            </div>

            {/* Secondary status pills for confirming / review funds */}
            <div className="flex items-center gap-2.5 flex-wrap mt-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Ledger-verified balance ({balance.totalCreditedCount} confirmed{' '}
                {balance.totalCreditedCount === 1 ? 'deposit' : 'deposits'})
              </span>

              {hasConfirming && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-semibold tabular-nums">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />+
                  {balance.confirmingFormatted} USDT confirming on BSC
                </span>
              )}

              {hasReview && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold tabular-nums">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  {balance.heldInReviewFormatted} USDT awaiting minimum / review
                </span>
              )}
            </div>
          </div>

          {/* Primary Actions: Recharge (Deposit USDT) + Withdraw (Phase 2) */}
          <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button
              type="button"
              data-testid="open-deposit-btn"
              onClick={() => onOpenDepositModal()}
              className="px-6 py-3.5 rounded-2xl bg-gradient-to-b from-[#6663EA] to-[#524FD6] hover:from-[#5B58DF] hover:to-[#4744C6] border-b-[3px] border-[#3A37AE] text-white font-semibold text-[15px] shadow-[0_10px_24px_-6px_rgba(82,79,214,0.55)] flex items-center justify-center gap-2.5 transition-all active:translate-y-[1px] cursor-pointer"
            >
              <ArrowDownLeft className="w-4 h-4 stroke-[2.5]" />
              Recharge / Deposit USDT
            </button>

            <button
              type="button"
              disabled
              title="Withdrawals are scheduled for Phase 2 after Phase 1 deposits are live and tested"
              className="px-5 py-3.5 rounded-2xl bg-slate-100 border border-slate-200 text-slate-400 font-semibold text-sm flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <ArrowUpRight className="w-4 h-4" />
              Withdraw
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200/90 text-slate-500 font-bold">
                Phase 2
              </span>
            </button>
          </div>
        </div>

        {/* Key Network Specifications Strip */}
        <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-2xl bg-[#F8F9FC] border border-slate-200/60 p-3">
            <span className="text-slate-400 font-medium block mb-0.5">Supported Network</span>
            <span className="font-bold text-slate-800">BNB Smart Chain (BEP-20)</span>
          </div>
          <div className="rounded-2xl bg-[#F8F9FC] border border-slate-200/60 p-3">
            <span className="text-slate-400 font-medium block mb-0.5">Minimum Deposit</span>
            <span className="font-bold text-slate-800 tabular-nums">
              {system.minDepositFormatted} USDT
            </span>
          </div>
          <div className="rounded-2xl bg-[#F8F9FC] border border-slate-200/60 p-3">
            <span className="text-slate-400 font-medium block mb-0.5">Confirmation Finality</span>
            <span className="font-bold text-slate-800 tabular-nums">
              {system.requiredConfirmations} BSC Blocks (~45s)
            </span>
          </div>
          <div className="rounded-2xl bg-[#F8F9FC] border border-slate-200/60 p-3">
            <span className="text-slate-400 font-medium block mb-0.5">Official USDT Contract</span>
            <span className="font-mono font-semibold text-slate-700" title={system.usdtTokenContract}>
              {system.usdtTokenContract.slice(0, 8)}…{system.usdtTokenContract.slice(-6)}
            </span>
          </div>
        </div>
      </div>

      {/* Live Active Deposit Invoice Tracker (if waiting or confirming) */}
      {activeInvoice && (
        <div className="rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white p-5 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              {activeInvoice.status === 'detected' ? (
                <Loader2 className="w-5 h-5 text-amber-300 animate-spin" />
              ) : (
                <QrCode className="w-5 h-5 text-emerald-300" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold">
                  {INVOICE_UI_COPY[activeInvoice.status].userHeading}
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/15 text-indigo-100">
                  {activeInvoice.status === 'detected'
                    ? `${activeInvoice.confirmations}/${activeInvoice.requiredConfirmations} confirmations`
                    : `HD #${activeInvoice.derivationIndex}`}
                </span>
              </div>
              <p className="text-xs text-slate-300 font-mono truncate mt-1">
                Assigned BEP-20 Address: {activeInvoice.address}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {system.simulatorEnabled && (
              <button
                type="button"
                onClick={onOpenTestLab}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FlaskConical className="w-3.5 h-3.5 text-amber-300" />
                Simulate Send
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenDepositModal(activeInvoice)}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold transition-colors cursor-pointer"
            >
              Open Deposit QR
            </button>
          </div>
        </div>
      )}

      {/* Two-Column Grid: Recent Deposit Activity + Compatible Wallets & Security */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Deposit Requests & Credits */}
        <div className="lg:col-span-2 rounded-3xl bg-white border border-slate-200/85 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Deposit Activity</h3>
              <p className="text-xs text-slate-500">
                Real-time invoice tracking & confirmed ledger credits
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('history')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 cursor-pointer"
            >
              View all ({recentInvoices.length})
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentInvoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                <QrCode className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold text-slate-800">No deposits yet</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                Click <strong>Recharge / Deposit USDT</strong> to allocate your unique BNB Smart
                Chain (BEP-20) deposit address and QR code.
              </p>
              <button
                type="button"
                onClick={() => onOpenDepositModal()}
                className="px-4 py-2 rounded-xl bg-[#5854D8] hover:bg-[#4B47C8] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Create First Deposit Request
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentInvoices.slice(0, 5).map((inv) => {
                const statusCopy = INVOICE_UI_COPY[inv.status];
                return (
                  <div
                    key={inv.id}
                    onClick={() => onOpenDepositModal(inv)}
                    className="py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/90 -mx-3 px-3 rounded-xl transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          inv.status === 'confirmed'
                            ? 'bg-emerald-50 text-emerald-600'
                            : inv.status === 'detected'
                              ? 'bg-indigo-50 text-indigo-600'
                              : inv.status === 'review'
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {inv.status === 'confirmed' ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : inv.status === 'detected' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <QrCode className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {statusCopy.userHeading}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                            {inv.address.slice(0, 8)}…{inv.address.slice(-6)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          <span>{new Date(inv.createdAt).toLocaleTimeString()}</span>
                          {inv.txHash && inv.explorerUrl && (
                            <a
                              href={inv.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline font-mono"
                            >
                              BscScan
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold tabular-nums text-slate-900">
                        {inv.status === 'confirmed'
                          ? `+${inv.creditedAmountFormatted} USDT`
                          : BigInt(inv.detectedAmountRaw) > 0n
                            ? `${inv.detectedAmountFormatted} USDT`
                            : 'Awaiting'}
                      </div>
                      <div className="text-[11px] font-medium text-slate-400 tabular-nums">
                        {inv.status === 'detected'
                          ? `${inv.confirmations}/${inv.requiredConfirmations} confs`
                          : inv.status.toUpperCase()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {recentLedger.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>
                Latest ledger credit: <strong>+{recentLedger[0].amountFormatted} USDT</strong> (
                <span className="font-mono">{recentLedger[0].id}</span>)
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('ledger')}
                className="font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                Audit Ledger →
              </button>
            </div>
          )}
        </div>

        {/* Sender Wallet Compatibility & Custody Architecture Card (Page 4 of Guide) */}
        <div className="rounded-3xl bg-white border border-slate-200/85 p-6 shadow-xs flex flex-col justify-between space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Compatible With Every BEP-20 Wallet
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              No wallet connection required. Simply scan the QR code or copy your unique BEP-20
              address from any wallet or exchange:
            </p>

            <div className="space-y-2.5">
              <div className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8F9FC] border border-slate-200/70">
                <Smartphone className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-800">Trust Wallet & MetaMask</div>
                  <div className="text-[11px] text-slate-500">
                    Select USDT (BEP-20) → Send → Scan QR or paste your assigned 0x address.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8F9FC] border border-slate-200/70">
                <Wallet className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-800">Binance / CEX Withdrawals</div>
                  <div className="text-[11px] text-slate-500">
                    Withdraw USDT → Choose network <strong>BSC / BNB Smart Chain (BEP20)</strong>.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/70">
                <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-emerald-950">
                    Backend HD Watch-Only Custody
                  </div>
                  <div className="text-[11px] text-emerald-800/90">
                    Addresses derive from a watch-only <code className="font-mono">xpub</code>. Zero
                    private keys in browser or database.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {indexer && (
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Indexer Block #{indexer.chainHeadBlock.toLocaleString()}
              </span>
              {system.simulatorEnabled ? (
                <button
                  type="button"
                  onClick={onOpenTestLab}
                  className="font-semibold text-indigo-600 hover:underline cursor-pointer"
                >
                  Open BSC Test Lab →
                </button>
              ) : (
                <span className="font-semibold text-emerald-700">Live BSC Mainnet</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
