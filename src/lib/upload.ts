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

  const response = await fetch(presignedUrl.url, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`S3 upload failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
  }
};
