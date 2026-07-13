import type { BorgIQClient } from '../client/index.js';
import type { BIQCanvasLayout } from '../client/types.js';
import type { OutputOptions } from '../output/index.js';

export interface AutoLayoutOptions {
  autoLayout?: boolean;
  layoutSourceActorId?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (value: unknown, field: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const fieldValue = value[field];
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : undefined;
};

export const shouldAutoLayout = (options: AutoLayoutOptions): boolean =>
  Boolean(options.autoLayout || options.layoutSourceActorId?.length);

export const layoutSourceActorIds = (options: AutoLayoutOptions): string[] | undefined =>
  options.layoutSourceActorId?.length ? options.layoutSourceActorId : undefined;

export const canvasSlugOrIdFromCreateResult = (result: unknown, fallback?: unknown): string | undefined => {
  const resultMetadata = isRecord(result) ? result.metadata : undefined;
  const fallbackMetadata = isRecord(fallback) ? fallback.metadata : undefined;

  return stringField(result, 'slug')
    ?? stringField(result, 'id')
    ?? stringField(resultMetadata, 'slug')
    ?? stringField(resultMetadata, 'id')
    ?? stringField(fallback, 'slug')
    ?? stringField(fallback, 'id')
    ?? stringField(fallbackMetadata, 'slug')
    ?? stringField(fallbackMetadata, 'id');
};

export const applyCanvasAutoLayout = async (
  client: BorgIQClient,
  org: string,
  workspace: string,
  canvasSlugOrId: string,
  options: AutoLayoutOptions,
  outputOptions: OutputOptions,
): Promise<BIQCanvasLayout> => {
  const result = await client.layoutCanvas(org, workspace, canvasSlugOrId, {
    sourceActorIds: layoutSourceActorIds(options),
  });

  if (!outputOptions.json && process.stderr.isTTY) {
    const actorCount = Object.keys(result.actors || {}).length;
    process.stderr.write(`Layout applied: ${actorCount} actors repositioned.\n`);
  }

  return result;
};
