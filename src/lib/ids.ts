import { monotonicFactory } from 'ulidx';
import * as crypto from 'node:crypto';

// Monotonic ULID factory shared across all generators so IDs minted in the
// same millisecond stay ordered.
export const monotonicUlid = monotonicFactory();

export abstract class Id {
  /** Generate 30 character length ID (4 (model prefix) + 26 (ulid)) to be used in postgres tables */
  static create(prefix: string, seedTime?: number): string {
    if (prefix.length !== 4) throw new Error('id prefix should be 4 char in length');
    return `${prefix}${this.ulid(seedTime)}`;
  }

  /** Generate a 30 character length random id (since ulid is predictable) that can add a prefix if needed */
  static createRandomId(prefix = ''): string {
    const bytes = crypto.randomBytes((30 - prefix.length) / 2);
    const id = bytes.toString('hex');
    return `${prefix}${id}`;
  }

  /** generate ulid. To be consistent across, we will convert all the alphabetic characters in the id to lowercase. */
  static ulid(seedTime?: number): string {
    return monotonicUlid(seedTime).toLowerCase();
  }

  /** get the regExp for verifying model id. remember ULID does not include the letters I, L, O, and U */
  static regex(prefix: string): RegExp {
    return new RegExp(`${prefix}[0123456789abcdefghjkmnpqrstvwxyz]{26}`);
  }

  /** get the regexString for the id only */
  static regexString(prefix: string): string {
    return `${prefix}[0123456789abcdefghjkmnpqrstvwxyz]{26}`;
  }

  /** Generate a random string of the given length for security */
  static generateRandomString(length: number, validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string {
    const randomValues = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += validChars.charAt(randomValues[i] % validChars.length);
    }
    return result;
  }

  /** Generate a short ID with prefix and 7 random lowercase alphanumeric characters (e.g., SPRT5d5gj2s) */
  static createShortId(prefix: string): string {
    return `${prefix}${this.generateRandomString(7, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  }
}

/**
 * Converts an actor name to a valid msgVar identifier.
 * - Trims whitespace
 * - Prefixes with underscore if starts with digit
 * - Removes invalid characters (keeps alphanumeric, underscore, dollar sign)
 * - Converts to lowercase
 * - Replaces spaces with underscores
 */
export function convertActorNameToMsgVar(name: string): string {
  let msgVar = name.trim();
  if (/^\d/.test(msgVar)) msgVar = '_' + msgVar;
  msgVar = msgVar.replace(/[^a-zA-Z0-9_$\s]/g, '').toLowerCase();
  msgVar = msgVar.replace(/\s+/g, '_');
  return msgVar;
}
