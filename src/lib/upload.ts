import type { S3PresignedPost } from '../client/types.js';

/**
 * Upload a buffer to an S3 presigned POST URL using multipart form-data,
 * mirroring the web app's `uploadFileToS3` flow.
 */
export const uploadToPresignedUrl = async (
  presignedUrl: S3PresignedPost,
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<void> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(presignedUrl.fields)) {
    form.append(key, value);
  }
  form.append('file', new Blob([fileBytes], { type: mimeType }), fileName);

  // Do not set a Content-Type header manually — fetch derives
  // `multipart/form-data; boundary=...` from the FormData body; overriding
  // it would break the boundary and S3 would reject the signature.
  const response = await fetch(presignedUrl.url, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`S3 upload failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
  }
};

/**
 * Download bytes from a presigned URL.
 *
 * Deliberately a bare fetch with no Authorization header: the URL carries its own signature,
 * and sending our API token to the storage host would both leak it and break the signature.
 */
export const fetchPresignedUrlBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};
