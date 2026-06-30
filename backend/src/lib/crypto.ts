import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config';

/**
 * AES-256-GCM encryption for the Wildberries API key at rest.
 * The key never leaves the backend in plaintext and is stored only as
 * ciphertext + iv + authTag (see DECISIONS.md D-0003).
 */

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12); // 96-bit nonce recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    config.encryptionKey,
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

/** Masked tail for display, e.g. "…aB3x". Never expose the full key. */
export function maskTail(secret: string): string {
  const tail = secret.slice(-4);
  return `…${tail}`;
}
