import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { createServerContext } from '../src/server/app.js';
import { HdAddressService } from '../src/server/wallet/hdAddressService.js';
import { formatRawTokenAmount, parseTokenAmountToRaw } from '../src/shared/units.js';

describe('RicsWallet Phase 1 — USDT BEP-20 Deposit System', () => {
  it('enforces public-only xpub derivation and rejects private keys (xprv)', () => {
    const mnemonic = Mnemonic.fromEntropy(crypto.randomBytes(16));
    const rootWithPriv = HDNodeWallet.fromPhrase(mnemonic.phrase, '', "m/44'/60'/0'/0");
    expect(() => new HdAddressService(rootWithPriv.extendedKey)).toThrow(/SECURITY VIOLATION/);

    const neuteredXpub = rootWithPriv.neuter().extendedKey;
    const service = new HdAddressService(neuteredXpub);
    const a0 = service.deriveAddress(0);
    const a1 = service.deriveAddress(1);

    expect(a0.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a1.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a0.address).not.toBe(a1.address);
    expect(a0.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  it('handles 18-decimal BigInt token parsing & formatting without floating-point errors', () => {
    const r1 = parseTokenAmountToRaw('0.1', 18);
    const r2 = parseTokenAmountToRaw('0.2', 18);
    const sum = (BigInt(r1) + BigInt(r2)).toString();
    expect(sum).toBe('300000000000000000');
    expect(formatRawTokenAmount(sum, 18)).toBe('0.30');

    const tiny = parseTokenAmountToRaw('3.000000000000000001', 18);
    expect(tiny).toBe('3000000000000000001');
  });

  it('requires authentication and allocates unique deterministic HD addresses per user/invoice', async () => {
    const ctx = await createServerContext({ sqliteDbPath: ':memory:' });

    const unauth = await request(ctx.app).post('/api/deposits/invoices').send({});
    expect(unauth.status).toBe(401);

    const ricLogin = await request(ctx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'ric@ricswallet.io' });
    expect(ricLogin.status).toBe(200);
    const ricToken = ricLogin.body.token as string;

    const aliceLogin = await request(ctx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'alice@ricswallet.io' });
    const aliceToken = aliceLogin.body.token as string;

    const invRic1 = await request(ctx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${ricToken}`)
      .send({});
    expect(invRic1.status).toBe(201);

    const invRicSame = await request(ctx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${ricToken}`)
      .send({});
    expect(invRicSame.body.invoice.id).toBe(invRic1.body.invoice.id);
    expect(invRicSame.body.invoice.address).toBe(invRic1.body.invoice.address);

    const invAlice = await request(ctx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});
    expect(invAlice.status).toBe(201);
    expect(invAlice.body.invoice.address).not.toBe(invRic1.body.invoice.address);
    expect(invAlice.body.invoice.derivationIndex).toBe(1);

    const serialized = JSON.stringify(invRic1.body);
    expect(serialized).not.toContain('xprv');
    expect(serialized).not.toContain('xpub');
    expect(serialized).not.toContain('privateKey');
  });

  it('detects real transfer, tracks confirmations (1 -> 15), credits ledger atomically once, and blocks duplicates', async () => {
    const ctx = await createServerContext({ sqliteDbPath: ':memory:' });
    const login = await request(ctx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'ric@ricswallet.io' });
    const token = login.body.token as string;

    const invRes = await request(ctx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const invoice = invRes.body.invoice;

    const fixedTxHash = '0x' + 'a1'.repeat(32);

    const simRes = await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: invoice.address,
        amountUsdt: '25.50',
        txHash: fixedTxHash,
        logIndex: 0,
      });
    expect(simRes.status).toBe(201);
    expect(simRes.body.transfer.confirmations).toBe(1);
    expect(simRes.body.transfer.status).toBe('confirming');

    const statusMid = await request(ctx.app)
      .get(`/api/deposits/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(statusMid.body.invoice.status).toBe('detected');
    expect(statusMid.body.balance.availableFormatted).toBe('0.00');
    expect(statusMid.body.balance.confirmingFormatted).toBe('25.50');

    await request(ctx.app)
      .post('/api/simulator/mine-blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks: 14 });

    const statusDone = await request(ctx.app)
      .get(`/api/deposits/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(statusDone.body.invoice.status).toBe('confirmed');
    expect(statusDone.body.invoice.confirmations).toBe(15);
    expect(statusDone.body.balance.availableFormatted).toBe('25.50');
    expect(statusDone.body.balance.confirmingFormatted).toBe('0.00');

    await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: invoice.address,
        amountUsdt: '25.50',
        txHash: fixedTxHash,
        logIndex: 0,
      });

    const ledgerRes = await request(ctx.app)
      .get('/api/deposits/ledger')
      .set('Authorization', `Bearer ${token}`);
    expect(ledgerRes.body.entries).toHaveLength(1);
    expect(ledgerRes.body.balance.availableFormatted).toBe('25.50');

    const recon = await ctx.ledgerService.reconcileAllBalances();
    expect(recon.allMatched).toBe(true);
    expect(recon.totalSystemLiabilityFormatted).toBe('25.50');
  });

  it('rejects spoofed fake USDT contracts and wrong networks without crediting balance', async () => {
    const ctx = await createServerContext({ sqliteDbPath: ':memory:' });
    const login = await request(ctx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'ric@ricswallet.io' });
    const token = login.body.token as string;

    const invRes = await request(ctx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const address = invRes.body.invoice.address as string;

    const fakeToken = '0x1111111111111111111111111111111111111111';
    const fakeRes = await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: address,
        amountUsdt: '100',
        tokenContract: fakeToken,
        advanceBlocks: 20,
      });
    expect(fakeRes.body.transfer.status).toBe('review');
    expect(fakeRes.body.transfer.validationCode).toBe('WRONG_TOKEN_CONTRACT');

    const wrongChainRes = await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: address,
        amountUsdt: '50',
        chainId: 137,
        advanceBlocks: 20,
      });
    expect(wrongChainRes.body.transfer.status).toBe('review');
    expect(wrongChainRes.body.transfer.validationCode).toBe('WRONG_NETWORK');

    const bal = await ctx.ledgerService.getWalletBalanceSummary(login.body.user.id);
    expect(bal.availableFormatted).toBe('0.00');
  });

  it('handles sub-minimum underpayments (< 3 USDT) by holding until cumulative total reaches 3 USDT', async () => {
    const ctx = await createServerContext({ sqliteDbPath: ':memory:' });
    const login = await request(ctx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'alice@ricswallet.io' });
    const token = login.body.token as string;

    const invRes = await request(ctx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const invoice = invRes.body.invoice;

    await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: invoice.address,
        amountUsdt: '1.25',
        advanceBlocks: 15,
      });

    const afterFirst = await request(ctx.app)
      .get(`/api/deposits/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterFirst.body.invoice.status).toBe('review');
    expect(afterFirst.body.balance.availableFormatted).toBe('0.00');
    expect(afterFirst.body.balance.heldInReviewFormatted).toBe('1.25');

    await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: invoice.address,
        amountUsdt: '2.00',
        advanceBlocks: 15,
      });

    const afterSecond = await request(ctx.app)
      .get(`/api/deposits/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterSecond.body.invoice.status).toBe('confirmed');
    expect(afterSecond.body.balance.availableFormatted).toBe('3.25');
    expect(afterSecond.body.balance.heldInReviewFormatted).toBe('0.00');
  });

  it('handles late deposits on expired invoices, chain reorgs, and HMAC-signed webhooks', async () => {
    const ctx = await createServerContext({ sqliteDbPath: ':memory:' });
    const login = await request(ctx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'ric@ricswallet.io' });
    const token = login.body.token as string;

    const inv1 = (
      await request(ctx.app)
        .post('/api/deposits/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ forceNew: true })
    ).body.invoice;

    const reorgTx = await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ toAddress: inv1.address, amountUsdt: '12.00' });

    expect(reorgTx.body.transfer.status).toBe('confirming');

    const reorgResult = await request(ctx.app)
      .post('/api/simulator/reorg')
      .set('Authorization', `Bearer ${token}`)
      .send({ txHash: reorgTx.body.transfer.txHash });
    expect(reorgResult.body.transfer.status).toBe('reorged');

    const inv2 = (
      await request(ctx.app)
        .post('/api/deposits/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ forceNew: true })
    ).body.invoice;

    await request(ctx.app)
      .post('/api/simulator/expire-invoice')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId: inv2.id });

    const lateTx = await request(ctx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({
        toAddress: inv2.address,
        amountUsdt: '18.00',
        advanceBlocks: 15,
      });
    expect(lateTx.body.transfer.status).toBe('review');
    expect(lateTx.body.transfer.validationCode).toBe('LATE_DEPOSIT');

    const resolved = await request(ctx.app)
      .post(`/api/admin/transfers/${lateTx.body.transfer.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve_credit', note: 'Verified late Binance withdrawal' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.transfer.status).toBe('credited');
    expect(resolved.body.reconciliation.allMatched).toBe(true);
    expect(resolved.body.reconciliation.totalSystemLiabilityFormatted).toBe('18.00');

    const inv3 = (
      await request(ctx.app)
        .post('/api/deposits/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ forceNew: true })
    ).body.invoice;

    const webhookPayload = JSON.stringify({
      chainId: 56,
      blockNumber: 44210900,
      blockHash: '0x' + 'b2'.repeat(32),
      txHash: '0x' + 'c3'.repeat(32),
      logIndex: 0,
      tokenContract: ctx.config.usdtTokenContract,
      fromAddress: '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3',
      toAddress: inv3.address,
      amountRaw: parseTokenAmountToRaw('10.00', 18),
    });

    const badWh = await request(ctx.app)
      .post('/api/webhooks/chain-events')
      .set('Content-Type', 'application/json')
      .set('x-ricswallet-signature', 'bad_sig')
      .send(webhookPayload);
    expect(badWh.status).toBe(401);

    const validSig = crypto
      .createHmac('sha256', ctx.config.webhookHmacSecret)
      .update(webhookPayload)
      .digest('hex');

    const goodWh = await request(ctx.app)
      .post('/api/webhooks/chain-events')
      .set('Content-Type', 'application/json')
      .set('x-ricswallet-signature', validSig)
      .send(webhookPayload);
    expect(goodWh.status).toBe(200);
    expect(goodWh.body.transfer.amountFormatted).toBe('10.00');
  });

  it('locks down simulator & demo-auth in production and blocks demo xpub when live BSC RPC is set', async () => {
    // 1. Live RPC + default demo XPUB must refuse deposit address generation to protect real funds
    const unsafeCtx = await createServerContext({
      sqliteDbPath: ':memory:',
      nodeEnv: 'production',
      bscRpcUrl: 'https://bsc-rpc.publicnode.com',
    });

    // Demo login disabled in production
    const demoAttempt = await request(unsafeCtx.app)
      .post('/api/auth/demo-login')
      .send({ email: 'ric@ricswallet.io' });
    expect(demoAttempt.status).toBe(403);

    // Register real user
    const reg = await request(unsafeCtx.app)
      .post('/api/auth/register')
      .send({ name: 'Real User', email: 'real@user.com', password: 'securepassword123' });
    expect(reg.status).toBe(201);
    const realToken = reg.body.token as string;

    // Simulator endpoint blocked in production
    const simAttempt = await request(unsafeCtx.app)
      .post('/api/simulator/send-transfer')
      .set('Authorization', `Bearer ${realToken}`)
      .send({ toAddress: '0x0000000000000000000000000000000000000001', amountUsdt: '100' });
    expect(simAttempt.status).toBe(403);

    // Creating real deposit invoice blocked until real DEPOSIT_WALLET_XPUB is configured
    const invBlocked = await request(unsafeCtx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${realToken}`)
      .send({});
    expect(invBlocked.status).toBe(400);
    expect(invBlocked.body.error).toMatch(/CUSTODY CONFIGURATION REQUIRED/);

    // 2. Once custom custody XPUB is provided, real deposit invoice succeeds cleanly!
    const customMnemonic = Mnemonic.fromEntropy(crypto.randomBytes(16));
    const customXpub = HDNodeWallet.fromPhrase(
      customMnemonic.phrase,
      '',
      "m/44'/60'/0'/0"
    ).neuter().extendedKey;

    const liveReadyCtx = await createServerContext({
      sqliteDbPath: ':memory:',
      nodeEnv: 'production',
      bscRpcUrl: 'https://bsc-rpc.publicnode.com',
      depositWalletXpub: customXpub,
    });

    const reg2 = await request(liveReadyCtx.app)
      .post('/api/auth/register')
      .send({ name: 'Real User', email: 'real@user.com', password: 'securepassword123' });
    const invAllowed = await request(liveReadyCtx.app)
      .post('/api/deposits/invoices')
      .set('Authorization', `Bearer ${reg2.body.token}`)
      .send({});
    expect(invAllowed.status).toBe(201);
    expect(invAllowed.body.invoice.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
