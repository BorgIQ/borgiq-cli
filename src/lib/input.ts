import fs from 'node:fs';

export const readJsonInput = async (filePath?: string): Promise<unknown> => {
  if (filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      return JSON.parse(raw);
    } catch {
      process.stderr.write(`Error: Invalid JSON in file: ${filePath}\n`);
      process.exit(1);
    }
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    try {
      return JSON.parse(raw);
    } catch {
      process.stderr.write('Error: Invalid JSON from stdin.\n');
      process.exit(1);
    }
  }

  process.stderr.write('Error: Provide input via --file <path> or pipe JSON to stdin.\n');
  process.exit(1);
};
