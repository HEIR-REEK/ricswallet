import crypto from 'node:crypto';
import { HDNodeWallet, Mnemonic } from 'ethers';

/**
 * OFFLINE CUSTODY KEY GENERATOR
 * Run locally on a trusted offline/developer machine (`npm run generate-xpub`), NEVER on a public server!
 *
 * 1. Save the 12-word Secret Recovery Phrase offline (import into Trust Wallet / MetaMask / Ledger to access funds).
 * 2. Paste ONLY the Watch-Only `DEPOSIT_WALLET_XPUB` into your Render Environment Variables.
 */
function main() {
  const entropy = crypto.randomBytes(16); // 128-bit entropy -> 12-word BIP-39 phrase
  const mnemonic = Mnemonic.fromEntropy(entropy);
  const accountNode = HDNodeWallet.fromPhrase(mnemonic.phrase, '', "m/44'/60'/0'/0");
  const neuteredNode = accountNode.neuter();

  console.log('\n=======================================================================');
  console.log(' RicsWallet — Offline Custody Wallet & Watch-Only XPUB Generator');
  console.log('=======================================================================\n');
  console.log('1) SECRET 12-WORD RECOVERY PHRASE (KEEP OFFLINE — NEVER PUT IN .ENV!):');
  console.log(`   ${mnemonic.phrase}\n`);
  console.log('2) WATCH-ONLY EXTENDED PUBLIC KEY (PASTE INTO RENDER ENV AS DEPOSIT_WALLET_XPUB):');
  console.log(`   DEPOSIT_WALLET_XPUB=${neuteredNode.extendedKey}\n`);
  console.log("3) FIRST 5 DERIVED BEP-20 DEPOSIT ADDRESSES (m/44'/60'/0'/0/{index}):");
  for (let i = 0; i < 5; i++) {
    console.log(`   Index #${i} (m/44'/60'/0'/0/${i}): ${neuteredNode.deriveChild(i).address}`);
  }
  console.log('\nVerify in Trust Wallet / MetaMask / Ledger that Account #0 matches Index #0 above.');
  console.log('=======================================================================\n');
}

main();
