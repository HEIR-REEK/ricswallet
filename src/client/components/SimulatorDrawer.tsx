import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Blocks,
  Clock,
  FlaskConical,
  Play,
  Repeat,
  RotateCcw,
  Send,
  X,
  Zap,
} from 'lucide-react';
import { DepositInvoiceDTO, IndexerHealthDTO } from '../../shared/types.js';
import { api } from '../api.js';

interface SimulatorDrawerProps {
  isOpen: boolean;
  activeInvoice: DepositInvoiceDTO | null;
  indexer: IndexerHealthDTO | null;
  onClose: () => void;
  onAfterAction: () => Promise<void>;
}

export const SimulatorDrawer: React.FC<SimulatorDrawerProps> = ({
  isOpen,
  activeInvoice,
  indexer,
  onClose,
  onAfterAction,
}) => {
  const [targetAddress, setTargetAddress] = useState('');
  const [customAmount, setCustomAmount] = useState('25.00');
  const [lastTxHash, setLastTxHash] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [logBanner, setLogBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (activeInvoice?.address) {
      setTargetAddress(activeInvoice.address);
    }
  }, [activeInvoice?.address]);

  if (!isOpen) return null;

  const runAction = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setLogBanner(null);
    try {
      const msg = await fn();
      setLogBanner({ type: 'ok', text: msg });
      await onAfterAction();
    } catch (err) {
      setLogBanner({
        type: 'err',
        text: err instanceof Error ? err.message : `${label} failed`,
      });
    } finally {
      setBusy(false);
    }
  };

  const ensureAddress = (): string => {
    const addr = targetAddress.trim();
    if (!addr) {
      throw new Error(
        'Open the Deposit USDT modal first so an assigned 0x deposit address is ready.'
      );
    }
    return addr;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[2px]">
      <div className="w-full max-w-md bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <FlaskConical className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold">BSC On-Chain Test Lab</h3>
              <p className="text-[11px] text-slate-400">
                Simulate real ABI-encoded BEP-20 Transfer events
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {logBanner && (
            <div
              className={`p-3 rounded-xl border font-medium leading-relaxed ${
                logBanner.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {logBanner.text}
            </div>
          )}

          {/* Block & Auto-Mine Controls */}
          <div className="rounded-2xl bg-[#F8F9FC] border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block">
                  Simulated BSC Block #{indexer?.chainHeadBlock.toLocaleString() ?? '—'}
                </span>
                <span className="text-[11px] text-slate-500">
                  Finality threshold: {indexer?.requiredConfirmations ?? 15} confirmations
                </span>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction('Toggle auto-mine', async () => {
                    const next = !(indexer?.autoMineEnabled ?? true);
                    await api.setAutoMine(next);
                    return next
                      ? 'Auto-mine enabled (1 block / 1.2s while confirming).'
                      : 'Auto-mine paused — advance blocks manually below.';
                  })
                }
                className={`px-2.5 py-1 rounded-lg font-semibold border cursor-pointer ${
                  indexer?.autoMineEnabled
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-200 border-slate-300 text-slate-700'
                }`}
              >
                {indexer?.autoMineEnabled ? 'Auto-Mine: ON' : 'Auto-Mine: PAUSED'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[1, 5, 15].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Mine +${n}`, async () => {
                      const res = await api.mineBlocks(n);
                      return `Mined +${n} BSC block(s) → Head #${res.indexer.chainHeadBlock}.`;
                    })
                  }
                  className="py-2 px-3 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 font-semibold text-slate-800 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Blocks className="w-3.5 h-3.5 text-indigo-600" />+{n} Block{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Target Deposit Address & Custom Transfer */}
          <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
            <label className="block">
              <span className="font-bold text-slate-700 block mb-1">
                Recipient BEP-20 Deposit Address
              </span>
              <input
                type="text"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                placeholder="0x... (assigned by Deposit Modal)"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs"
              />
            </label>

            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="font-bold text-slate-700 block mb-1">Amount (USDT)</span>
                <input
                  type="text"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs font-semibold"
                />
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction('Send USDT', async () => {
                    const addr = ensureAddress();
                    const res = await api.simulateSendTransfer({
                      toAddress: addr,
                      amountUsdt: customAmount,
                    });
                    setLastTxHash(res.transfer.txHash);
                    return `Broadcast ${res.transfer.amountFormatted} USDT → ${res.transfer.txHash.slice(0, 12)}… (1/${indexer?.requiredConfirmations ?? 15} confs).`;
                  })
                }
                className="px-4 py-2 rounded-xl bg-[#5854D8] hover:bg-[#4945C8] text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                Send On-Chain
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runAction('Instant confirmed send', async () => {
                  const addr = ensureAddress();
                  const res = await api.simulateSendTransfer({
                    toAddress: addr,
                    amountUsdt: customAmount,
                    advanceBlocks: 15,
                  });
                  setLastTxHash(res.transfer.txHash);
                  return `Sent & finalized ${res.transfer.amountFormatted} USDT (+15 confirmations) — ledger credited!`;
                })
              }
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" />
              Send {customAmount} USDT + Instant 15 Confirmations
            </button>
          </div>

          {/* Step 10 Edge-Case Scenarios from the PDF */}
          <div className="space-y-2.5">
            <h4 className="font-bold uppercase tracking-wider text-[11px] text-slate-400">
              Step 10 Verification Scenarios (Build Guide p. 7)
            </h4>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runAction('Underpayment test', async () => {
                  const addr = ensureAddress();
                  const res = await api.simulateSendTransfer({
                    toAddress: addr,
                    amountUsdt: '1.50',
                    advanceBlocks: 15,
                  });
                  setLastTxHash(res.transfer.txHash);
                  return 'Sent 1.50 USDT (< 3.00 USDT minimum). Held safely until cumulative total reaches 3.00 USDT!';
                })
              }
              className="w-full p-3 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-left flex items-start gap-2.5 cursor-pointer"
            >
              <Play className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-950">
                  1. Underpayment (&lt; 3 USDT Minimum): Send 1.50 USDT
                </div>
                <div className="text-[11px] text-amber-800">
                  Holds in review; send another 2.00 USDT to reach 3.50 USDT and auto-credit both!
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runAction('Fake token test', async () => {
                  const addr = ensureAddress();
                  await api.simulateSendTransfer({
                    toAddress: addr,
                    amountUsdt: '500.00',
                    tokenContract: '0x1111111111111111111111111111111111111111',
                    advanceBlocks: 15,
                  });
                  return 'Broadcast 500 FAKE "USDT" from spoofed contract 0x1111…1111 → Rejected by contract validator (0.00 credited)!';
                })
              }
              className="w-full p-3 rounded-xl bg-rose-50 hover:bg-rose-100/80 border border-rose-200 text-left flex items-start gap-2.5 cursor-pointer"
            >
              <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-950">
                  2. Spoofed Token Contract: Send Fake &ldquo;USDT&rdquo;
                </div>
                <div className="text-[11px] text-rose-800">
                  Tests contract-address check against official 0x55d398…7955. Never credits ledger.
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy || !lastTxHash}
              onClick={() =>
                runAction('Duplicate replay test', async () => {
                  const addr = ensureAddress();
                  await api.simulateSendTransfer({
                    toAddress: addr,
                    amountUsdt: customAmount,
                    txHash: lastTxHash,
                    logIndex: 0,
                  });
                  return `Replayed duplicate event (${lastTxHash.slice(0, 12)}…, log 0) → Idempotency guard blocked double-credit!`;
                })
              }
              className="w-full p-3 rounded-xl bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200 text-left flex items-start gap-2.5 cursor-pointer disabled:opacity-45"
            >
              <Repeat className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-indigo-950">
                  3. Replay Duplicate Event (Idempotency Check)
                </div>
                <div className="text-[11px] text-indigo-800">
                  Re-submits the exact same (tx_hash, log_index) to verify single-credit guarantee.
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy || !activeInvoice}
              onClick={() =>
                runAction('Expire invoice', async () => {
                  if (!activeInvoice) throw new Error('No active invoice.');
                  await api.expireInvoiceNow(activeInvoice.id);
                  return `Expired invoice ${activeInvoice.id}. Now send USDT above to test Late Deposit reconciliation!`;
                })
              }
              className="w-full p-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-left flex items-start gap-2.5 cursor-pointer disabled:opacity-45"
            >
              <Clock className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-slate-900">
                  4. Force-Expire Active Invoice (Late Deposit Test)
                </div>
                <div className="text-[11px] text-slate-600">
                  Expires current request so a subsequent transfer triggers the Late Deposit queue.
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy || !lastTxHash}
              onClick={() =>
                runAction('Chain reorg test', async () => {
                  await api.simulateReorg(lastTxHash);
                  return `Simulated BSC block reorganization on unfinalized tx ${lastTxHash.slice(0, 12)}… — rolled back cleanly!`;
                })
              }
              className="w-full p-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-left flex items-start gap-2.5 cursor-pointer disabled:opacity-45"
            >
              <RotateCcw className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-slate-900">
                  5. Simulate Chain Reorganization (Before 15 Confs)
                </div>
                <div className="text-[11px] text-slate-600">
                  Pause Auto-Mine, send a transfer, then click here to roll back the unfinalized tx.
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
