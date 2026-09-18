/**
 * App actor thumbnails (AppTriggerActor / ReactAppTriggerActor): the image formats and limits the
 * platform accepts, and the conversions between image bytes and the inline `{ dataUrl }` form the
 * actor routes and the canvas export use.
 *
 * The limits mirror `packages/types/src/actorThumbnail.ts` in borgiq-platform, but the API is
 * the authority: they only feed best-effort warnings, never a refusal. The CLI never resizes or
 * re-encodes an image.
 */

/** Hard cap on a stored thumbnail. */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** Width the web editor downscales to. Advisory here: the API does not check dimensions. */
export const THUMBNAIL_RECOMMENDED_WIDTH = 1280;

export const THUMBNAIL_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ThumbnailMimeType = typeof THUMBNAIL_MIME_TYPES[number];

export const THUMBNAIL_EXTENSIONS: Record<ThumbnailMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Base name of the externalized thumbnail inside an actor's bundle directory. */
export const THUMBNAIL_BASENAME = 'thumbnail';

const THUMBNAIL_FILE_PATTERN = /^thumbnail\.(png|jpg|jpeg|webp|gif)$/;
/** `actors/<category>/<folder>/<actorId>/thumbnail.<ext>` - the only place a thumbnail file lives. */
const THUMBNAIL_BUNDLE_PATH_PATTERN = /^actors\/[^/]+\/[^/]+\/[^/]+\/thumbnail\.(png|jpg|jpeg|webp|gif)$/;
const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i;

export class ThumbnailImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThumbnailImageError';
  }
}

/** A file name an actor's `thumbnail:` marker may point at: `thumbnail.png`, `thumbnail.webp`, … */
export const isThumbnailFileName = (name: string): boolean => THUMBNAIL_FILE_PATTERN.test(name);

/** True for a bundle-relative path that is an actor's externalized thumbnail. */
export const isThumbnailBundlePath = (bundlePath: string): boolean => THUMBNAIL_BUNDLE_PATH_PATTERN.test(bundlePath);

export const thumbnailFileName = (mimeType: ThumbnailMimeType): string =>
  `${THUMBNAIL_BASENAME}.${THUMBNAIL_EXTENSIONS[mimeType]}`;

export const isThumbnailMimeType = (value: string): value is ThumbnailMimeType =>
  (THUMBNAIL_MIME_TYPES as readonly string[]).includes(value);

/**
 * Detect an image's type from its leading bytes - the same signatures the platform checks, so a
 * file merely renamed to `.png` is flagged before it is sent. Null for anything else (SVG, HTML…).
 */
export const sniffThumbnailMimeType = (bytes: Uint8Array): ThumbnailMimeType | null => {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && ascii(bytes, 0, 3) === 'GIF' && (ascii(bytes, 3, 6) === '87a' || ascii(bytes, 3, 6) === '89a')) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
};

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

/**
 * What the API is likely to refuse about these bytes as a thumbnail, or undefined. Advisory only.
 * `label` names the image in the message (a file path, usually).
 */
export const thumbnailBytesProblem = (bytes: Uint8Array, label: string): string | undefined => {
  if (bytes.length === 0) return `${label} is empty.`;
  if (bytes.length > THUMBNAIL_MAX_BYTES) {
    return `${label} is ${formatMiB(bytes.length)}; a thumbnail may be at most ${formatMiB(THUMBNAIL_MAX_BYTES)}. `
      + `Capture it smaller (a ${THUMBNAIL_RECOMMENDED_WIDTH}px-wide viewport is plenty) or save it as .jpg or .webp.`;
  }
  if (!sniffThumbnailMimeType(bytes)) {
    return `${label} is not a PNG, JPEG, WebP, or GIF image (SVG is not accepted).`;
  }
  return undefined;
};

/**
 * Encode image bytes as the `data:` URL the actor routes accept. The type comes from the bytes,
 * falling back to the file extension; only when neither names an image is there no URL to send.
 * Anything else - size included - is left for the API to judge.
 */
export const thumbnailDataUrl = (bytes: Uint8Array, fileName: string): string => {
  const mimeType = sniffThumbnailMimeType(bytes) ?? mimeTypeFromExtension(fileName);
  if (!mimeType) {
    throw new ThumbnailImageError(`${fileName} is not a PNG, JPEG, WebP, or GIF image.`);
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
};

const mimeTypeFromExtension = (fileName: string): ThumbnailMimeType | undefined => {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'jpeg') return 'image/jpeg';
  return (Object.keys(THUMBNAIL_EXTENSIONS) as ThumbnailMimeType[]).find((type) => THUMBNAIL_EXTENSIONS[type] === extension);
};

/**
 * Encode bytes as a data URL whatever they are. The bundle reader uses this so a bad file on disk
 * still reaches `validate`, which names it, instead of disappearing from the file map.
 */
export const anyBytesDataUrl = (bytes: Uint8Array): string =>
  `data:${sniffThumbnailMimeType(bytes) ?? 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`;

export interface DecodedDataUrl {
  mimeType: string;
  bytes: Buffer;
}

/** Split a base64 `data:` URL into its declared type and bytes; undefined when it is not one. */
export const decodeDataUrl = (dataUrl: string): DecodedDataUrl | undefined => {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return undefined;
  return { mimeType: match[1].toLowerCase(), bytes: Buffer.from(match[2], 'base64') };
};

const formatMiB = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
