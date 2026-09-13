import { clamp } from "../utils";

export async function encodeCanvas(canvas, settings, sourceMimeType = "image/png") {
  const targetBytes = getTargetSizeBytes(settings);
  const shouldCompress = settings.targetSizeEnabled === "on";
  const mimeType = !settings.formatEnabled && !shouldCompress
    ? resolveOriginalMimeType(sourceMimeType)
    : settings.format === "original"
      ? "image/webp"
      : settings.format;
  const quality = clamp(Number(settings.quality || 85) / 100, 0.35, 1);

  if (mimeType === "image/png" || !shouldCompress) {
    return canvasToBlob(canvas, mimeType, mimeType === "image/png" ? undefined : quality);
  }

  let currentQuality = quality;
  let blob = await canvasToBlob(canvas, mimeType, currentQuality);
  let iterations = 0;

  while (blob.size > targetBytes && currentQuality > 0.35 && iterations < 7) {
    currentQuality = Math.max(0.35, currentQuality - 0.08);
    blob = await canvasToBlob(canvas, mimeType, currentQuality);
    iterations += 1;
  }

  return blob;
}

function resolveOriginalMimeType(mimeType) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType) ? mimeType : "image/png";
}

async function canvasToBlob(canvas, mimeType, quality) {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode image."));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

function getTargetSizeBytes(settings) {
  const value = Number(settings.targetSizeValue || 500);
  const unit = settings.targetSizeUnit || "KB";
  return unit === "MB" ? value * 1024 * 1024 : value * 1024;
}
