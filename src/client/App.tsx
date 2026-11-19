import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  BookOpen,
  ChevronDown,
  FlaskConical,
  History,
  LogOut,
  Wallet,
} from 'lucide-react';
import {
  DepositInvoiceDTO,
  IndexerHealthDTO,
  LedgerEntryDTO,
  UserProfile,
  WalletBalanceSummary,
} from '../shared/types.js';
import { api, PublicSystemConfig } from './api.js';
import { TetherIcon, BscChainIcon } from './components/TetherIcon.js';
import { WalletDashboard } from './components/WalletDashboard.js';
import { DepositModal } from './components/DepositModal.js';
import { DepositHistory } from './components/DepositHistory.js';
import { LedgerView } from './components/LedgerView.js';
import { AdminConsole } from './components/AdminConsole.js';
import { SimulatorDrawer } from './components/SimulatorDrawer.js';
import { AuthModal } from './components/AuthModal.js';

type ActiveTab = 'wallet' | 'history' | 'ledger' | 'admin';

export const App: React.FC = () => {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<UserProfile[]>([]);
  const [system, setSystem] = useState<PublicSystemConfig | null>(null);

  const [balance, setBalance] = useState<WalletBalanceSummary | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<DepositInvoiceDTO | null>(null);
  const [invoices, setInvoices] = useState<DepositInvoiceDTO[]>([]);
  const [ledger, setLedger] = useState<LedgerEntryDTO[]>([]);
  const [indexer, setIndexer] = useState<IndexerHealthDTO | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('wallet');

  // Deposit Modal State
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [modalInvoiceId, setModalInvoiceId] = useState<string | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  // Drawers & Modals
  const [testLabOpen, setTestLabOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const refreshWalletState = useCallback(async () => {
    try {
      const summary = await api.getWalletSummary();
      setBalance(summary.balance);
      setActiveInvoice(summary.activeInvoice);
      setInvoices(summary.invoices);
      setLedger(summary.ledger);
      setIndexer(summary.indexer);
    } catch {
      // ignore transient network error during background poll
    }
  }, []);

  // Initial boot: load current session or auto-provision demo session on first visit
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await api.getMe();
        if (!mounted) return;
        setDemoAccounts(me.demoAccounts);
        setSystem(me.system);

        if (me.authenticated && me.user) {
          setUser(me.user);
          setBalance(me.balance);
          await refreshWalletState();
        } else if (me.system.demoAuthEnabled) {
          const demo = await api.demoLogin('ric@ricswallet.io');
          if (!mounted) return;
          setUser(demo.user);
          setBalance(demo.balance);
          setSystem(demo.system);
          await refreshWalletState();
        } else {
          setAuthModalOpen(true);
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [refreshWalletState]);

  // Live background sync every 1.5s while authenticated so confirmations & ledger updates appear live
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      void refreshWalletState();
    }, 1500);
    return () => clearInterval(timer);
  }, [user, refreshWalletState]);

  // Resolve which invoice is currently shown inside DepositModal
  const modalInvoice: DepositInvoiceDTO | null = modalInvoiceId
    ? invoices.find((i) => i.id === modalInvoiceId) ?? activeInvoice
    : activeInvoice;

  const handleOpenDepositModal = async (specificInvoice?: DepositInvoiceDTO) => {
    setDepositModalOpen(true);
    setInvoiceError(null);
    if (specificInvoice) {
      setModalInvoiceId(specificInvoice.id);
      return;
    }

    if (activeInvoice) {
      setModalInvoiceId(activeInvoice.id);
      return;
    }

    setLoadingInvoice(true);
    try {
      const res = await api.createOrGetInvoice({ forceNew: false });
      setModalInvoiceId(res.invoice.id);
      setBalance(res.balance);
      await refreshWalletState();
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Failed to create deposit invoice.');
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCreateFreshInvoice = async () => {
    setLoadingInvoice(true);
    setInvoiceError(null);
    try {
      const res = await api.createOrGetInvoice({ forceNew: true });
      setModalInvoiceId(res.invoice.id);
      setBalance(res.balance);
      await refreshWalletState();
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Failed to create deposit invoice.');
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCancelInvoice = async (invoiceId: string) => {
    await api.cancelInvoice(invoiceId);
    await refreshWalletState();
  };

  const handleQuickSimulateDeposit = async (address: string, amountUsdt: string) => {
    await api.simulateSendTransfer({
      toAddress: address,
      amountUsdt,
    });
    await refreshWalletState();
  };

  const handleFastForwardBlocks = async (blocks: number) => {
    await api.mineBlocks(blocks);
    await refreshWalletState();
  };

  const handleDemoSwitch = async (email: string) => {
    const res = await api.demoLogin(email);
    setUser(res.user);
    setBalance(res.balance);
    setModalInvoiceId(null);
    if (res.user.role !== 'admin' && activeTab === 'admin') {
      setActiveTab('wallet');
    }
    const me = await api.getMe();
    setDemoAccounts(me.demoAccounts);
    await refreshWalletState();
  };

  const handleLogin = async (email: string, password: string) => {
    const res = await api.login(email, password);
    setUser(res.user);
    setBalance(res.balance);
    setModalInvoiceId(null);
    const me = await api.getMe();
    setDemoAccounts(me.demoAccounts);
    await refreshWalletState();
  };

  const handleRegister = async (name: string, email: string, password: string) => {
    const res = await api.register(name, email, password);
    setUser(res.user);
    setBalance(res.balance);
    setModalInvoiceId(null);
    const me = await api.getMe();
    setDemoAccounts(me.demoAccounts);
    await refreshWalletState();
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setBalance(null);
    setInvoices([]);
    setLedger([]);
    setActiveInvoice(null);
    setAuthModalOpen(true);
  };

  if (booting || !system) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F5FA]">
        <div className="flex flex-col items-center gap-3">
          <TetherIcon className="w-12 h-12 animate-pulse" />
          <span className="text-sm font-semibold text-slate-600">Loading RicsWallet…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F5FA] text-slate-900">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Brand Logo */}
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#26A17B] to-[#1A7D5E] flex items-center justify-center shadow-xs text-white font-extrabold text-base">
                ₮
              </div>
              <div className="text-left">
                <div className="text-[16px] font-extrabold tracking-tight text-slate-900 leading-none">
                  RicsWallet
                </div>
                <div className="text-[10.5px] font-semibold text-slate-400 flex items-center gap-1 mt-0.5">
                  <BscChainIcon className="w-3 h-3" />
                  BEP-20 Custody
                </div>
              </div>
            </button>

            {/* Primary Navigation Links */}
            {user && (
              <nav className="hidden md:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('wallet')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'wallet'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Wallet className="w-3.5 h-3.5" />
                  Wallet
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'history'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  Deposit History
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('ledger')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === 'ledger'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Ledger
                </button>

                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('admin')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeTab === 'admin'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Admin & Ops
                  </button>
                )}
              </nav>
            )}
          </div>

          {/* Right Controls: BSC Test Lab + Quick Recharge + Account Switcher */}
          <div className="flex items-center gap-2">
            {user && (
              <>
                {system.simulatorEnabled && (
                  <button
                    type="button"
                    onClick={() => setTestLabOpen(true)}
                    className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200/90 text-amber-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Simulate on-chain BEP-20 USDT transfers & confirmations"
                  >
                    <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
                    <span className="hidden sm:inline">BSC Test Lab</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleOpenDepositModal()}
                  className="px-3.5 py-2 rounded-xl bg-[#5854D8] hover:bg-[#4945C8] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Recharge</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="max-w-[110px] truncate">{user.name.split(' ')[0]}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign out"
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer hidden sm:inline-flex"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mobile Tab Strip */}
        {user && (
          <div className="md:hidden border-t border-slate-100 px-4 py-2 flex items-center gap-1.5 overflow-x-auto">
            {(
              [
                { id: 'wallet', label: 'Wallet' },
                { id: 'history', label: 'History' },
                { id: 'ledger', label: 'Ledger' },
                ...(user.role === 'admin' ? [{ id: 'admin', label: 'Admin & Ops' }] : []),
              ] as Array<{ id: ActiveTab; label: string }>
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  activeTab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-7">
        {!user || !balance ? (
          <div className="rounded-3xl bg-white border border-slate-200 p-12 text-center max-w-md mx-auto mt-8 shadow-xs">
            <TetherIcon className="w-12 h-12 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Welcome to RicsWallet</h2>
            <p className="text-xs text-slate-500 mb-5">
              Sign in or choose a demo account to access your unique BEP-20 USDT deposit address.
            </p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-6 py-3 rounded-xl bg-[#5854D8] hover:bg-[#4945C8] text-white text-sm font-semibold cursor-pointer"
            >
              Sign In / Choose Account
            </button>
          </div>
        ) : activeTab === 'wallet' ? (
          <WalletDashboard
            balance={balance}
            activeInvoice={activeInvoice}
            recentInvoices={invoices}
            recentLedger={ledger}
            system={system}
            indexer={indexer}
            onOpenDepositModal={(inv) => void handleOpenDepositModal(inv)}
            onNavigateTab={setActiveTab}
            onOpenTestLab={() => setTestLabOpen(true)}
          />
        ) : activeTab === 'history' ? (
          <DepositHistory
            invoices={invoices}
            onInspectInvoice={(inv) => void handleOpenDepositModal(inv)}
            onNewDeposit={() => void handleOpenDepositModal()}
          />
        ) : activeTab === 'ledger' ? (
          <LedgerView balance={balance} entries={ledger} />
        ) : (
          <AdminConsole onDataChanged={refreshWalletState} />
        )}
      </main>

      {/* Subtle Security & Phase-1 Footer */}
      <footer className="border-t border-slate-200/70 bg-white/60 py-4 px-4 sm:px-6 text-center text-[11.5px] text-slate-400">
        RicsWallet • Phase 1 USDT Deposit System • BNB Smart Chain (BEP-20) • Watch-Only HD Public
        Derivation • Atomic Idempotent Ledger
      </footer>

      {/* Signature Deposit / Recharge Modal */}
      <DepositModal
        isOpen={depositModalOpen}
        invoice={modalInvoice}
        balance={balance}
        loadingInvoice={loadingInvoice}
        invoiceError={invoiceError}
        simulatorEnabled={system.simulatorEnabled}
        onClose={() => setDepositModalOpen(false)}
        onRefresh={refreshWalletState}
        onCreateNewInvoice={handleCreateFreshInvoice}
        onCancelInvoice={handleCancelInvoice}
        onQuickSimulateDeposit={handleQuickSimulateDeposit}
        onFastForwardBlocks={handleFastForwardBlocks}
        onOpenTestLab={() => setTestLabOpen(true)}
        onViewHistory={() => setActiveTab('history')}
      />

      {/* Interactive BSC Chain Simulator Drawer */}
      {system.simulatorEnabled && (
        <SimulatorDrawer
          isOpen={testLabOpen}
          activeInvoice={modalInvoice ?? activeInvoice}
          indexer={indexer}
          onClose={() => setTestLabOpen(false)}
          onAfterAction={refreshWalletState}
        />
      )}

      {/* Account Switcher / Sign In / Register Modal */}
      <AuthModal
        isOpen={authModalOpen}
        currentUser={user}
        demoAccounts={demoAccounts}
        demoAuthEnabled={system.demoAuthEnabled}
        onClose={() => setAuthModalOpen(false)}
        onDemoSwitch={handleDemoSwitch}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    </div>
  );
};
