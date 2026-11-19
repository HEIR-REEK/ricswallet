import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FlaskConical,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { DepositInvoiceDTO, WalletBalanceSummary } from '../../shared/types.js';
import { INVOICE_UI_COPY } from '../../shared/constants.js';
import { copyTextToClipboard } from '../api.js';
import { BscChainIcon, TetherIcon } from './TetherIcon.js';

interface DepositModalProps {
  isOpen: boolean;
  invoice: DepositInvoiceDTO | null;
  balance: WalletBalanceSummary | null;
  loadingInvoice: boolean;
  invoiceError: string | null;
  simulatorEnabled: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onCreateNewInvoice: () => Promise<void>;
  onCancelInvoice: (invoiceId: string) => Promise<void>;
  onQuickSimulateDeposit: (address: string, amountUsdt: string) => Promise<void>;
  onFastForwardBlocks: (blocks: number) => Promise<void>;
  onOpenTestLab: () => void;
  onViewHistory: () => void;
}

function formatRemainingTime(expiresAtIso: string): { text: string; isExpired: boolean } {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) {
    return { text: 'Expired', isExpired: true };
  }
  const totalSecs = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return {
    text: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    isExpired: false,
  };
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  invoice,
  balance,
  loadingInvoice,
  invoiceError,
  simulatorEnabled,
  onClose,
  onRefresh,
  onCreateNewInvoice,
  onCancelInvoice,
  onQuickSimulateDeposit,
  onFastForwardBlocks,
  onOpenTestLab,
  onViewHistory,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [countdown, setCountdown] = useState<{ text: string; isExpired: boolean }>({
    text: '--:--',
    isExpired: false,
  });

  // Encode the EXACT checksummed deposit address into the QR code (Step 4 & DoD #2)
  useEffect(() => {
    let cancelled = false;
    if (!invoice?.address) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(invoice.address, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 224,
      color: {
        dark: '#1D2340',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [invoice?.address]);

  // Live expiry countdown ticker
  useEffect(() => {
    if (!isOpen || !invoice) return;
    const update = () => setCountdown(formatRemainingTime(invoice.expiresAt));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isOpen, invoice?.expiresAt, invoice]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!invoice?.address) return;
    const ok = await copyTextToClipboard(invoice.address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 350);
    }
  };

  const handleQuickSim = async (amount: string) => {
    if (!invoice?.address) return;
    setSimulating(true);
    try {
      await onQuickSimulateDeposit(invoice.address, amount);
    } finally {
      setSimulating(false);
    }
  };

  const statusMeta = invoice ? INVOICE_UI_COPY[invoice.status] : INVOICE_UI_COPY.waiting;
  const confirmationPct = invoice
    ? Math.min(100, Math.round((invoice.confirmations / invoice.requiredConfirmations) * 100))
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[3px] p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[440px] rounded-[28px] bg-[#FAFBFD] border border-white/80 shadow-[0_24px_70px_-12px_rgba(15,23,42,0.38)] p-5 sm:p-6 my-auto">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <h2
              id="deposit-modal-title"
              className="text-[22px] font-bold tracking-tight text-[#1E2438]"
            >
              Recharge
            </h2>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80">
              Deposit USDT
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleManualRefresh}
              title="Refresh deposit status"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close deposit modal"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Signature Warm Gold Balance Banner (Matches Screenshot & Page 6) */}
        <div className="rounded-2xl bg-gradient-to-r from-[#F4BD49] via-[#EFA934] to-[#E59524] px-4 py-3.5 shadow-[0_6px_18px_-4px_rgba(230,150,35,0.45)] flex items-center justify-between text-white mb-4">
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-white/95">USDT balance</span>
            {balance && BigInt(balance.confirmingRaw) > 0n && (
              <span className="text-[11px] font-medium text-amber-50/95">
                +{balance.confirmingFormatted} USDT confirming…
              </span>
            )}
          </div>
          <span className="text-[19px] font-bold tracking-tight tabular-nums drop-shadow-[0_1px_1px_rgba(0,0,0,0.12)]">
            {balance ? `${balance.availableFormatted} USDT` : '0.00 USDT'}
          </span>
        </div>

        {/* Selected Asset & Prominent Network Row */}
        <div className="flex items-center justify-between gap-2 mb-4 px-0.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <TetherIcon className="w-8 h-8 shrink-0 shadow-xs rounded-full" />
            <span className="text-[16px] font-bold text-[#1E2438]">USDT</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FBF0D9] border border-[#F2DCAD] text-[#8B5E15] text-[12px] font-semibold">
              <BscChainIcon className="w-3.5 h-3.5" />
              BNB Smart Chain (BEP-20)
            </span>
          </div>

          {invoice && invoice.status === 'waiting' && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-lg shrink-0"
              title="Invoice validity countdown"
            >
              <Clock className="w-3 h-3 text-slate-400" />
              {countdown.text}
            </span>
          )}
        </div>

        {invoiceError ? (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-5 text-left mb-4">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-rose-950 mb-1">
                  Deposit Address Allocation Blocked
                </p>
                <p className="text-xs text-rose-800 leading-relaxed">{invoiceError}</p>
              </div>
            </div>
          </div>
        ) : loadingInvoice || !invoice ? (
          <div className="rounded-2xl bg-[#F2F4F9] border border-slate-200/80 p-10 flex flex-col items-center justify-center text-center mb-4">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-700">
              Allocating unique BEP-20 deposit address…
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Derived securely on backend via watch-only HD public key
            </p>
          </div>
        ) : (
          <>
            {/* Inner QR + Address Card */}
            <div className="rounded-2xl bg-[#F2F4F9] border border-slate-200/90 p-4 sm:p-5 flex flex-col items-center text-center mb-3.5">
              {invoice.status === 'expired' || invoice.status === 'cancelled' ? (
                <div className="py-6 px-3 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-200/80 text-slate-600 flex items-center justify-center mb-3">
                    <RotateCcw className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mb-1">
                    {statusMeta.userHeading}
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs mb-4">{statusMeta.description}</p>
                  <button
                    type="button"
                    onClick={onCreateNewInvoice}
                    className="w-full px-5 py-2.5 rounded-xl bg-[#5854D8] hover:bg-[#4B47C9] text-white text-sm font-semibold shadow-sm transition-colors cursor-pointer"
                  >
                    Generate New Deposit Address
                  </button>
                </div>
              ) : (
                <>
                  {/* Crisp Scannable QR Code */}
                  <div className="relative bg-white p-3 rounded-2xl shadow-xs border border-slate-200/70 mb-3.5">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`BNB Smart Chain USDT deposit QR for ${invoice.address}`}
                        className="w-[184px] h-[184px] sm:w-[196px] sm:h-[196px] block select-none"
                      />
                    ) : (
                      <div className="w-[184px] h-[184px] flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Deposit Address Display */}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1">
                    YOUR DEPOSIT ADDRESS
                  </span>

                  <div
                    data-testid="deposit-address-text"
                    className="w-full px-3 py-2 rounded-xl bg-white/90 border border-slate-200/80 font-mono text-[12.5px] sm:text-[13px] font-semibold text-[#1E2438] break-all select-all mb-3.5"
                  >
                    {invoice.address}
                  </div>

                  {/* Primary Royal Indigo Copy Button (Matches Screenshot 3D Button) */}
                  <button
                    type="button"
                    data-testid="copy-address-btn"
                    onClick={handleCopy}
                    className={`w-full py-3 px-4 rounded-xl font-semibold text-[15px] text-white transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      copied
                        ? 'bg-emerald-600 border-b-[3px] border-emerald-800 shadow-sm'
                        : 'bg-gradient-to-b from-[#6663EA] to-[#534FD6] hover:from-[#5D5AE2] hover:to-[#4945C8] border-b-[3px] border-[#3B37B0] active:translate-y-[1px] shadow-[0_6px_16px_-4px_rgba(83,79,214,0.5)]'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 stroke-[2.5]" />
                        Address copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy address
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* Live Status Area (All 5 States from Page 2 & Page 6) */}
            <div
              data-testid="deposit-status-banner"
              className={`rounded-2xl border p-3.5 mb-3.5 transition-colors ${
                invoice.status === 'confirmed'
                  ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                  : invoice.status === 'detected'
                    ? 'bg-indigo-50/90 border-indigo-200 text-indigo-950'
                    : invoice.status === 'review'
                      ? 'bg-amber-50 border-amber-300 text-amber-950'
                      : 'bg-white border-slate-200/90 text-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  {invoice.status === 'confirmed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : invoice.status === 'detected' ? (
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin shrink-0 mt-0.5" />
                  ) : invoice.status === 'review' ? (
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-soft shrink-0 mt-1.5 ml-1" />
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-bold leading-snug">
                        {statusMeta.userHeading}
                      </span>
                      {invoice.status === 'detected' && (
                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {invoice.confirmations} / {invoice.requiredConfirmations} confirmations
                        </span>
                      )}
                      {invoice.status === 'confirmed' && (
                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          +{invoice.creditedAmountFormatted} USDT credited
                        </span>
                      )}
                    </div>

                    <p className="text-xs opacity-85 mt-0.5 leading-relaxed">
                      {invoice.statusReason || statusMeta.description}
                    </p>

                    {invoice.txHash && invoice.explorerUrl && (
                      <a
                        href={invoice.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-2 mt-1.5"
                      >
                        Tx: {invoice.txHash.slice(0, 10)}…{invoice.txHash.slice(-8)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Confirmation Progress Bar when payment is detected */}
              {invoice.status === 'detected' && (
                <div className="mt-3">
                  <div className="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500 rounded-full"
                      style={{ width: `${Math.max(8, confirmationPct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px]">
                    <span className="text-indigo-700 font-medium">
                      Detected: {invoice.detectedAmountFormatted} USDT
                    </span>
                    {simulatorEnabled && (
                      <button
                        type="button"
                        onClick={() => onFastForwardBlocks(invoice.requiredConfirmations)}
                        className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-950 bg-indigo-100 hover:bg-indigo-200/80 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                      >
                        <Zap className="w-3 h-3" />
                        Fast-forward +15 blocks
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Quick Actions based on state */}
              {invoice.status === 'waiting' && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap text-[11.5px]">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onCreateNewInvoice}
                      className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                    >
                      New address
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancelInvoice(invoice.id)}
                      className="text-rose-500 hover:text-rose-700 font-medium cursor-pointer"
                    >
                      Cancel request
                    </button>
                  </div>

                  {simulatorEnabled && (
                    <button
                      type="button"
                      disabled={simulating}
                      onClick={() => handleQuickSim('25.00')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold transition-colors cursor-pointer disabled:opacity-50"
                      title="Simulate sending 25 USDT on BNB Smart Chain to test the full flow"
                    >
                      <FlaskConical className="w-3.5 h-3.5 text-emerald-600" />
                      {simulating ? 'Sending…' : 'Test: Send 25 USDT'}
                    </button>
                  )}
                </div>
              )}

              {invoice.status === 'confirmed' && (
                <div className="mt-2.5 pt-2.5 border-t border-emerald-200/70 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onViewHistory();
                    }}
                    className="font-semibold text-emerald-800 hover:underline cursor-pointer"
                  >
                    View in Deposit History →
                  </button>
                  <button
                    type="button"
                    onClick={onCreateNewInvoice}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    New Deposit
                  </button>
                </div>
              )}

              {invoice.status === 'review' && (
                <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 flex items-center justify-between gap-2 text-xs">
                  {simulatorEnabled ? (
                    <button
                      type="button"
                      onClick={onOpenTestLab}
                      className="font-semibold text-amber-900 hover:underline cursor-pointer"
                    >
                      Open Test Lab / Send Top-Up →
                    </button>
                  ) : (
                    <span className="text-amber-900 font-medium">
                      Reference ID: {invoice.id}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={onCreateNewInvoice}
                    className="px-2.5 py-1 rounded-lg bg-amber-200/80 hover:bg-amber-300/80 text-amber-950 font-semibold transition-colors cursor-pointer"
                  >
                    Fresh Invoice
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Clear Network Warning & Minimum Guidance Box (Matches Screenshot & Page 6) */}
        <div className="rounded-2xl bg-[#FBF4E6] border border-[#F0DFBE] p-3.5 text-[12px] leading-relaxed text-[#6E501E] space-y-1.5">
          <p className="font-semibold flex items-start gap-1.5 text-[#5C4012]">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Send only <strong>USDT</strong> on <strong>BNB Smart Chain (BEP-20)</strong>. Other
              coins or unsupported networks may not be recoverable.
            </span>
          </p>
          <ul className="space-y-1 pl-5 list-disc marker:text-amber-600/80 text-[11.5px]">
            <li>
              <strong>Minimum deposit: {invoice?.minimumAmountFormatted ?? '3.00'} USDT.</strong>{' '}
              Smaller amounts wait until your cumulative total reaches{' '}
              {invoice?.minimumAmountFormatted ?? '3.00'} USDT.
            </li>
            <li>
              After sending, wait ~45–60 seconds (
              <strong>{invoice?.requiredConfirmations ?? 15} confirmations</strong>). Keep this
              screen open or check{' '}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewHistory();
                }}
                className="underline font-semibold hover:text-[#3E2908] cursor-pointer"
              >
                Deposit History
              </button>{' '}
              to watch confirmation status.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
