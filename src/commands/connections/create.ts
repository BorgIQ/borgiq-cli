import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { ApiError } from '../../client/errors.js';
import { prompt, promptRequired } from '../../lib/prompt.js';
import { encryptWorkspaceData, getWorkspacePublicKey } from '../../lib/crypto.js';
import { promptFromSchema } from '../../lib/schemaPrompt.js';
import { resolveWebUrl } from '../../lib/webUrl.js';
import { openUrl } from '../../lib/openUrl.js';
import { readInput } from '../../lib/input.js';
import type { BIQConnectionFormData, BIQConnectionMetadata } from '../../client/types.js';

interface CreateOptions {
  key?: string;
  type?: string;
  description?: string;
  exposureMode?: string;
  inputsFile?: string;
  secretInputsFile?: string;
  userManagedOptionsFile?: string;
  webUrl?: string;
  timeout?: string;
}

export const connectionsCreate = async (options: CreateOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const isTty = process.stdin.isTTY;

    const key = options.key || (isTty ? await promptRequired('Connection key') : undefined);
    if (!key) {
      process.stderr.write('Error: --key is required when not running interactively.\n');
      process.exit(1);
    }

    const type = options.type || (isTty ? await promptRequired('Connection type (e.g. generic-api-key, github-oauth2)') : undefined);
    if (!type) {
      process.stderr.write('Error: --type is required when not running interactively.\n');
      process.exit(1);
    }

    const description = options.description ?? (isTty ? await prompt('Description (optional)') : undefined);
    const exposureMode = options.exposureMode || 'HttpOnly';
    if (exposureMode !== 'HttpOnly' && exposureMode !== 'Protected') {
      process.stderr.write(`Error: --exposure-mode must be 'HttpOnly' or 'Protected', got '${exposureMode}'.\n`);
      process.exit(1);
    }

    // Fetch form data to learn authType and schemas.
    let formData: BIQConnectionFormData;
    try {
      formData = await client.getConnectionFormData(ctx.org, ctx.workspace, type);
    } catch (err) {
      process.stderr.write(`Error: Could not load form data for connection type '${type}'. Is the type name correct?\n`);
      throw err;
    }

    if (formData.authType === 'oauth2') {
      await handleOauth2Create(client, ctx, globalOpts, { key, type, webUrl: options.webUrl, timeout: options.timeout });
      return;
    }

    // Non-OAuth2 path — collect inputs/secretInputs, encrypt, POST multipart.
    const inputs = await collectFields(formData.inputsJsonSchema, options.inputsFile, isTty, false);
    const secretInputs = await collectFields(formData.secretInputsJsonSchema, options.secretInputsFile, isTty, true);
    const userManagedOptionsInputs = formData.hasBorgIQManagedOptions
      ? {}
      : await collectFields(formData.userManagedOptionsJsonSchema, options.userManagedOptionsFile, isTty, true);

    const publicData = JSON.stringify({ inputs });
    const secretPayload = JSON.stringify({ secretInputs, userManagedOptionsInputs, auth: {} });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Encrypting connection secrets with workspace public key...\n');
    }
    const publicKey = await getWorkspacePublicKey(client, ctx.org, ctx.workspace);
    const { encryptedData, encryptedSymmetricKey, iv } = await encryptWorkspaceData(publicKey, secretPayload);

    const form = new FormData();
    form.append('key', key);
    if (description) form.append('description', description);
    form.append('type', type);
    form.append('exposureMode', exposureMode);
    form.append('data', publicData);
    form.append('metadata', '[]');
    form.append('encryptedKey', new Blob([encryptedSymmetricKey]));
    form.append('iv', new Blob([iv]));
    form.append('encryptedData', new Blob([encryptedData]));

    const connection = await client.createConnectionMultipart(ctx.org, ctx.workspace, form);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Connection created: ${connection.key} (${connection.id})\n`);
    }
    output(connection, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

const collectFields = async (
  schema: BIQConnectionFormData['inputsJsonSchema'] | undefined,
  filePath: string | undefined,
  isTty: boolean,
  isSecret: boolean,
): Promise<Record<string, unknown>> => {
  if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
    return {};
  }
  if (filePath) {
    const parsed = await readInput(filePath);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Expected an object in ${filePath}, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
    }
    return parsed as Record<string, unknown>;
  }
  if (!isTty) {
    process.stderr.write(`Error: Provide ${isSecret ? '--secret-inputs-file' : '--inputs-file'} when not running interactively.\n`);
    process.exit(1);
  }
  return promptFromSchema(schema, isSecret);
};

const handleOauth2Create = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  globalOpts: GlobalOptions,
  params: { key: string; type: string; webUrl?: string; timeout?: string },
): Promise<void> => {
  const webUrl = resolveWebUrl(params.webUrl, ctx.apiUrl);
  const qs = new URLSearchParams({ type: params.type, key: params.key });
  const target = `${webUrl}/orgs/${ctx.org}/workspaces/${ctx.workspace}/connections/new?${qs.toString()}`;

  if (!globalOpts.json && process.stderr.isTTY) {
    process.stderr.write(`OAuth2 connections must be created via the web app.\n`);
    process.stderr.write(`Opening ${target}\n`);
    process.stderr.write('Complete the connection in your browser. Waiting for it to appear...\n');
  }
  openUrl(target);

  const timeoutSec = params.timeout ? parseInt(params.timeout, 10) : 300;
  const connection = await pollForConnection(client, ctx, globalOpts, params.key, timeoutSec);
  if (!connection) {
    process.stderr.write(`Error: Timed out after ${timeoutSec}s waiting for connection '${params.key}' to appear.\n`);
    process.exit(1);
  }

  if (!globalOpts.json && process.stderr.isTTY) {
    process.stderr.write(`Connection created: ${connection.key} (${connection.id})\n`);
  }
  output(connection, globalOpts);
};

const pollForConnection = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  globalOpts: GlobalOptions,
  key: string,
  timeoutSec: number,
): Promise<BIQConnectionMetadata | null> => {
  const deadline = Date.now() + timeoutSec * 1000;
  const verboseErrors = !globalOpts.json && process.stderr.isTTY;

  while (Date.now() < deadline) {
    try {
      const keys = await client.listConnectionKeys(ctx.org, ctx.workspace, key);
      if (keys.keys.some((k) => k.key === key)) {
        const list = await client.listConnections(ctx.org, ctx.workspace, { search: key, pageSize: 20 });
        const record = list.data.find((c) => c.key === key);
        if (record) return record;
      }
    } catch (err) {
      // Fatal auth errors — rethrow so the user sees them via handleError.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        throw err;
      }
      // Transient failures (502, network blip, rate limit) should not kill
      // a 5-minute wait. Log and keep polling until the deadline.
      if (verboseErrors) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Transient error during poll, retrying: ${msg}\n`);
      }
    }
    await sleep(3000);
  }
  return null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
