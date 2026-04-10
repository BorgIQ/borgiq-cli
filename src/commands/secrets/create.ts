import fs from 'node:fs';

import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { prompt, promptChoice, promptRequired, promptSecret } from '../../lib/prompt.js';
import { encryptWorkspaceData, getWorkspacePublicKey } from '../../lib/crypto.js';
import { readInput } from '../../lib/input.js';

/**
 * Secret types the CLI can create. Excludes:
 * - OAuth2 variants (oauth1, oauth2, smtpOauth2, smtpOauth2Token) — require
 *   the web flow.
 * - imapPlain / smtpPlain / smtpOauth2 — marked @deprecated in the platform.
 */
const CREATABLE_SECRET_TYPES = [
  'plainText',
  'json',
  'yaml',
  'jwt',
  'basic',
  'apiKey',
  'bearer',
  'awsRoleBased',
  'custom',
] as const;

type SecretType = typeof CREATABLE_SECRET_TYPES[number];

const SINGLE_STRING_TYPES = new Set<SecretType>(['plainText', 'jwt', 'apiKey', 'bearer']);
const STRUCTURED_TEXT_TYPES = new Set<SecretType>(['json', 'yaml']);

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
    const exposureMode = options.exposureMode || 'HttpOnly';
    if (exposureMode !== 'HttpOnly' && exposureMode !== 'Protected') {
      throw new CliUsageError(`--exposure-mode must be 'HttpOnly' or 'Protected', got '${exposureMode}'.`);
    }

    const plaintext = await buildPlaintext(type, options, client, ctx, isTty);

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

const buildPlaintext = async (
  type: SecretType,
  options: CreateOptions,
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  isTty: boolean,
): Promise<string> => {
  // Single-string types: the payload is the raw string, no wrapping object.
  if (SINGLE_STRING_TYPES.has(type)) {
    if (options.data !== undefined) return options.data;
    if (options.dataFile) return fs.readFileSync(options.dataFile, 'utf-8').replace(/\n$/, '');
    if (!isTty) {
      throw new CliUsageError(`--data or --data-file is required for '${type}' secrets when not running interactively.`);
    }
    return promptSecret(`Secret value (${type})`);
  }

  // Structured text: accept JSON or YAML and forward as a JSON string.
  if (STRUCTURED_TEXT_TYPES.has(type)) {
    if (options.data !== undefined) return options.data;
    if (options.dataFile) return JSON.stringify(await readInput(options.dataFile));
    if (!isTty) return JSON.stringify(await readInput());
    throw new CliUsageError(`'${type}' secrets require --data-file or piped input.`);
  }

  // awsRoleBased needs interactive lookup of account id + external id.
  if (type === 'awsRoleBased') {
    if (options.dataFile) return JSON.stringify(await readInput(options.dataFile));
    if (!isTty) {
      throw new CliUsageError('awsRoleBased secrets require --data-file when not running interactively.');
    }
    const roleData = await client.getAwsRoleData(ctx.org, ctx.workspace);
    process.stderr.write('Configure your AWS trust policy with:\n');
    process.stderr.write(`  Principal AWS account: ${roleData.awsAccountId}\n`);
    process.stderr.write(`  External ID:           ${roleData.externalId}\n`);
    const roleArn = await promptRequired('Your AWS role ARN');
    return JSON.stringify({ roleArn });
  }

  // Structured multi-field types — interactive map, or --data-file as escape hatch.
  if (options.dataFile) return JSON.stringify(await readInput(options.dataFile));
  if (!isTty) return JSON.stringify(await readInput());

  switch (type) {
    case 'basic': {
      const username = await promptRequired('Username');
      const password = await promptSecret('Password');
      return JSON.stringify({ username, password });
    }
    case 'custom':
      throw new CliUsageError("'custom' secrets require --data-file with a JSON/YAML payload.");
  }

  // Exhaustive fallback — unreachable if CREATABLE_SECRET_TYPES is kept in sync.
  throw new Error(`Unhandled secret type: ${type as string}`);
};
