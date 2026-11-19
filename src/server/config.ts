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

function nonEmptyEnv(name: string): string | undefined {
  const val = process.env[name]?.trim();
  return val ? val : undefined;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? nonEmptyEnv('NODE_ENV') ?? 'development';
  const minDepositUsdt = overrides.minDepositUsdt ?? nonEmptyEnv('MIN_DEPOSIT_USDT') ?? '3';
  const usdtDecimals =
    overrides.usdtDecimals ?? Number(nonEmptyEnv('USDT_DECIMALS') ?? USDT_DECIMALS);

  const bscRpcUrl =
    overrides.bscRpcUrl !== undefined ? overrides.bscRpcUrl : nonEmptyEnv('BSC_RPC_URL') ?? null;

  const databaseUrl =
    overrides.databaseUrl !== undefined
      ? overrides.databaseUrl
      : nonEmptyEnv('DATABASE_URL') ?? null;

  const depositWalletXpub = (
    overrides.depositWalletXpub ||
    nonEmptyEnv('DEPOSIT_WALLET_XPUB') ||
    DEFAULT_DEV_XPUB
  ).trim();

  const isDefaultDemoXpub = depositWalletXpub === DEFAULT_DEV_XPUB;

  // In live blockchain mode (BSC_RPC_URL set) or production, simulator & passwordless demo login
  // are OFF by default so simulated events can NEVER credit balances in production.
  const isDevSandbox = !bscRpcUrl && nodeEnv !== 'production';

  const simulatorEnabled =
    overrides.simulatorEnabled !== undefined
      ? overrides.simulatorEnabled
      : nonEmptyEnv('ENABLE_SIMULATOR') !== undefined
        ? nonEmptyEnv('ENABLE_SIMULATOR') === 'true'
        : isDevSandbox;

  const demoAuthEnabled =
    overrides.demoAuthEnabled !== undefined
      ? overrides.demoAuthEnabled
      : nonEmptyEnv('ENABLE_DEMO_AUTH') !== undefined
        ? nonEmptyEnv('ENABLE_DEMO_AUTH') === 'true'
        : isDevSandbox;

  return {
    port: overrides.port ?? Number(nonEmptyEnv('PORT') ?? 3000),
    nodeEnv,
    databaseUrl,
    sqliteDbPath:
      overrides.sqliteDbPath ??
      nonEmptyEnv('SQLITE_DB_PATH') ??
      path.resolve(process.cwd(), 'data', 'ricswallet.db'),
    sessionSecret:
      overrides.sessionSecret ??
      nonEmptyEnv('SESSION_SECRET') ??
      'ricswallet-dev-session-secret-do-not-use-in-prod',
    asset: SUPPORTED_ASSET,
    networkKey: overrides.networkKey ?? nonEmptyEnv('BSC_NETWORK_KEY') ?? BSC_NETWORK_KEY,
    networkLabel: overrides.networkLabel ?? nonEmptyEnv('BSC_NETWORK_NAME') ?? BSC_NETWORK_LABEL,
    chainId: overrides.chainId ?? Number(nonEmptyEnv('BSC_CHAIN_ID') ?? BSC_CHAIN_ID),
    explorerUrl: (
      overrides.explorerUrl ??
      nonEmptyEnv('BSC_EXPLORER_URL') ??
      'https://bscscan.com'
    ).replace(/\/+$/, ''),
    usdtTokenContract:
      overrides.usdtTokenContract ??
      nonEmptyEnv('USDT_TOKEN_CONTRACT') ??
      OFFICIAL_BSC_USDT_CONTRACT,
    usdtDecimals,
    bscRpcUrl,
    rpcPollIntervalMs:
      overrides.rpcPollIntervalMs ?? Number(nonEmptyEnv('RPC_POLL_INTERVAL_MS') ?? 5000),
    rpcLogBatchBlocks:
      overrides.rpcLogBatchBlocks ?? Number(nonEmptyEnv('RPC_LOG_BATCH_BLOCKS') ?? 100),
    webhookHmacSecret:
      overrides.webhookHmacSecret ??
      nonEmptyEnv('WEBHOOK_HMAC_SECRET') ??
      'whsec_ricswallet_dev_hmac_secret',
    depositWalletXpub,
    isDefaultDemoXpub,
    simulatorEnabled,
    demoAuthEnabled,
    adminEmail: (
      overrides.adminEmail ??
      nonEmptyEnv('ADMIN_EMAIL') ??
      'ric@ricswallet.io'
    ).toLowerCase(),
    adminInitialPassword:
      overrides.adminInitialPassword !== undefined
        ? overrides.adminInitialPassword
        : nonEmptyEnv('ADMIN_INITIAL_PASSWORD') ?? null,
    minDepositUsdt,
    minDepositRaw: overrides.minDepositRaw ?? parseTokenAmountToRaw(minDepositUsdt, usdtDecimals),
    requiredConfirmations:
      overrides.requiredConfirmations ?? Number(nonEmptyEnv('REQUIRED_CONFIRMATIONS') ?? 15),
    invoiceExpiryMinutes:
      overrides.invoiceExpiryMinutes ?? Number(nonEmptyEnv('INVOICE_EXPIRY_MINUTES') ?? 60),
    lateDepositPolicy:
      overrides.lateDepositPolicy ??
      (nonEmptyEnv('LATE_DEPOSIT_POLICY') === 'auto_credit' ? 'auto_credit' : 'review'),
  };
}
