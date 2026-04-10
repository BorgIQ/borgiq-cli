import fs from 'node:fs';

import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { computeFileDigest, mimeTypeFromFileName, readStdinBytes } from '../../lib/fileMeta.js';
import type { BIQAssetUpdateBody } from '../../client/types.js';
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

    const body: BIQAssetUpdateBody = {};
    if (options.key !== undefined) body.key = options.key;
    if (options.description !== undefined) body.description = options.description;

    let data: string | undefined = options.data;
    if (!data && options.dataFile) {
      data = fs.readFileSync(options.dataFile, 'utf-8');
    }
    if (!data && !process.stdin.isTTY && !options.updateFile) {
      const raw = await readStdinBytes();
      if (raw.length > 0) data = Buffer.from(raw).toString('utf-8');
    }
    if (data !== undefined) body.data = data;

    let uploadPlan: { bytes: Uint8Array; fileName: string; mimeType: string; digest: ReturnType<typeof computeFileDigest> } | undefined;
    if (options.updateFile) {
      const { bytes, fileName } = await readFileInput(options.file, options.fileName);
      const digest = computeFileDigest(bytes);
      const mimeType = mimeTypeFromFileName(fileName);
      body.updateFile = true;
      body.file = { fileName, mimeType, sizeInBytes: digest.sizeInBytes };
      uploadPlan = { bytes, fileName, mimeType, digest };
    }

    if (Object.keys(body).length === 0) {
      throw new CliUsageError('At least one field must be provided to edit (--key, --description, --data, --data-file, or --update-file).');
    }

    const response = await client.updateAsset(ctx.org, ctx.workspace, id, body);

    if (uploadPlan) {
      if (!response.presignedUrl) {
        throw new Error('Server did not return a presigned URL for file update');
      }
      if (!response.asset.file?.id) {
        throw new Error('Server response is missing the updated file id');
      }
      await runUpload(client, ctx, globalOpts, response.presignedUrl, response.asset.file.id, uploadPlan.bytes, uploadPlan.fileName, uploadPlan.mimeType, uploadPlan.digest);
      const final = await client.getAsset(ctx.org, ctx.workspace, id);
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
