import { getAddress, HDNodeVoidWallet, HDNodeWallet } from 'ethers';

export interface DerivedDepositAddress {
  address: string;
  addressLower: string;
  derivationIndex: number;
  derivationPath: string;
}

/**
 * Watch-only BIP-44 Public Key Address Derivation Service.
 *
 * Security invariants (Build Guide Pages 1 & 4):
 *  1. Never accepts an extended private key (xprv) or mnemonic.
 *  2. Uses a neutered account-level extended public key (xpub at m/44'/60'/0'/0)
 *     to derive deterministic non-hardened child addresses: m/44'/60'/0'/0/{index}.
 *  3. Signing keys remain completely offline / outside the web application.
 */
export class HdAddressService {
  private readonly accountNode: HDNodeVoidWallet;

  constructor(xpub: string) {
    const trimmed = xpub.trim();
    if (!trimmed.startsWith('xpub')) {
      throw new Error(
        'SECURITY VIOLATION: DEPOSIT_WALLET_XPUB must be a public extended key starting with "xpub". Never load private keys (xprv) into the application backend.'
      );
    }

    const restored = HDNodeWallet.fromExtendedKey(trimmed);
    if (!(restored instanceof HDNodeVoidWallet)) {
      throw new Error(
        'SECURITY VIOLATION: Extended key contained private key material. Only neutered watch-only xpub keys are permitted.'
      );
    }

    this.accountNode = restored;
  }

  deriveAddress(index: number): DerivedDepositAddress {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid HD derivation index: ${index}`);
    }
    const child = this.accountNode.deriveChild(index);
    const checksumAddress = getAddress(child.address);
    return {
      address: checksumAddress,
      addressLower: checksumAddress.toLowerCase(),
      derivationIndex: index,
      derivationPath: `m/44'/60'/0'/0/${index}`,
    };
  }
}
