import { createHash } from 'node:crypto';
import path from 'node:path';

/** Small mime-type lookup. Anything unknown falls back to application/octet-stream. */
const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};

/** Guess a mime type from a filename's extension. Returns application/octet-stream if unknown. */
export const mimeTypeFromFileName = (fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
};

export interface FileDigest {
  md5: string;
  sha256: string;
  sizeInBytes: number;
}

/** Compute md5, sha256 (hex), and size of a buffer. Matches what the server expects on updateUpload. */
export const computeFileDigest = (bytes: Uint8Array): FileDigest => {
  const buf = Buffer.from(bytes);
  return {
    md5: createHash('md5').update(buf).digest('hex'),
    sha256: createHash('sha256').update(buf).digest('hex'),
    sizeInBytes: buf.length,
  };
};

/** Read all bytes from stdin. Caller must check that stdin is not a TTY first. */
export const readStdinBytes = async (): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};
