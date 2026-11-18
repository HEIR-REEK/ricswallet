import path from 'node:path';
import {
  BSC_CHAIN_ID,
  BSC_NETWORK_KEY,
  BSC_NETWORK_LABEL,
  OFFICIAL_BSC_USDT_CONTRACT,
  SUPPORTED_ASSET,
  USDT_DECIMALS,
} from '../shared/constants.js';
import { parseTokenAmountToRaw } from '../shared/units.js';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string | null;
  sqliteDbPath: string;
  sessionSecret: string;
  asset: string;
  networkKey: string;
  networkLabel: string;
  chainId: number;
  explorerUrl: string;
  usdtTokenContract: string;
  usdtDecimals: number;
  bscRpcUrl: string | null;
  rpcPollIntervalMs: number;
  rpcLogBatchBlocks: number;
  webhookHmacSecret: string;
  depositWalletXpub: string;
  isDefaultDemoXpub: boolean;
  simulatorEnabled: boolean;
  demoAuthEnabled: boolean;
  adminEmail: string;
  adminInitialPassword: string | null;
  minDepositUsdt: string;
  minDepositRaw: string;
  requiredConfirmations: number;
  invoiceExpiryMinutes: number;
  lateDepositPolicy: 'review' | 'auto_credit';
}

// Default watch-only BIP-44 external chain extended public key (m/44'/60'/0'/0) FOR LOCAL DEMO ONLY.
// SECURITY: Never send real mainnet funds to addresses derived from this demo XPUB!
// Run `npm run generate-xpub` offline to create your own custody wallet XPUB for production.
export const DEFAULT_DEV_XPUB =
  'xpub6DwYar1AAnijpsBkYhGTxyGBbTwXtLmuLQpcXvJxtnzPFApm8K1AsVrZxgqg3HyjmP9bbcvEzEvtBAn9y6jBT1sX3fXSHgeafcu3ZomQ866';

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const minDepositUsdt = overrides.minDepositUsdt ?? process.env.MIN_DEPOSIT_USDT ?? '3';
  const usdtDecimals = overrides.usdtDecimals ?? Number(process.env.USDT_DECIMALS ?? USDT_DECIMALS);

  const bscRpcUrl =
    overrides.bscRpcUrl !== undefined
      ? overrides.bscRpcUrl
      : process.env.BSC_RPC_URL?.trim() || null;

  const databaseUrl =
    overrides.databaseUrl !== undefined
      ? overrides.databaseUrl
      : process.env.DATABASE_URL?.trim() || null;

  const depositWalletXpub = (
    overrides.depositWalletXpub ??
    process.env.DEPOSIT_WALLET_XPUB?.trim() ??
    DEFAULT_DEV_XPUB
  ).trim();

  const isDefaultDemoXpub = depositWalletXpub === DEFAULT_DEV_XPUB;

  // In live blockchain mode (BSC_RPC_URL set) or production, simulator & passwordless demo login
  // are OFF by default so simulated events can NEVER credit balances in production.
  const isDevSandbox = !bscRpcUrl && nodeEnv !== 'production';

  const simulatorEnabled =
    overrides.simulatorEnabled !== undefined
      ? overrides.simulatorEnabled
      : process.env.ENABLE_SIMULATOR !== undefined
        ? process.env.ENABLE_SIMULATOR === 'true'
        : isDevSandbox;

  const demoAuthEnabled =
    overrides.demoAuthEnabled !== undefined
      ? overrides.demoAuthEnabled
      : process.env.ENABLE_DEMO_AUTH !== undefined
        ? process.env.ENABLE_DEMO_AUTH === 'true'
        : isDevSandbox;

  return {
    port: overrides.port ?? Number(process.env.PORT ?? 3000),
    nodeEnv,
    databaseUrl,
    sqliteDbPath:
      overrides.sqliteDbPath ??
      process.env.SQLITE_DB_PATH ??
      path.resolve(process.cwd(), 'data', 'ricswallet.db'),
    sessionSecret:
      overrides.sessionSecret ??
      process.env.SESSION_SECRET ??
      'ricswallet-dev-session-secret-do-not-use-in-prod',
    asset: SUPPORTED_ASSET,
    networkKey: overrides.networkKey ?? process.env.BSC_NETWORK_KEY ?? BSC_NETWORK_KEY,
    networkLabel: overrides.networkLabel ?? process.env.BSC_NETWORK_NAME ?? BSC_NETWORK_LABEL,
    chainId: overrides.chainId ?? Number(process.env.BSC_CHAIN_ID ?? BSC_CHAIN_ID),
    explorerUrl: (overrides.explorerUrl ?? process.env.BSC_EXPLORER_URL ?? 'https://bscscan.com').replace(
      /\/+$/,
      ''
    ),
    usdtTokenContract:
      overrides.usdtTokenContract ?? process.env.USDT_TOKEN_CONTRACT ?? OFFICIAL_BSC_USDT_CONTRACT,
    usdtDecimals,
    bscRpcUrl,
    rpcPollIntervalMs:
      overrides.rpcPollIntervalMs ?? Number(process.env.RPC_POLL_INTERVAL_MS ?? 5000),
    rpcLogBatchBlocks:
      overrides.rpcLogBatchBlocks ?? Number(process.env.RPC_LOG_BATCH_BLOCKS ?? 100),
    webhookHmacSecret:
      overrides.webhookHmacSecret ??
      process.env.WEBHOOK_HMAC_SECRET ??
      'whsec_ricswallet_dev_hmac_secret',
    depositWalletXpub,
    isDefaultDemoXpub,
    simulatorEnabled,
    demoAuthEnabled,
    adminEmail:
      overrides.adminEmail ?? process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? 'ric@ricswallet.io',
    adminInitialPassword:
      overrides.adminInitialPassword !== undefined
        ? overrides.adminInitialPassword
        : process.env.ADMIN_INITIAL_PASSWORD?.trim() || null,
    minDepositUsdt,
    minDepositRaw: overrides.minDepositRaw ?? parseTokenAmountToRaw(minDepositUsdt, usdtDecimals),
    requiredConfirmations:
      overrides.requiredConfirmations ?? Number(process.env.REQUIRED_CONFIRMATIONS ?? 15),
    invoiceExpiryMinutes:
      overrides.invoiceExpiryMinutes ?? Number(process.env.INVOICE_EXPIRY_MINUTES ?? 60),
    lateDepositPolicy:
      overrides.lateDepositPolicy ??
      (process.env.LATE_DEPOSIT_POLICY === 'auto_credit' ? 'auto_credit' : 'review'),
  };
}
