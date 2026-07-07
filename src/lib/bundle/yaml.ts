import { parse, stringify } from 'yaml';

/** Parse YAML with the default core schema. */
export const parseYamlDoc = (text: string): unknown => parse(text);

/**
 * Deterministic YAML serialization. Every bundle YAML file goes through this
 * seam so formatting choices remain stable across pack/unpack.
 */
export const stringifyYamlDoc = (value: unknown): string => {
  const text = stringify(value, {
    lineWidth: 0,
    blockQuote: 'literal',
    aliasDuplicateObjects: false,
  });
  return text.replace(/\n*$/, '\n');
};

/**
 * Rebuild an object with known keys first, unknown keys alphabetically after.
 * Undefined values are omitted; null is meaningful data and survives.
 */
export const orderKeys = (obj: Record<string, unknown>, knownOrder: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const known = new Set<string>(knownOrder);

  for (const key of knownOrder) {
    if (key in obj && obj[key] !== undefined) out[key] = obj[key];
  }

  for (const key of Object.keys(obj).filter((key) => !known.has(key) && obj[key] !== undefined).sort()) {
    out[key] = obj[key];
  }

  return out;
};
