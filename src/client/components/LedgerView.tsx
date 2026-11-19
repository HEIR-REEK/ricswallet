import React from 'react';
import { BookOpenCheck, CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { LedgerEntryDTO, WalletBalanceSummary } from '../../shared/types.js';

interface LedgerViewProps {
  balance: WalletBalanceSummary;
  entries: LedgerEntryDTO[];
}

export const LedgerView: React.FC<LedgerViewProps> = ({ balance, entries }) => {
  // Compute sum of entries directly in BigInt to prove reconciliation right in UI
  let derivedRaw = 0n;
  for (const e of entries) {
    derivedRaw += e.direction === 'credit' ? BigInt(e.amountRaw) : -BigInt(e.amountRaw);
  }
  const matchesCache = derivedRaw === BigInt(balance.availableRaw);

  return (
    <div className="space-y-6">
      {/* Ledger Integrity Summary Card */}
      <div className="rounded-3xl bg-white border border-slate-200/85 p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              Immutable Append-Only Accounting Ledger
            </div>
            <h2 className="text-xl font-bold text-slate-900">Account Statement & Balance Proof</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Balances are never modified without an atomic, idempotent ledger entry keyed by{' '}
              <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">
                (chain, tx_hash, log_index)
              </code>
              . Duplicate blockchain events cannot credit twice.
            </p>
          </div>

          <div className="rounded-2xl bg-[#F8F9FC] border border-slate-200/80 px-5 py-4 text-right shrink-0">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Reconciled Available Balance
            </span>
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {balance.availableFormatted} USDT
            </span>
            <div className="flex items-center justify-end gap-1 text-[11px] font-semibold text-emerald-700 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {matchesCache ? 'Matches Σ(Ledger Entries) 100%' : 'Reconciling…'}
            </div>
          </div>
        </div>
      </div>

      {/* Immutable Ledger Entries Table */}
      <div className="rounded-3xl bg-white border border-slate-200/85 p-6 sm:p-7 shadow-xs">
        <div className="flex items-center gap-2 mb-5">
          <BookOpenCheck className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-bold text-slate-900">
            Ledger Entries ({entries.length})
          </h3>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
            No confirmed ledger entries yet. Once an incoming BEP-20 USDT deposit reaches finality,
            its immutable credit record appears here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3 pr-4">Entry ID</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Credit Amount</th>
                  <th className="py-3 px-4">Balance After</th>
                  <th className="py-3 px-4">Idempotency Key / Tx Proof</th>
                  <th className="py-3 pl-4 text-right">Posted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/80">
                    <td className="py-4 pr-4 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                      {entry.id}
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {entry.direction}
                      </span>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap font-bold text-emerald-700 tabular-nums">
                      +{entry.amountFormatted} {entry.asset}
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap font-bold text-slate-900 tabular-nums">
                      {entry.balanceAfterFormatted} {entry.asset}
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-mono text-[11px] text-slate-500 truncate max-w-xs">
                        {entry.idempotencyKey}
                      </div>
                      {entry.txHash && entry.explorerUrl && (
                        <a
                          href={entry.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-600 hover:underline mt-0.5"
                        >
                          BscScan: {entry.txHash.slice(0, 10)}…{entry.txHash.slice(-6)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                    <td className="py-4 pl-4 text-right whitespace-nowrap text-xs text-slate-500 tabular-nums">
                      {new Date(entry.createdAt).toLocaleString()}
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
