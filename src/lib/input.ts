import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { CliUsageError } from './errors.js';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

const parseContent = (raw: string, filePath?: string): unknown => {
  if (filePath && YAML_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return parseYaml(raw);
  }
  return JSON.parse(raw);
};

const readFile = (filePath: string): string => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    throw new CliUsageError(`File not found: ${filePath}`);
  }
};

/**
 * Parse JSON/YAML input from a file (`-` means stdin) or from piped stdin.
 * Problems with the input (missing file, unparsable content, nothing piped)
 * are usage errors: callers run inside handleError, which reports them with
 * the usage exit code and, in JSON mode, the JSON error envelope.
 */
export const readInput = async (filePath?: string): Promise<unknown> => {
  if (filePath && filePath !== '-') {
    const raw = readFile(filePath);
    try {
      return parseContent(raw, filePath);
    } catch {
      const ext = path.extname(filePath).toLowerCase();
      const format = YAML_EXTENSIONS.has(ext) ? 'YAML' : 'JSON';
      throw new CliUsageError(`Invalid ${format} in file: ${filePath}`);
    }
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    // Stdin is parsed as YAML, which is a superset of JSON — piped JSON still
    // parses identically, but YAML documents are also accepted.
    try {
      return parseYaml(raw);
    } catch {
      throw new CliUsageError('Invalid YAML/JSON from stdin.');
    }
  }

  throw new CliUsageError('Provide input via the file flag or pipe YAML/JSON to stdin.');
};

/**
 * Read raw text from a file or stdin (no parsing). Used by `validate`, which
 * needs the original YAML string. Returns '' when no file and stdin is a TTY.
 */
export const readTextInput = async (filePath?: string): Promise<string> => {
  if (filePath && filePath !== '-') {
    return readFile(filePath);
  }
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return '';
};

/** @deprecated Use readInput instead */
export const readJsonInput = readInput;
