import type { BIQJsonSchemaLike, BIQJsonSchemaProperty } from '../client/types.js';
import { prompt, promptChoice, promptConfirm, promptSecret } from './prompt.js';

export class UnsupportedSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSchemaError';
  }
}

/**
 * Walk a flat object schema and prompt the user interactively for each property.
 * Throws UnsupportedSchemaError if the schema is not a flat object of leaf types.
 *
 * Supported leaf types: string (with optional enum), number, integer, boolean.
 * Nested objects, arrays, oneOf/anyOf, etc. are not supported and will throw.
 *
 * @param useSecretPrompts When true, all string fields use promptSecret (hidden echo).
 *                        Used for secretInputsJsonSchema. Individual fields can also opt in
 *                        via writeOnly:true or format:'password'.
 */
export const promptFromSchema = async (
  schema: BIQJsonSchemaLike | undefined,
  useSecretPrompts = false,
): Promise<Record<string, unknown>> => {
  if (!schema || !schema.properties) return {};
  if (schema.type && schema.type !== 'object') {
    throw new UnsupportedSchemaError(`Expected object schema, got '${schema.type}'. Provide an input file instead.`);
  }

  const required = new Set(schema.required || []);
  const result: Record<string, unknown> = {};

  for (const [name, prop] of Object.entries(schema.properties)) {
    const label = prop.title || name;
    const isRequired = required.has(name);
    const suffix = isRequired ? '' : ' (optional)';
    const question = `${label}${suffix}`;
    const defaultValue = prop.default !== undefined ? String(prop.default) : undefined;
    const isSecret = useSecretPrompts || prop.writeOnly === true || prop.format === 'password';

    const value = await promptField(prop, question, defaultValue, isSecret);
    if (value !== undefined) result[name] = value;
    else if (isRequired) throw new Error(`Required field '${name}' was not provided`);
  }

  return result;
};

const promptField = async (prop: BIQJsonSchemaProperty, question: string, defaultValue: string | undefined, isSecret: boolean): Promise<unknown> => {
  const type = prop.type || 'string';

  if (prop.enum && prop.enum.length > 0) {
    const choices = prop.enum.map((v) => ({ label: String(v), value: String(v) }));
    return promptChoice(question, choices);
  }

  switch (type) {
    case 'string': {
      const raw = isSecret ? await promptSecret(question) : await prompt(question, defaultValue);
      return raw || undefined;
    }
    case 'number':
    case 'integer': {
      const raw = await prompt(question, defaultValue);
      if (!raw) return undefined;
      const n = type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
      if (Number.isNaN(n)) throw new Error(`Invalid number for '${question}': ${raw}`);
      return n;
    }
    case 'boolean': {
      return promptConfirm(question, prop.default === true);
    }
  }
};
