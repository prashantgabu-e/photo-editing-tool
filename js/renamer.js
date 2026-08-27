import { getExtensionForMime, sanitizeFilename } from "./utils.js";

export function buildOutputFilename(item, settings, index) {
  const extension = getExtensionForMime(settings.format);
  const originalName = item.file.name.replace(/\.[a-z0-9]+$/i, "");
  const safeBase = settings.sanitizeFilenames ? sanitizeFilename(originalName) : originalName;
  const mode = settings.renameMode;

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
  return `${normalized || "image"}.${extension}`;
}
