import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { AppConfig, loadConfig } from './config.js';
import { AppDatabase, createDatabase } from './db.js';
import { HdAddressService } from './wallet/hdAddressService.js';
import { AuthService } from './services/authService.js';
import { LedgerService } from './services/ledgerService.js';
import { DepositService } from './services/depositService.js';
import { IndexerService } from './services/indexerService.js';
import { UserProfile } from '../shared/types.js';
import { formatRawTokenAmount } from '../shared/units.js';

export interface ServerContext {
  app: express.Express;
  db: AppDatabase;
  config: AppConfig;
  hdWallet: HdAddressService;
  authService: AuthService;
  ledgerService: LedgerService;
  depositService: DepositService;
  indexerService: IndexerService;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: UserProfile;
      authToken?: string;
      rawBody?: string;
    }
  }
}

const SESSION_COOKIE = 'ricswallet_session';

export async function createServerContext(
  configOverrides: Partial<AppConfig> = {}
): Promise<ServerContext> {
  const config = loadConfig(configOverrides);
  const db = await createDatabase({
    databaseUrl: config.databaseUrl,
    sqliteDbPath: config.sqliteDbPath,
  });

  const hdWallet = new HdAddressService(config.depositWalletXpub);
  const authService = new AuthService(db, config);
  const ledgerService = new LedgerService(db, config);
  const depositService = new DepositService(db, config, hdWallet, ledgerService);
  const indexerService = new IndexerService(db, config, ledgerService, depositService);

  await indexerService.ensureIndexerState();
  await authService.seedInitialUsers();

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    express.json({
      limit: '1mb',
      verify: (req: Request, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(cookieParser());

  // Extract session from cookie or Authorization Bearer header
  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined;
      const token = bearer || (req.cookies?.[SESSION_COOKIE] as string | undefined);
      if (token) {
        const user = await authService.getUserBySessionToken(token);
        if (user) {
          req.authUser = user;
          req.authToken = token;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    next();
  };

  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.authUser.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required.' });
      return;
    }
    next();
  };

  const requireSimulator = (_req: Request, res: Response, next: NextFunction): void => {
    if (!config.simulatorEnabled) {
      res.status(403).json({
        error:
          'BSC Chain Simulator is disabled in live production mode. Only verified on-chain BSC USDT transfers can credit balances.',
      });
      return;
    }
    next();
  };

  const setSessionCookie = (res: Response, token: string): void => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  };

  const publicSystemConfig = () => ({
    asset: config.asset,
    networkKey: config.networkKey,
    networkLabel: config.networkLabel,
    chainId: config.chainId,
    explorerUrl: config.explorerUrl,
    usdtTokenContract: config.usdtTokenContract,
    usdtDecimals: config.usdtDecimals,
    minDepositFormatted: formatRawTokenAmount(config.minDepositRaw, config.usdtDecimals),
    minDepositRaw: config.minDepositRaw,
    requiredConfirmations: config.requiredConfirmations,
    invoiceExpiryMinutes: config.invoiceExpiryMinutes,
    lateDepositPolicy: config.lateDepositPolicy,
    simulatorEnabled: config.simulatorEnabled,
    demoAuthEnabled: config.demoAuthEnabled,
    isLiveChain: Boolean(config.bscRpcUrl),
    isDefaultDemoXpub: config.isDefaultDemoXpub,
    dbDialect: db.dialect,
  });

  // --- Health & System Config ---
  app.get('/api/health', async (_req, res) => {
    try {
      res.json({
        ok: true,
        system: publicSystemConfig(),
        indexer: await indexerService.getHealth(),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error' });
    }
  });

  // --- Auth Endpoints ---
  app.get('/api/auth/me', async (req, res) => {
    const demoAccounts = await authService.listDemoAccounts();
    if (!req.authUser) {
      res.json({
        authenticated: false,
        user: null,
        balance: null,
        system: publicSystemConfig(),
        demoAccounts,
      });
      return;
    }

    res.json({
      authenticated: true,
      user: req.authUser,
      balance: await ledgerService.getWalletBalanceSummary(req.authUser.id),
      system: publicSystemConfig(),
      demoAccounts,
    });
  });

  app.post('/api/auth/demo-login', async (req, res) => {
    if (!config.demoAuthEnabled) {
      res.status(403).json({
        error: 'Demo quick-login is disabled in production. Please sign in or create an account.',
      });
      return;
    }
    try {
      const requestedEmail = (req.body?.email as string | undefined)?.trim().toLowerCase();
      const targetEmail = requestedEmail || 'ric@ricswallet.io';
      const user = await authService.getUserByEmail(targetEmail);
      if (!user) {
        res.status(404).json({ error: 'Demo user account not found.' });
        return;
      }
      const token = await authService.createSession(user.id);
      setSessionCookie(res, token);
      res.json({
        authenticated: true,
        token,
        user,
        balance: await ledgerService.getWalletBalanceSummary(user.id),
        system: publicSystemConfig(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Demo login failed.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, name, password } = req.body ?? {};
      const user = await authService.registerUser({
        email: String(email ?? ''),
        name: String(name ?? ''),
        password: String(password ?? ''),
      });
      const token = await authService.createSession(user.id);
      setSessionCookie(res, token);
      res.status(201).json({
        authenticated: true,
        token,
        user,
        balance: await ledgerService.getWalletBalanceSummary(user.id),
        system: publicSystemConfig(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      const { user, token } = await authService.authenticate(
        String(email ?? ''),
        String(password ?? '')
      );
      setSessionCookie(res, token);
      res.json({
        authenticated: true,
        token,
        user,
        balance: await ledgerService.getWalletBalanceSummary(user.id),
        system: publicSystemConfig(),
      });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    if (req.authToken) {
      await authService.revokeSession(req.authToken);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // --- Authenticated Wallet & Deposit Invoice Endpoints ---
  app.get('/api/deposits/summary', requireAuth, async (req, res) => {
    try {
      if (!config.bscRpcUrl) {
        await indexerService.syncOnce();
      }
      const userId = req.authUser!.id;
      const invoices = await depositService.listUserInvoices(userId, 50);
      const activeInvoice =
        invoices.find((inv) => inv.status === 'waiting' || inv.status === 'detected') ?? null;

      res.json({
        balance: await ledgerService.getWalletBalanceSummary(userId),
        activeInvoice,
        invoices,
        ledger: await ledgerService.listUserLedgerEntries(userId, 50),
        indexer: await indexerService.getHealth(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load summary.' });
    }
  });

  app.post('/api/deposits/invoices', requireAuth, async (req, res) => {
    try {
      const { expectedAmountUsdt, forceNew } = req.body ?? {};
      const invoice = await depositService.createOrGetInvoice(req.authUser!.id, {
        expectedAmountUsdt: expectedAmountUsdt ? String(expectedAmountUsdt) : undefined,
        forceNew: Boolean(forceNew),
      });
      res.status(201).json({
        invoice,
        balance: await ledgerService.getWalletBalanceSummary(req.authUser!.id),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not create invoice.' });
    }
  });

  app.get('/api/deposits/invoices', requireAuth, async (req, res) => {
    const invoices = await depositService.listUserInvoices(req.authUser!.id, 50);
    res.json({ invoices });
  });

  app.get('/api/deposits/invoices/:id', requireAuth, async (req, res) => {
    const invoice = await depositService.getInvoiceById(String(req.params.id), req.authUser!.id);
    if (!invoice) {
      res.status(404).json({ error: 'Deposit invoice not found.' });
      return;
    }
    res.json({
      invoice,
      balance: await ledgerService.getWalletBalanceSummary(req.authUser!.id),
      indexer: await indexerService.getHealth(),
    });
  });

  app.post('/api/deposits/invoices/:id/cancel', requireAuth, async (req, res) => {
    try {
      const invoice = await depositService.cancelInvoice(String(req.params.id), req.authUser!.id);
      res.json({ invoice });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not cancel invoice.' });
    }
  });

  app.get('/api/deposits/ledger', requireAuth, async (req, res) => {
    res.json({
      balance: await ledgerService.getWalletBalanceSummary(req.authUser!.id),
      entries: await ledgerService.listUserLedgerEntries(req.authUser!.id, 100),
    });
  });

  // --- Trusted Provider Webhook Endpoint (HMAC-SHA256 Verified) ---
  app.post('/api/webhooks/chain-events', async (req, res) => {
    try {
      const sig = req.headers['x-ricswallet-signature'] as string | undefined;
      const transfer = await indexerService.verifyAndIngestWebhook(
        req.rawBody ?? JSON.stringify(req.body),
        sig,
        req.body
      );
      res.json({ ok: true, transfer });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Webhook rejected.' });
    }
  });

  // --- Interactive BSC On-Chain Test Lab / Simulator Endpoints (Guarded in Production!) ---
  app.get('/api/simulator/health', requireSimulator, async (_req, res) => {
    res.json({ indexer: await indexerService.getHealth() });
  });

  app.post('/api/simulator/send-transfer', requireAuth, requireSimulator, async (req, res) => {
    try {
      const {
        toAddress,
        amountUsdt,
        fromAddress,
        tokenContract,
        tokenSymbolHint,
        chainId,
        txHash,
        logIndex,
        advanceBlocks,
      } = req.body ?? {};

      const transfer = await indexerService.simulateTransferOnChain({
        toAddress: String(toAddress ?? ''),
        amountUsdt: String(amountUsdt ?? ''),
        fromAddress: fromAddress ? String(fromAddress) : undefined,
        tokenContract: tokenContract ? String(tokenContract) : undefined,
        tokenSymbolHint: tokenSymbolHint ? String(tokenSymbolHint) : undefined,
        chainId: chainId !== undefined ? Number(chainId) : undefined,
        txHash: txHash ? String(txHash) : undefined,
        logIndex: logIndex !== undefined ? Number(logIndex) : undefined,
        advanceBlocks: advanceBlocks !== undefined ? Number(advanceBlocks) : undefined,
      });

      res.status(201).json({
        transfer,
        indexer: await indexerService.getHealth(),
        balance: await ledgerService.getWalletBalanceSummary(req.authUser!.id),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Simulation failed.' });
    }
  });

  app.post('/api/simulator/mine-blocks', requireAuth, requireSimulator, async (req, res) => {
    try {
      const count = Number(req.body?.blocks ?? 1);
      const indexer = await indexerService.mineSimulatedBlocks(count);
      res.json({
        indexer,
        balance: await ledgerService.getWalletBalanceSummary(req.authUser!.id),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not mine blocks.' });
    }
  });

  app.post('/api/simulator/reorg', requireAuth, requireSimulator, async (req, res) => {
    try {
      const txHash = String(req.body?.txHash ?? '');
      const transfer = await indexerService.simulateReorg(txHash);
      res.json({
        transfer,
        indexer: await indexerService.getHealth(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Reorg simulation failed.' });
    }
  });

  app.post('/api/simulator/expire-invoice', requireAuth, requireSimulator, async (req, res) => {
    try {
      const invoiceId = String(req.body?.invoiceId ?? '');
      const invoice = await depositService.forceExpireInvoice(invoiceId);
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }
      res.json({ invoice });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not expire invoice.' });
    }
  });

  app.post('/api/simulator/auto-mine', requireAuth, requireSimulator, async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const indexer = await indexerService.setAutoMine(enabled);
    res.json({ indexer });
  });

  // --- Step 9: Admin + Monitoring + Reconciliation Endpoints ---
  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    const indexer = await indexerService.getHealth();
    const reconciliation = await ledgerService.reconcileAllBalances();

    const recentTransferRows = await db.all<Record<string, unknown>>(
      `SELECT * FROM chain_transfers ORDER BY observed_at DESC, id DESC LIMIT 30`
    );

    const reviewQueueRows = await db.all<Record<string, unknown>>(
      `SELECT * FROM chain_transfers WHERE status = 'review' ORDER BY observed_at DESC, id DESC`
    );

    const recentInvoiceRows = await db.all<Record<string, unknown>>(
      `SELECT i.*, a.derivation_index, a.derivation_path, u.email AS user_email, u.name AS user_name
       FROM deposit_invoices i
       JOIN deposit_addresses a ON a.id = i.address_id
       JOIN users u ON u.id = i.user_id
       ORDER BY i.created_at DESC
       LIMIT 30`
    );

    const mappedInvoices = await Promise.all(
      recentInvoiceRows.map(async (r) => ({
        ...(await depositService.mapInvoiceRow(r)),
        userEmail: String(r.user_email),
        userName: String(r.user_name),
      }))
    );

    res.json({
      indexer,
      reconciliation,
      recentTransfers: recentTransferRows.map((r) => depositService.mapTransferRow(r)),
      reviewQueue: reviewQueueRows.map((r) => depositService.mapTransferRow(r)),
      recentInvoices: mappedInvoices,
      recentLedger: await ledgerService.listRecentLedgerEntries(30),
    });
  });

  app.get('/api/admin/search', requireAdmin, async (req, res) => {
    const q = String(req.query.q ?? '');
    res.json(await depositService.adminSearch(q));
  });

  app.post('/api/admin/reconcile', requireAdmin, async (_req, res) => {
    res.json({ reconciliation: await ledgerService.reconcileAllBalances() });
  });

  app.post('/api/admin/transfers/:id/resolve', requireAdmin, async (req, res) => {
    try {
      const action = req.body?.action === 'reject' ? 'reject' : 'approve_credit';
      const note = String(req.body?.note ?? '');
      const transfer = await depositService.adminResolveReviewTransfer(
        String(req.params.id),
        action,
        note
      );
      res.json({
        transfer,
        reconciliation: await ledgerService.reconcileAllBalances(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Resolution failed.' });
    }
  });

  return {
    app,
    db,
    config,
    hdWallet,
    authService,
    ledgerService,
    depositService,
    indexerService,
  };
}
