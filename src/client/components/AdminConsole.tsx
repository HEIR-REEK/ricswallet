import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { AdminOverviewDTO, ChainTransferDTO, DepositInvoiceDTO } from '../../shared/types.js';
import { api } from '../api.js';

export const AdminConsole: React.FC<{ onDataChanged: () => Promise<void> }> = ({
  onDataChanged,
}) => {
  const [overview, setOverview] = useState<AdminOverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    invoices: Array<DepositInvoiceDTO & { userEmail: string; userName: string }>;
    transfers: ChainTransferDTO[];
  } | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminOverview();
      setOverview(data);
    } catch (err) {
      setActionMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load admin overview.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const res = await api.adminSearch(searchQuery);
    setSearchResults({ invoices: res.invoices, transfers: res.transfers });
  };

  const handleReconcile = async () => {
    const res = await api.runReconciliation();
    if (overview) {
      setOverview({ ...overview, reconciliation: res.reconciliation });
    }
    setActionMessage({
      type: res.reconciliation.allMatched ? 'ok' : 'err',
      text: res.reconciliation.allMatched
        ? `Ledger reconciliation passed across ${res.reconciliation.usersChecked} accounts (${res.reconciliation.totalSystemLiabilityFormatted} USDT total liability).`
        : `Reconciliation detected ${res.reconciliation.mismatches.length} mismatch(es)!`,
    });
  };

  const handleResolve = async (transferId: string, action: 'approve_credit' | 'reject') => {
    setResolvingId(transferId);
    setActionMessage(null);
    try {
      await api.resolveReviewTransfer(
        transferId,
        action,
        action === 'approve_credit'
          ? 'Verified & credited via Admin Operations Console'
          : 'Rejected during Admin Operations review'
      );
      setActionMessage({
        type: 'ok',
        text:
          action === 'approve_credit'
            ? 'Transfer approved and atomically credited to user ledger.'
            : 'Transfer marked rejected.',
      });
      await loadOverview();
      await onDataChanged();
    } catch (err) {
      setActionMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not resolve transfer.',
      });
    } finally {
      setResolvingId(null);
    }
  };

  if (loading && !overview) {
    return (
      <div className="rounded-3xl bg-white border border-slate-200 p-12 text-center text-sm text-slate-500">
        Loading Admin & Indexer Monitoring Console…
      </div>
    );
  }

  if (!overview) return null;

  const { indexer, reconciliation, reviewQueue, recentTransfers } = overview;

  return (
    <div className="space-y-6">
      {/* Header + End-to-End Trace Search */}
      <div className="rounded-3xl bg-white border border-slate-200/85 p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
              Step 9 • Operations & Support Traceability
            </span>
            <h2 className="text-xl font-bold text-slate-900">
              Admin Monitoring & Reconciliation Console
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleReconcile}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              Run Ledger Reconciliation
            </button>
            <button
              type="button"
              onClick={loadOverview}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              title="Refresh monitoring metrics"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {actionMessage && (
          <div
            className={`mb-4 rounded-xl px-4 py-3 text-xs font-semibold border ${
              actionMessage.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Search by user email, invoice ID, deposit address, or tx_hash */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Trace by user email, invoice ID (inv_…), deposit 0x address, or tx hash (0x…)"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#F8F9FC] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
          >
            Trace Transfer
          </button>
          {searchResults && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchResults(null);
              }}
              className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
            >
              Clear
            </button>
          )}
        </form>

        {/* Trace Search Results */}
        {searchResults && (
          <div className="mt-5 pt-5 border-t border-slate-200 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Trace Results ({searchResults.invoices.length} invoices,{' '}
              {searchResults.transfers.length} chain transfers)
            </h4>
            {searchResults.invoices.map((inv) => (
              <div
                key={inv.id}
                className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <span className="font-bold text-slate-900">{inv.id}</span> •{' '}
                  <span className="text-slate-600">{inv.userEmail}</span> •{' '}
                  <span className="font-mono text-slate-700">{inv.address}</span>
                </div>
                <div className="font-semibold">
                  Status: <span className="uppercase">{inv.status}</span> (Credited:{' '}
                  {inv.creditedAmountFormatted} USDT)
                </div>
              </div>
            ))}
            {searchResults.transfers.map((tr) => (
              <div
                key={tr.id}
                className="p-3.5 rounded-2xl bg-indigo-50/50 border border-indigo-200/70 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <span className="font-bold text-indigo-950">{tr.amountFormatted} USDT</span> →{' '}
                  <span className="font-mono">{tr.toAddress}</span>
                  <div className="font-mono text-[11px] text-slate-500">Tx: {tr.txHash}</div>
                </div>
                <div className="font-semibold text-indigo-900">
                  {tr.status.toUpperCase()} ({tr.confirmations} confs) •{' '}
                  {tr.validationCode || 'OK'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Health & Reconciliation Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200/85 p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>BSC Indexer Status</span>
            <Activity className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 uppercase">
            {indexer.rpcStatus} ({indexer.mode})
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            Cursor #{indexer.lastProcessedBlock.toLocaleString()} (Lag: {indexer.blockLag})
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200/85 p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Ledger Reconciliation</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg font-extrabold text-emerald-700">
            {reconciliation.allMatched ? '100% Matched' : 'Discrepancy Alert'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {reconciliation.usersChecked} users • {reconciliation.totalLedgerEntries} entries
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200/85 p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Total Custodied Liability</span>
            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 tabular-nums">
            {reconciliation.totalSystemLiabilityFormatted} USDT
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Backed by verified BEP-20 events</div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200/85 p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Support Review Queue</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 tabular-nums">
            {reviewQueue.length} Flagged
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Late deposits, sub-min, or wrong token
          </div>
        </div>
      </div>

      {/* Review Queue (Late Deposits / Sub-minimum / Wrong Token Exceptions) */}
      <div className="rounded-3xl bg-white border border-slate-200/85 p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-1">
          Exception & Support Review Queue ({reviewQueue.length})
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Late deposits on expired invoices or sub-minimum holds can be approved once confirmed.
          Fake token contracts and wrong networks are blocked from crediting by protocol guardrails.
        </p>

        {reviewQueue.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-6 text-center text-xs text-slate-500">
            Zero transfers awaiting support review.
          </div>
        ) : (
          <div className="space-y-3">
            {reviewQueue.map((tr) => {
              const canApprove =
                tr.validationCode !== 'WRONG_TOKEN_CONTRACT' &&
                tr.validationCode !== 'WRONG_NETWORK' &&
                tr.confirmations >= indexer.requiredConfirmations;

              return (
                <div
                  key={tr.id}
                  className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {tr.amountFormatted} USDT
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-950 text-[11px] font-mono font-bold">
                        {tr.validationCode}
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        {tr.confirmations}/{indexer.requiredConfirmations} confirmations
                      </span>
                    </div>
                    <p className="text-xs text-slate-700">{tr.validationMessage}</p>
                    <div className="text-[11px] font-mono text-slate-500">
                      To: {tr.toAddress} • Tx: {tr.txHash.slice(0, 14)}…
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canApprove && (
                      <button
                        type="button"
                        disabled={resolvingId === tr.id}
                        onClick={() => handleResolve(tr.id, 'approve_credit')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        Approve & Credit Ledger
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={resolvingId === tr.id}
                      onClick={() => handleResolve(tr.id, 'reject')}
                      className="px-3.5 py-2 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Chain Transfers Feed */}
      <div className="rounded-3xl bg-white border border-slate-200/85 p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-4">
          Observed On-Chain Events ({recentTransfers.length})
        </h3>
        {recentTransfers.length === 0 ? (
          <p className="text-xs text-slate-500">No chain transfers observed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[11px]">
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Recipient Address</th>
                  <th className="py-2.5 px-3">Block / Confs</th>
                  <th className="py-2.5 px-3">Validation</th>
                  <th className="py-2.5 pl-3 text-right">Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentTransfers.map((tr) => (
                  <tr key={tr.id}>
                    <td className="py-3 pr-3 font-bold uppercase">{tr.status}</td>
                    <td className="py-3 px-3 font-bold tabular-nums">{tr.amountFormatted} USDT</td>
                    <td className="py-3 px-3 font-mono text-slate-600">
                      {tr.toAddress.slice(0, 10)}…{tr.toAddress.slice(-6)}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums">
                      #{tr.blockNumber} ({tr.confirmations})
                    </td>
                    <td className="py-3 px-3 text-slate-600">{tr.validationCode || 'OK'}</td>
                    <td className="py-3 pl-3 text-right font-mono">
                      <a
                        href={tr.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                      >
                        {tr.txHash.slice(0, 10)}…
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
