/**
 * Prepares pictures chosen by the author: big photos are shrunk and compressed so that
 * exported adventures stay small enough to send around.
 */

/** Longest side of a stored picture, in pixels. */
const MAX_SIDE = 1280;
/** Small pictures in a web format are stored untouched (keeps transparency and animation). */
const KEEP_BELOW_BYTES = 400_000;
const WEB_FORMATS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface PreparedImage {
  blob: Blob;
  extension: string;
}

/** Returns the picture ready for storing, or undefined when the file is not a picture. */
export async function prepareImage(file: Blob): Promise<PreparedImage | undefined> {
  if (file.type === 'image/svg+xml') return { blob: file, extension: 'svg' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }
  const side = Math.max(bitmap.width, bitmap.height);
  const extension = WEB_FORMATS[file.type];
  if (extension && side <= MAX_SIDE && file.size <= KEEP_BELOW_BYTES) {
    bitmap.close();
    return { blob: file, extension };
  }

  const scale = Math.min(1, MAX_SIDE / side);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  // JPEG has no transparency; see-through areas become white rather than black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? { blob, extension: 'jpg' } : undefined;
}

/** The first picture file in a paste or a drop, if there is one. */
export function imageFrom(data: DataTransfer | null): File | undefined {
  return [...(data?.files ?? [])].find((file) => file.type.startsWith('image/'));
}
