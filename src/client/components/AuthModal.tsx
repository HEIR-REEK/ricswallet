import React, { useEffect, useState } from 'react';
import { LogIn, UserPlus, Users, X } from 'lucide-react';
import { UserProfile } from '../../shared/types.js';

interface AuthModalProps {
  isOpen: boolean;
  currentUser: UserProfile | null;
  demoAccounts: UserProfile[];
  demoAuthEnabled: boolean;
  onClose: () => void;
  onDemoSwitch: (email: string) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, password: string) => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  currentUser,
  demoAccounts,
  demoAuthEnabled,
  onClose,
  onDemoSwitch,
  onLogin,
  onRegister,
}) => {
  const [mode, setMode] = useState<'switch' | 'login' | 'register'>(
    demoAuthEnabled && demoAccounts.length > 0 ? 'switch' : 'login'
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!demoAuthEnabled && mode === 'switch') {
      setMode('login');
    }
  }, [demoAuthEnabled, mode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else {
        await onRegister(name, email, password);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const showSwitchTab = demoAuthEnabled && demoAccounts.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && currentUser) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900">Account & Wallet Session</h3>
          {currentUser && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Mode Switch Tabs */}
        <div
          className={`grid ${
            showSwitchTab ? 'grid-cols-3' : 'grid-cols-2'
          } gap-1.5 bg-slate-100 p-1 rounded-xl mb-5 text-xs font-semibold`}
        >
          {showSwitchTab && (
            <button
              type="button"
              onClick={() => setMode('switch')}
              className={`py-2 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
                mode === 'switch' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Quick Switch
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`py-2 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
              mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`py-2 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
              mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Register
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
            {error}
          </div>
        )}

        {mode === 'switch' && showSwitchTab ? (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-500 mb-2">
              Switch accounts to test isolated per-user HD deposit address derivation:
            </p>
            {demoAccounts.map((acc) => {
              const isCurrent = currentUser?.id === acc.id;
              return (
                <button
                  key={acc.id}
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onDemoSwitch(acc.email);
                      onClose();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-indigo-50/70 border-indigo-300'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900">{acc.name}</div>
                    <div className="text-xs text-slate-500">{acc.email}</div>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700">
                    {isCurrent ? 'Active' : acc.role}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            {mode === 'register' && (
              <label className="block">
                <span className="font-semibold text-slate-700 block mb-1">Full Name</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Brian Kiprop"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
                />
              </label>
            )}

            <label className="block">
              <span className="font-semibold text-slate-700 block mb-1">Email Address</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
              />
            </label>

            <label className="block">
              <span className="font-semibold text-slate-700 block mb-1">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl bg-[#5854D8] hover:bg-[#4945C8] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Wallet Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
