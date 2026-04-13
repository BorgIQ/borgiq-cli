import fs from 'node:fs';
import path from 'node:path';

import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { prompt, promptChoice, promptRequired } from '../../lib/prompt.js';
import { computeFileDigest, mimeTypeFromFileName, readStdinBytes } from '../../lib/fileMeta.js';
import { uploadToPresignedUrl } from '../../lib/upload.js';
import type { BIQAssetCreateBody, BIQAssetCreateResponse, BIQAssetType } from '../../client/types.js';

const ASSET_TYPES: BIQAssetType[] = ['plainText', 'json', 'yaml', 'file'];

interface CreateOptions {
  key?: string;
  type?: string;
  description?: string;
  data?: string;
  dataFile?: string;
  file?: string;
  fileName?: string;
}

export const assetsCreate = async (options: CreateOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const isTty = process.stdin.isTTY;

    const key = options.key || (isTty ? await promptRequired('Asset key') : undefined);
    if (!key) {
      throw new CliUsageError('--key is required when not running interactively.');
    }

    let type = options.type as BIQAssetType | undefined;
    if (!type) {
      if (isTty) {
        type = (await promptChoice('Asset type', ASSET_TYPES.map((t) => ({ label: t, value: t })))) as BIQAssetType;
      } else {
        throw new CliUsageError('--type is required when not running interactively.');
      }
    }
    if (!ASSET_TYPES.includes(type)) {
      throw new CliUsageError(`Invalid asset type '${type}'. Must be one of: ${ASSET_TYPES.join(', ')}`);
    }

    const description = options.description ?? (isTty ? await prompt('Description (optional)') : undefined);

    if (type === 'file') {
      await createFileAsset(client, ctx, globalOpts, { key, description, filePath: options.file, fileName: options.fileName });
      return;
    }

    // Text asset (plainText / json / yaml)
    let data = options.data;
    if (!data && options.dataFile) {
      data = readDataFile(options.dataFile);
    }
    if (!data && !process.stdin.isTTY) {
      data = Buffer.from(await readStdinBytes()).toString('utf-8').replace(/\n$/, '');
    }
    if (!data && isTty) {
      data = await promptRequired(`Data (${type})`);
    }
    if (!data) {
      throw new CliUsageError('--data, --data-file, or piped stdin is required for text assets.');
    }

    const body: BIQAssetCreateBody = { key, description, type, data };
    const response = await client.createAsset(ctx.org, ctx.workspace, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Asset created: ${response.asset.key} (${response.asset.id})\n`);
    }
    output(response.asset, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

const readDataFile = (filePath: string): string => {
  if (filePath === '-') {
    throw new CliUsageError('Use stdin piping directly (omit --data-file) to read data from stdin.');
  }
  return fs.readFileSync(filePath, 'utf-8');
};

interface CreateFileParams {
  key: string;
  description?: string;
  filePath?: string;
  fileName?: string;
}

export const createFileAsset = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  globalOpts: GlobalOptions,
  params: CreateFileParams,
): Promise<BIQAssetCreateResponse> => {
  const { bytes, fileName } = await readFileInput(params.filePath, params.fileName);
  const digest = computeFileDigest(bytes);
  const mimeType = mimeTypeFromFileName(fileName);

  const body: BIQAssetCreateBody = {
    key: params.key,
    description: params.description,
    type: 'file',
    file: { fileName, mimeType, sizeInBytes: digest.sizeInBytes },
  };

  if (!globalOpts.json && process.stderr.isTTY) {
    process.stderr.write(`Creating asset (${digest.sizeInBytes} bytes, ${mimeType})...\n`);
  }
  const response = await client.createAsset(ctx.org, ctx.workspace, body);
  if (!('presignedUrl' in response)) {
    throw new Error('Server did not return a presigned URL for file upload');
  }
  if (!response.asset.file?.id) {
    throw new Error('Server response is missing the created file id');
  }

  await runUpload(client, ctx, globalOpts, response.presignedUrl, response.asset.file.id, bytes, fileName, mimeType, digest);

  // The server has no GET /assets/:id endpoint, so synthesize the final
  // metadata from the POST response plus the known-good upload status.
  const final = {
    ...response.asset,
    file: response.asset.file ? {
      ...response.asset.file,
      status: 'upload_success',
      md5: digest.md5,
      sha256: digest.sha256,
    } : undefined,
  };
  if (!globalOpts.json && process.stderr.isTTY) {
    process.stderr.write(`Asset created: ${final.key} (${final.id})\n`);
  }
  output(final, globalOpts);
  return { asset: final };
};

export const readFileInput = async (filePath: string | undefined, overrideFileName: string | undefined): Promise<{ bytes: Uint8Array; fileName: string }> => {
  if (!filePath || filePath === '-') {
    if (process.stdin.isTTY) {
      throw new CliUsageError('Provide --file <path> or pipe file bytes via stdin (e.g. `cat foo.pdf | borgiq assets create --type file --file - --file-name foo.pdf`).');
    }
    const bytes = await readStdinBytes();
    if (!overrideFileName) {
      throw new CliUsageError('--file-name is required when piping file bytes from stdin.');
    }
    return { bytes, fileName: overrideFileName };
  }
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const fileName = overrideFileName || path.basename(filePath);
  return { bytes, fileName };
};

export const runUpload = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  globalOpts: GlobalOptions,
  presignedUrl: { url: string; fields: Record<string, string> },
  fileId: string,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  digest: { md5: string; sha256: string },
): Promise<void> => {
  try {
    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Uploading file to storage...\n');
    }
    await uploadToPresignedUrl(presignedUrl, bytes, fileName, mimeType);
  } catch (err) {
    // Best-effort status sync. If the sync call ALSO fails (e.g. token
    // expired mid-upload), log its message but re-throw the ORIGINAL S3
    // error — that's the root cause the user needs to see.
    try {
      await client.updateFileUpload(ctx.org, ctx.workspace, fileId, { status: 'upload_failure' });
    } catch (syncErr) {
      const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
      process.stderr.write(`Warning: failed to mark upload as failed: ${msg}\n`);
    }
    throw err;
  }

  try {
    await client.updateFileUpload(ctx.org, ctx.workspace, fileId, {
      status: 'upload_success',
      md5: digest.md5,
      sha256: digest.sha256,
    });
  } catch (err) {
    // The file is already in storage but the server doesn't know. The asset
    // is in an inconsistent state — tell the user what happened so they can
    // recover manually.
    process.stderr.write('Warning: file uploaded to storage but status sync failed. The asset may be in an inconsistent state; consider deleting and retrying.\n');
    throw err;
  }
};
