import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

const parseContent = (raw: string, filePath?: string): unknown => {
  if (filePath && YAML_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return parseYaml(raw);
  }
  return JSON.parse(raw);
};

export const readInput = async (filePath?: string): Promise<unknown> => {
  if (filePath && filePath !== '-') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      return parseContent(raw, filePath);
    } catch {
      const ext = path.extname(filePath).toLowerCase();
      const format = YAML_EXTENSIONS.has(ext) ? 'YAML' : 'JSON';
      process.stderr.write(`Error: Invalid ${format} in file: ${filePath}\n`);
      process.exit(1);
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
      process.stderr.write('Error: Invalid YAML/JSON from stdin.\n');
      process.exit(1);
    }
  }

  process.stderr.write('Error: Provide input via --file <path> or pipe YAML/JSON to stdin.\n');
  process.exit(1);
};

/**
 * Read raw text from a file or stdin (no parsing). Used by `validate`, which
 * needs the original YAML string. Returns '' when no file and stdin is a TTY.
 */
export const readTextInput = async (filePath?: string): Promise<string> => {
  if (filePath && filePath !== '-') {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      process.stderr.write(`Error: File not found: ${filePath}\n`);
      process.exit(1);
    }
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
