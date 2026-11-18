# RicsWallet — Phase 1: USDT Deposit System (BNB Smart Chain / BEP-20)

Full-stack implementation of the **USDT Deposit System** blueprint on **BNB Smart Chain (BEP-20)** — ready for both local development/simulation and **real on-chain mainnet production** on Render.

---

## Deploying to Render (Fixing `Couldn't find a package.json` & Going Live)

### 1. Render Service Settings
In your Render Web Service (**Settings** tab):
- **Branch**: Set to `main` (after merging the PR) or `arena/81bc5f42-ricswallet` to deploy immediately from this branch.
- **Root Directory**: Leave **blank / empty** (the `package.json` is at the root of the repository).
- **Build Command**: `npm install && npm run build` *(or `yarn && yarn build` — both are supported)*
- **Start Command**: `npm start` *(or `yarn start` — runs compiled `dist/server/index.js`)*
- **Node Version**: Automatically pinned to `22.22.0` via `.node-version` and `package.json` `"engines"`.
- Or use **Render Blueprints** (`New +` → `Blueprint`) which reads `render.yaml` automatically!

### 2. Required Environment Variables for **Real Transactions**
Before accepting real USDT from customers, set these Environment Variables in Render:

| Variable | Required for Real Funds? | What to Set |
|---|---|---|
| `DATABASE_URL` | **Yes** | Create a **Render PostgreSQL** database (or Neon / Supabase Postgres) and paste the **Internal/External Database URL**. RicsWallet automatically creates all tables in PostgreSQL so balances & addresses persist across deploys! |
| `DEPOSIT_WALLET_XPUB` | **Yes (CRITICAL)** | Run `npm run generate-xpub` **offline on your own laptop**. Write down your 12-word recovery phrase offline (import it into Trust Wallet / MetaMask / Ledger to control deposited funds), and paste **only** the `xpub6...` key here. Never use the built-in demo key for real funds! |
| `BSC_RPC_URL` | **Yes** | A reliable BNB Smart Chain Mainnet JSON-RPC URL — e.g. **Alchemy BSC**, **QuickNode BSC**, **Ankr BSC**, or `https://bsc-rpc.publicnode.com`. |
| `SESSION_SECRET` | **Yes** | Any random 64-character secret string. |
| `ADMIN_EMAIL` | Recommended | Your admin email (e.g. `you@yourdomain.com`) to access the **Admin & Ops** tab. |
| `ADMIN_INITIAL_PASSWORD` | Recommended | Strong initial password for your admin account. |
| `NODE_ENV` | Recommended | `production` (automatically disables the BSC Test Lab simulator & passwordless demo login). |

---

## Generating Your Own Real Custody Wallet (`xpub`) Offline

Run this on your own secure computer (never on a public server):

```bash
npm install
npm run generate-xpub
```

It outputs:
1. Your **12-word BIP-39 Secret Recovery Phrase** — keep offline and import into Trust Wallet / MetaMask / Ledger to access incoming USDT on `m/44'/60'/0'/0/{index}`.
2. Your **Watch-Only `DEPOSIT_WALLET_XPUB`** — paste into Render's `DEPOSIT_WALLET_XPUB` environment variable.
3. Your first 5 derived `0x...` BEP-20 addresses so you can verify `Index #0` matches your wallet app before going live with a tiny test deposit (`3–5 USDT`).

---

## Local Development & Automated Tests

```bash
# Install dependencies
npm install

# Start unified Express API + Vite frontend server on 0.0.0.0:3000
npm run dev

# Run automated integration & production-guardrail tests
npm test

# Build frontend + backend & start compiled production server
npm run build
npm start
```
