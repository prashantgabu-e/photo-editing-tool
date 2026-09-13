import { getExtensionForMime, getSupportedImageMime, sanitizeFilename } from "../utils";
import type { QueueItem, Settings } from "../../types";

export function buildOutputFilename(item: QueueItem, settings: Settings, index: number) {
  const shouldCompress = settings.targetSizeEnabled === "on";
  const imageMime = !settings.formatEnabled && !shouldCompress
    ? getSupportedImageMime(item.mime)
    : settings.format === "original"
      ? "image/webp"
      : settings.format;
  const extension = item.mediaType === "video" ? "mp4" : getExtensionForMime(imageMime);
  const originalName = item.file.name.replace(/\.[a-z0-9]+$/i, "");
  const safeBase = settings.sanitizeFilenames ? sanitizeFilename(originalName) : originalName;
  const mode = settings.renameEnabled ? settings.renameMode : "keep";

  let baseName = safeBase;
  if (mode === "prefix") {
    baseName = `${settings.renameValueA || ""}${safeBase}`;
  } else if (mode === "suffix") {
    baseName = `${safeBase}${settings.renameValueB || ""}`;
  } else if (mode === "sequential") {
    const start = Number(settings.renameStart || 1);
    const padding = Number(settings.renamePadding || 3);
    const sequence = String(start + index).padStart(padding, "0");
    const pattern = settings.renameValueA || "product-{number}";
    baseName = pattern.replace("{number}", sequence);
  } else if (mode === "findReplace") {
    baseName = safeBase.replaceAll(settings.renameValueA || "", settings.renameValueB || "");
  }

  const normalized = settings.sanitizeFilenames ? sanitizeFilename(baseName) : baseName.trim();
  return `${normalized || item.mediaType}.${extension}`;
}
