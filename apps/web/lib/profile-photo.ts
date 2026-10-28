// The rules for the signed-in user's own photo: where it is stored, which files are accepted and how it is cropped,
// plus the browser step that turns a picked file into a small square JPEG. The maths is pure so it can be tested.

export const PHOTO_BUCKET = "avatars";
export const PHOTO_SIZE = 512;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Where a user's own photo lives in the avatars bucket. */
export function photoPathFor(userId: string) {
  return `${userId}/me`;
}

/** Whether a stored path is the user's own photo path (the database enforces the same rule). */
export function isOwnPhotoPath(userId: string, path: string | null | undefined) {
  return path == null || path === photoPathFor(userId);
}

/** The centred square to cut from an image of this size. */
export function centreCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** Cuts the centre square of a picked image and scales it to a 512px JPEG. Throws a plain message on failure. */
export async function squareJpeg(file: File): Promise<Blob> {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read.");
  }
  const { sx, sy, side } = centreCrop(bitmap.width, bitmap.height);
  const size = Math.min(PHOTO_SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That image could not be processed.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("That image could not be processed.");
  if (blob.size > PHOTO_MAX_BYTES) throw new Error("That image is too large.");
  return blob;
}
