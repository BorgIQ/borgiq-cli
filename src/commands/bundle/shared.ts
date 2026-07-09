import fs from 'node:fs';

import { BundleValidationError, assembleBundle } from '../../lib/bundle/assemble.js';
import type { AssembleResult } from '../../lib/bundle/assemble.js';
import { BUNDLE_AGENTS_MD, BUNDLE_GITIGNORE } from '../../lib/bundle/template.js';
import type { BundleFileMap, BundleIssue } from '../../lib/bundle/types.js';
import { CliUsageError } from '../../lib/errors.js';

export const BUNDLE_COMPANIONS: Readonly<BundleFileMap> = Object.freeze({
  'AGENTS.md': BUNDLE_AGENTS_MD,
  '.gitignore': BUNDLE_GITIGNORE,
});

export const readRawInput = async (file: string): Promise<string> => {
  if (file !== '-') return fs.readFileSync(file, 'utf-8');
  if (process.stdin.isTTY) {
    throw new CliUsageError("No input on stdin - pass a file path or pipe a document to '-'.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
};

export const reportIssues = (errors: BundleIssue[], warnings: BundleIssue[]): void => {
  for (const warning of warnings) process.stderr.write(`Warning: ${warning.path}: ${warning.message}\n`);
  for (const error of errors) process.stderr.write(`Error: ${error.path}: ${error.message}\n`);
};

export const assembleOrFail = (files: BundleFileMap, strict: boolean): AssembleResult => {
  let result: AssembleResult;
  try {
    result = assembleBundle(files);
  } catch (error) {
    if (error instanceof BundleValidationError) {
      reportIssues(error.errors, error.warnings);
      throw new CliUsageError(`Bundle validation failed with ${error.errors.length} error(s).`);
    }
    throw error;
  }

  reportIssues([], result.warnings);
  if (strict && result.warnings.length > 0) {
    throw new CliUsageError(`Bundle has ${result.warnings.length} warning(s) (strict mode).`);
  }
  return result;
};
