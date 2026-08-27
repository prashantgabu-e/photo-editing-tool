import { clamp } from "./utils.js";

export async function encodeCanvas(canvas, settings) {
  const targetBytes = getTargetSizeBytes(settings);
  const mimeType = settings.format;
  const quality = clamp(Number(settings.quality || 85) / 100, 0.35, 1);

  if (mimeType === "image/png" || settings.targetSizeEnabled !== "on") {
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
