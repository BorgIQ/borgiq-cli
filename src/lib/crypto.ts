import { webcrypto } from 'node:crypto';

import type { BorgIQClient } from '../client/index.js';

type PublicCryptoKey = webcrypto.CryptoKey;

/** Result of encrypting data with a workspace public key for secret/connection creation. */
export interface WorkspaceEncryptionResult {
  /** The ciphertext, AES-GCM-encrypted. */
  encryptedData: Uint8Array;
  /** The AES-GCM symmetric key itself, encrypted with the workspace RSA public key. */
  encryptedSymmetricKey: Uint8Array;
  /** The 12-byte IV used for AES-GCM. */
  iv: Uint8Array;
}

/** Fetch the workspace public key and import it as a CryptoKey for RSA-OAEP encryption. */
export const getWorkspacePublicKey = async (client: BorgIQClient, org: string, workspace: string): Promise<PublicCryptoKey> => {
  const base64 = await client.getWorkspacePublicKey(org, workspace);
  const der = Buffer.from(base64, 'base64');
  try {
    return await webcrypto.subtle.importKey(
      'spki',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
  } catch (err) {
    // WebCrypto throws opaque DataError/OperationError on malformed keys.
    // Add context so the user knows the problem is an unexpected server response.
    throw new Error(`Failed to import workspace public key — server returned an unexpected format: ${(err as Error).message}`);
  }
};

/**
 * Encrypt a plaintext payload for secret/connection creation using the same scheme as the web app:
 * - Generate an AES-GCM-256 symmetric key and 12-byte IV
 * - Encrypt the plaintext with AES-GCM
 * - Encrypt the raw symmetric key bytes with RSA-OAEP using the workspace public key
 */
export const encryptWorkspaceData = async (publicKey: PublicCryptoKey, plaintext: string | Uint8Array): Promise<WorkspaceEncryptionResult> => {
  const symmetricKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  const plaintextBytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  const encryptedBuf = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, symmetricKey, plaintextBytes);

  const rawSymmetricKey = await webcrypto.subtle.exportKey('raw', symmetricKey);
  const encryptedSymmetricKeyBuf = await webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawSymmetricKey);

  return {
    encryptedData: new Uint8Array(encryptedBuf),
    encryptedSymmetricKey: new Uint8Array(encryptedSymmetricKeyBuf),
    iv,
  };
};
