import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import type { BatchActorOperationsResponse } from '../../client/types.js';
import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { decodeDataUrl, thumbnailBytesProblem, thumbnailDataUrl, ThumbnailImageError } from '../../lib/bundle/thumbnail.js';
import { output } from '../../output/index.js';

interface ThumbnailSetOptions {
  editVersion?: string;
}

interface ThumbnailGetOptions {
  out?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseEditVersion = (value: string | undefined): number | undefined =>
  value ? parseInt(value, 10) : undefined;

/** The actor as the update returned it, when the API echoes it back. */
const appliedActor = (result: BatchActorOperationsResponse, actorId: string): Record<string, unknown> | undefined => {
  const applied = result.appliedOperations?.find((operation) => operation.actorId === actorId);
  return applied ? { editVersion: applied.newEditVersion, ...(isRecord(applied.actorData) ? { thumbnail: applied.actorData.thumbnail } : {}) } : undefined;
};

/**
 * Attach an image file as the actor's thumbnail. It is sent inline as `{ dataUrl }`; the API stores
 * it and keeps a file reference, so there is no separate upload step. The API decides whether the
 * image is acceptable - a likely refusal is only warned about.
 */
export const canvasActorsThumbnailSet = async (
  canvasSlugOrId: string,
  actorId: string,
  imagePath: string,
  options: ThumbnailSetOptions,
  command: Command,
): Promise<void> => {
  try {
    const globalOpts = command.optsWithGlobals() as GlobalOptions;
    const { client, ctx } = createClientWithContext(globalOpts);

    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
      throw new CliUsageError(`${imagePath} is not a file.`);
    }
    const bytes = fs.readFileSync(imagePath);
    const problem = thumbnailBytesProblem(bytes, path.basename(imagePath));
    if (problem) process.stderr.write(`Warning: ${problem}\n`);

    const dataUrl = thumbnailDataUrl(bytes, path.basename(imagePath));
    const result = await client.updateCanvasActor(ctx.org, ctx.workspace, canvasSlugOrId, actorId, { thumbnail: { dataUrl } }, parseEditVersion(options.editVersion));

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Thumbnail set on ${actorId} from ${imagePath}\n`);
    }
    output({ actorId, sizeInBytes: bytes.length, mimeType: decodeDataUrl(dataUrl)?.mimeType, ...appliedActor(result, actorId) }, globalOpts);
  } catch (error) {
    handleError(error instanceof ThumbnailImageError ? new CliUsageError(error.message) : error);
  }
};

export const canvasActorsThumbnailRemove = async (
  canvasSlugOrId: string,
  actorId: string,
  options: ThumbnailSetOptions,
  command: Command,
): Promise<void> => {
  try {
    const globalOpts = command.optsWithGlobals() as GlobalOptions;
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.updateCanvasActor(ctx.org, ctx.workspace, canvasSlugOrId, actorId, { thumbnail: null }, parseEditVersion(options.editVersion));

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Thumbnail removed from ${actorId}\n`);
    }
    output({ actorId, thumbnail: null, ...appliedActor(result, actorId) }, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

/**
 * Show whether the actor has a thumbnail, and with `--out` save the image. The base64 itself is
 * never printed - it is up to ~2.7 MB of noise in a terminal or an agent's context.
 */
export const canvasActorsThumbnailGet = async (
  canvasSlugOrId: string,
  actorId: string,
  options: ThumbnailGetOptions,
  command: Command,
): Promise<void> => {
  try {
    const globalOpts = command.optsWithGlobals() as GlobalOptions;
    const { client, ctx } = createClientWithContext(globalOpts);

    const actor = await client.getCanvasActor(ctx.org, ctx.workspace, canvasSlugOrId, actorId);
    const thumbnail = actor.thumbnail;
    if (!thumbnail) {
      if (options.out) throw new CliUsageError(`Actor ${actorId} has no thumbnail - nothing to write to ${options.out}.`);
      output({ actorId, thumbnail: null }, globalOpts);
      return;
    }

    const fileId = 'fileId' in thumbnail ? thumbnail.fileId : undefined;
    const dataUrl = 'dataUrl' in thumbnail
      ? thumbnail.dataUrl
      : (await client.getActorThumbnailData(ctx.org, ctx.workspace, canvasSlugOrId, thumbnail.fileId)).dataUrl;
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) throw new Error(`The API returned a thumbnail for ${actorId} that is not a base64 data URL.`);

    if (options.out) {
      fs.writeFileSync(options.out, decoded.bytes);
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Thumbnail written to ${options.out}\n`);
      }
    }
    output({ actorId, fileId, mimeType: decoded.mimeType, sizeInBytes: decoded.bytes.length, ...(options.out ? { path: options.out } : {}) }, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
