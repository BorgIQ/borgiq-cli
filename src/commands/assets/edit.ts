import fs from 'node:fs';

import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { computeFileDigest, mimeTypeFromFileName, readStdinBytes } from '../../lib/fileMeta.js';
import type { BIQAssetUpdateBody, BIQAssetMetadata } from '../../client/types.js';
import { readFileInput, runUpload } from './create.js';

interface EditOptions {
  key?: string;
  description?: string;
  data?: string;
  dataFile?: string;
  file?: string;
  fileName?: string;
  updateFile?: boolean;
}

export const assetsEdit = async (id: string, options: EditOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    // The platform's PUT /assets/:id endpoint takes the same schema as POST
    // (full replacement, not a patch). Fetch the current asset metadata and
    // data so we can merge the user's overrides on top. There's no
    // GET /assets/:id, so walk pages of the list endpoint.
    const current = await findAssetById(client, ctx, id);
    if (!current) {
      throw new CliUsageError(`Asset ${id} not found in workspace.`);
    }

    const isFileType = current.type === 'file';

    let uploadPlan: { bytes: Uint8Array; fileName: string; mimeType: string; digest: ReturnType<typeof computeFileDigest> } | undefined;
    let body: BIQAssetUpdateBody;

    if (isFileType) {
      // Editing a file asset: either metadata-only (no new bytes) or replace
      // the underlying file via --update-file.
      if (options.data !== undefined || options.dataFile) {
        throw new CliUsageError(`--data/--data-file is only valid for text assets; use --update-file to replace the file bytes.`);
      }
      if (options.updateFile) {
        const { bytes, fileName } = await readFileInput(options.file, options.fileName);
        const digest = computeFileDigest(bytes);
        const mimeType = mimeTypeFromFileName(fileName);
        uploadPlan = { bytes, fileName, mimeType, digest };
        body = {
          type: 'file',
          key: options.key ?? current.key,
          description: options.description ?? current.description,
          file: { fileName, mimeType, sizeInBytes: digest.sizeInBytes },
          updateFile: true,
        };
      } else {
        // Metadata-only edit of a file asset. Don't send `file` — the server's
        // handleFileUpdateMiddleware sets it to undefined when updateFile is
        // not set, and sending a partial file object would fail validation.
        body = {
          type: 'file',
          key: options.key ?? current.key,
          description: options.description ?? current.description,
        } as BIQAssetUpdateBody;
      }
    } else {
      // Text asset. Fetch current data and merge with any user overrides.
      let data = options.data;
      if (data === undefined && options.dataFile) {
        data = fs.readFileSync(options.dataFile, 'utf-8');
      }
      if (data === undefined && !process.stdin.isTTY) {
        const raw = await readStdinBytes();
        if (raw.length > 0) data = Buffer.from(raw).toString('utf-8').replace(/\n$/, '');
      }
      if (data === undefined) {
        data = await client.getAssetData(ctx.org, ctx.workspace, id);
      }
      body = {
        type: current.type as 'plainText' | 'json' | 'yaml',
        key: options.key ?? current.key,
        description: options.description ?? current.description,
        data,
      };
    }

    const response = await client.updateAsset(ctx.org, ctx.workspace, id, body);

    if (uploadPlan) {
      if (!('presignedUrl' in response)) {
        throw new Error('Server did not return a presigned URL for file update');
      }
      if (!response.asset.file?.id) {
        throw new Error('Server response is missing the updated file id');
      }
      await runUpload(client, ctx, globalOpts, response.presignedUrl, response.asset.file.id, uploadPlan.bytes, uploadPlan.fileName, uploadPlan.mimeType, uploadPlan.digest);
      // The server has no GET /assets/:id endpoint, so synthesize the final
      // metadata from the PUT response plus the known-good upload status.
      const final: BIQAssetMetadata = {
        ...response.asset,
        file: response.asset.file ? {
          ...response.asset.file,
          status: 'upload_success',
          md5: uploadPlan.digest.md5,
          sha256: uploadPlan.digest.sha256,
        } : undefined,
      };
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Asset updated: ${final.key} (${final.id})\n`);
      }
      output(final, globalOpts);
      return;
    }

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Asset updated: ${response.asset.key} (${response.asset.id})\n`);
    }
    output(response.asset, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

const findAssetById = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  id: string,
): Promise<BIQAssetMetadata | undefined> => {
  const pageSize = 100;
  let page = 1;
  while (true) {
    const result = await client.listAssets(ctx.org, ctx.workspace, { page, pageSize });
    const found = result.data.find((a) => a.id === id);
    if (found) return found;
    if (result.data.length < pageSize) return undefined;
    page++;
  }
};
