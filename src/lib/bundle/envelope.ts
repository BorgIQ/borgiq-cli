import { BundleError } from './types.js';
import type { CanvasExportDocument } from './types.js';
import { parseYamlDoc } from './yaml.js';

export interface ExportInput {
  document: CanvasExportDocument;
  exportErrors: unknown[];
}

/**
 * Accept either a raw `{ metadata, data }` YAML document or the `{ yaml,
 * errors }` JSON envelope returned by the current export endpoint.
 */
export const parseExportInput = (raw: string): ExportInput => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }

  if (isPlainObject(json) && typeof json.yaml === 'string') {
    if (!Array.isArray(json.errors)) {
      throw new BundleError('Canvas export envelope is malformed (expected `errors` to be an array).');
    }
    return {
      document: parseDocument(json.yaml),
      exportErrors: json.errors,
    };
  }

  return { document: parseDocument(raw), exportErrors: [] };
};

const parseDocument = (text: string): CanvasExportDocument => {
  const parsed = parseYamlDoc(text);
  if (!isPlainObject(parsed) || !isPlainObject(parsed.metadata) || !isPlainObject(parsed.data) || !isPlainObject(parsed.data.actors)) {
    throw new BundleError('Input is not a canvas export document (expected `metadata` and `data.actors` keys).');
  }
  return parsed as unknown as CanvasExportDocument;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
