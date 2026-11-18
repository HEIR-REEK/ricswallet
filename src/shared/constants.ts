export const SUPPORTED_ASSET = 'USDT' as const;
export const BSC_NETWORK_KEY = 'BSC_BEP20' as const;
export const BSC_NETWORK_LABEL = 'BNB Smart Chain (BEP-20)' as const;
export const BSC_CHAIN_ID = 56;

// Official Binance-Peg BSC-USD (USDT) BEP-20 contract on BNB Smart Chain Mainnet (18 decimals)
export const OFFICIAL_BSC_USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
export const USDT_DECIMALS = 18;

// ERC-20 / BEP-20 Transfer(address indexed from, address indexed to, uint256 value)
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// User-facing deposit states from Page 2 of the Build Guide
export const INVOICE_UI_COPY: Record<
  'waiting' | 'detected' | 'confirmed' | 'expired' | 'review' | 'cancelled',
  {
    label: string;
    userHeading: string;
    description: string;
  }
> = {
  waiting: {
    label: 'Waiting for payment',
    userHeading: 'Waiting for deposit…',
    description: 'Send USDT on BNB Smart Chain (BEP-20) to the assigned deposit address above.',
  },
  detected: {
    label: 'Payment detected',
    userHeading: 'Payment detected — confirming',
    description: 'Matching on-chain BEP-20 transfer found. Waiting for finality threshold.',
  },
  confirmed: {
    label: 'Confirmed',
    userHeading: 'Deposit successful',
    description: 'Required confirmations reached and your USDT balance has been credited.',
  },
  expired: {
    label: 'Expired',
    userHeading: 'This deposit request expired',
    description: 'Create a fresh deposit request before sending. Late transfers are queued for review.',
  },
  review: {
    label: 'Review / failed',
    userHeading: 'Contact support if needed',
    description: 'Action or verification required (sub-minimum deposit, late arrival, or token mismatch).',
  },
  cancelled: {
    label: 'Cancelled',
    userHeading: 'Deposit request cancelled',
    description: 'This deposit invoice was closed by the user before payment.',
  },
};
