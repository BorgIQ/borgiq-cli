import fs from 'node:fs';

import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { prompt, promptChoice, promptRequired, promptSecret } from '../../lib/prompt.js';
import { encryptWorkspaceData, getWorkspacePublicKey } from '../../lib/crypto.js';

/**
 * Secret types the platform allows creating. Most legacy types have been
 * deprecated; the server now only accepts plainText and jwt.
 * Matches BIQCreatableSecretTypes in packages/types/src/common.ts.
 */
const CREATABLE_SECRET_TYPES = ['plainText', 'jwt'] as const;

type SecretType = typeof CREATABLE_SECRET_TYPES[number];

interface CreateOptions {
  key?: string;
  type?: string;
  description?: string;
  exposureMode?: string;
  data?: string;
  dataFile?: string;
}

export const secretsCreate = async (options: CreateOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const isTty = process.stdin.isTTY;

    const key = options.key || (isTty ? await promptRequired('Secret key') : undefined);
    if (!key) {
      throw new CliUsageError('--key is required when not running interactively.');
    }

    let type = options.type as SecretType | undefined;
    if (!type) {
      if (isTty) {
        type = (await promptChoice('Secret type', CREATABLE_SECRET_TYPES.map((t) => ({ label: t, value: t })))) as SecretType;
      } else {
        throw new CliUsageError('--type is required when not running interactively.');
      }
    }
    if (!CREATABLE_SECRET_TYPES.includes(type)) {
      const isOauthType = type === 'oauth2' as string || type === 'smtpOauth2' as string || type === 'smtpOauth2Token' as string || type === 'oauth1' as string;
      const hint = isOauthType ? ' OAuth-based secrets must be created via the web app.' : '';
      throw new CliUsageError(`Invalid or unsupported secret type '${type}'. Creatable types: ${CREATABLE_SECRET_TYPES.join(', ')}.${hint}`);
    }

    const description = options.description ?? (isTty ? await prompt('Description (optional)') : undefined);
    const exposureMode = options.exposureMode || 'httpOnly';
    if (exposureMode !== 'httpOnly' && exposureMode !== 'exposed') {
      throw new CliUsageError(`--exposure-mode must be 'httpOnly' or 'exposed', got '${exposureMode}'.`);
    }

    const plaintext = await buildPlaintext(type, options, isTty);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Encrypting secret with workspace public key...\n');
    }
    const publicKey = await getWorkspacePublicKey(client, ctx.org, ctx.workspace);
    const { encryptedData, encryptedSymmetricKey, iv } = await encryptWorkspaceData(publicKey, plaintext);

    const form = new FormData();
    form.append('key', key);
    if (description) form.append('description', description);
    form.append('type', type);
    form.append('exposureMode', exposureMode);
    form.append('encryptedKey', new Blob([encryptedSymmetricKey]));
    form.append('iv', new Blob([iv]));
    form.append('data', new Blob([encryptedData]));

    const secret = await client.createSecretMultipart(ctx.org, ctx.workspace, form);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Secret created: ${secret.key} (${secret.id})\n`);
    }
    output(secret, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

/**
 * Build the plaintext payload to be encrypted. Both supported types
 * (plainText and jwt) are single-string secrets — the raw value is the
 * payload, with no wrapping object.
 */
const buildPlaintext = async (
  _type: SecretType,
  options: CreateOptions,
  isTty: boolean,
): Promise<string> => {
  if (options.data !== undefined) return options.data;
  if (options.dataFile) return fs.readFileSync(options.dataFile, 'utf-8').replace(/\n$/, '');
  if (!isTty) {
    throw new CliUsageError(`--data or --data-file is required for secrets when not running interactively.`);
  }
  return promptSecret('Secret value');
};
