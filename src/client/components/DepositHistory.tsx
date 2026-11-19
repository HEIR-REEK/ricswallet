import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  QrCode,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { DepositInvoiceDTO, InvoiceStatus } from '../../shared/types.js';
import { INVOICE_UI_COPY } from '../../shared/constants.js';
import { copyTextToClipboard } from '../api.js';

interface DepositHistoryProps {
  invoices: DepositInvoiceDTO[];
  onInspectInvoice: (invoice: DepositInvoiceDTO) => void;
  onNewDeposit: () => void;
}

const FILTER_OPTIONS: Array<{ id: 'all' | InvoiceStatus; label: string }> = [
  { id: 'all', label: 'All Requests' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'detected', label: 'Confirming' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'review', label: 'Review / Action' },
  { id: 'expired', label: 'Expired' },
];

export const DepositHistory: React.FC<DepositHistoryProps> = ({
  invoices,
  onInspectInvoice,
  onNewDeposit,
}) => {
  const [filter, setFilter] = useState<'all' | InvoiceStatus>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered =
    filter === 'all' ? invoices : invoices.filter((inv) => inv.status === filter);

  const handleCopyAddress = async (e: React.MouseEvent, id: string, addr: string) => {
    e.stopPropagation();
    const ok = await copyTextToClipboard(addr);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  return (
    <div className="rounded-3xl bg-white border border-slate-200/85 p-6 sm:p-7 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Deposit History</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track pending, confirming, confirmed, expired, and flagged BEP-20 deposit requests
          </p>
        </div>

        <button
          type="button"
          onClick={onNewDeposit}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#5854D8] hover:bg-[#4945C8] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Deposit Request
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-5">
        {FILTER_OPTIONS.map((opt) => {
          const count =
            opt.id === 'all'
              ? invoices.length
              : invoices.filter((i) => i.status === opt.id).length;
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilter(opt.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-600'
              }`}
            >
              {opt.label} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
          No deposit invoices match the selected filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 px-4">Assigned BEP-20 Address</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Confirmations</th>
                <th className="py-3 px-4">Block Explorer</th>
                <th className="py-3 pl-4 text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((inv) => {
                const statusCopy = INVOICE_UI_COPY[inv.status];
                return (
                  <tr
                    key={inv.id}
                    onClick={() => onInspectInvoice(inv)}
                    className="hover:bg-slate-50/90 transition-colors cursor-pointer"
                  >
                    <td className="py-4 pr-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          inv.status === 'confirmed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : inv.status === 'detected'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : inv.status === 'review'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : inv.status === 'waiting'
                                  ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {inv.status === 'confirmed' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {inv.status === 'detected' && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        {inv.status === 'review' && <ShieldAlert className="w-3.5 h-3.5" />}
                        {inv.status === 'waiting' && <Clock className="w-3.5 h-3.5" />}
                        {(inv.status === 'expired' || inv.status === 'cancelled') && (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        {statusCopy.userHeading}
                      </span>
                      {inv.statusReason && inv.status === 'review' && (
                        <p className="text-[11px] text-amber-700 max-w-xs truncate mt-1">
                          {inv.statusReason}
                        </p>
                      )}
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-700">
                          {inv.address.slice(0, 10)}…{inv.address.slice(-8)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleCopyAddress(e, inv.id, inv.address)}
                          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
                          title="Copy full address"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {copiedId === inv.id && (
                          <span className="text-[10px] font-semibold text-emerald-600">Copied</span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">
                        {inv.id} • {inv.derivationPath}
                      </span>
                    </td>

                    <td className="py-4 px-4 whitespace-nowrap font-bold tabular-nums text-slate-900">
                      {inv.status === 'confirmed'
                        ? `+${inv.creditedAmountFormatted} USDT`
                        : BigInt(inv.detectedAmountRaw) > 0n
                          ? `${inv.detectedAmountFormatted} USDT`
                          : '—'}
                    </td>

                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              inv.confirmations >= inv.requiredConfirmations
                                ? 'bg-emerald-500'
                                : 'bg-indigo-500'
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round((inv.confirmations / inv.requiredConfirmations) * 100)
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono text-slate-600 tabular-nums">
                          {Math.min(inv.confirmations, inv.requiredConfirmations)}/
                          {inv.requiredConfirmations}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-4 whitespace-nowrap">
                      {inv.txHash && inv.explorerUrl ? (
                        <a
                          href={inv.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-mono font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                        >
                          {inv.txHash.slice(0, 8)}…{inv.txHash.slice(-6)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <QrCode className="w-3.5 h-3.5" />
                          View QR
                        </span>
                      )}
                    </td>

                    <td className="py-4 pl-4 text-right whitespace-nowrap text-xs text-slate-500 tabular-nums">
                      {new Date(inv.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
