import type { Settings } from "../types";

export const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeFilename(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}

export function getExtensionForMime(mime: string) {
  return MIME_EXTENSION_MAP[mime] || "bin";
}

export function detectMimeType(file: File) {
  if (file.type) {
    return file.type;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    bmp: "image/bmp",
    gif: "image/gif",
    avif: "image/avif",
  };
  return byExtension[extension || ""] || "application/octet-stream";
}

export function parseAspectRatio(
  aspectRatio: Settings["aspectRatio"],
  customWidth: number,
  customHeight: number,
  originalWidth: number,
  originalHeight: number,
) {
  if (aspectRatio === "original") {
    return originalWidth / originalHeight;
  }

  if (aspectRatio === "custom") {
    return Number(customWidth) / Number(customHeight);
  }

  const [width, height] = aspectRatio.split(":").map(Number);
  return width / height;
}

export async function getExifOrientation(file: File) {
  const mime = detectMimeType(file);
  if (mime !== "image/jpeg") {
    return 1;
  }

  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  if (view.getUint16(0, false) !== 0xffd8) {
    return 1;
  }

  let offset = 2;
  while (offset < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1) {
      const segmentLength = view.getUint16(offset, false);
      offset += 2;
      if (view.getUint32(offset, false) !== 0x45786966) {
        break;
      }

      const tiffOffset = offset + 6;
      const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
      const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
      let ifdOffset = tiffOffset + firstIfdOffset;
      const entries = view.getUint16(ifdOffset, littleEndian);
      ifdOffset += 2;

      for (let index = 0; index < entries; index += 1) {
        const entryOffset = ifdOffset + index * 12;
        if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
          return view.getUint16(entryOffset + 8, littleEndian);
        }
      }

      offset += segmentLength - 8;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      offset += view.getUint16(offset, false);
    }
  }

  return 1;
}

export function getAutoConcurrency() {
  const cores = navigator.hardwareConcurrency || 4;
  return clamp(Math.floor(cores / 2), 1, 4);
}

export function buildTodayStamp() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, "0");
  const day = `${today.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function revokeUrl(url?: string) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}
