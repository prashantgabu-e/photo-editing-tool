import picaFactory from "https://cdn.jsdelivr.net/npm/pica@9.0.1/+esm";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const pica = picaFactory();

function detectMimeType(file) {
  return file.type || "application/octet-stream";
}

async function getExifOrientation(file) {
  if (detectMimeType(file) !== "image/jpeg") {
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
      const length = view.getUint16(offset, false);
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

      offset += length - 8;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      offset += view.getUint16(offset, false);
    }
  }
  return 1;
}

function getTargetDimensions(sourceWidth, sourceHeight, settings) {
  const width = Number(settings.width || sourceWidth);
  const height = Number(settings.height || sourceHeight);
  const scale = Number(settings.scale || 100) / 100;

  if (settings.resizeMode === "width") {
    return { width, height: Math.round(sourceHeight * (width / sourceWidth)) };
  }
  if (settings.resizeMode === "height") {
    return { width: Math.round(sourceWidth * (height / sourceHeight)), height };
  }
  if (settings.resizeMode === "percentage") {
    return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
  }
  if (settings.resizeMode === "max") {
    const factor = Math.min(width / sourceWidth, height / sourceHeight);
    return { width: Math.max(1, Math.round(sourceWidth * factor)), height: Math.max(1, Math.round(sourceHeight * factor)) };
  }
  return { width, height };
}

function resolveAnchor(settings) {
  if (settings.cropAnchor === "top") return { x: 0.5, y: 0 };
  if (settings.cropAnchor === "bottom") return { x: 0.5, y: 1 };
  if (settings.cropAnchor === "left") return { x: 0, y: 0.5 };
  if (settings.cropAnchor === "right") return { x: 1, y: 0.5 };
  if (settings.cropAnchor === "focal") {
    return {
      x: clamp(Number(settings.focalX || 50) / 100, 0, 1),
      y: clamp(Number(settings.focalY || 50) / 100, 0, 1),
    };
  }
  return { x: 0.5, y: 0.5 };
}

function computeResizePlan(sourceWidth, sourceHeight, settings) {
  const target = getTargetDimensions(sourceWidth, sourceHeight, settings);
  const ratio = parseAspectRatio(
    settings.aspectRatio,
    settings.customRatioWidth,
    settings.customRatioHeight,
    sourceWidth,
    sourceHeight,
  );
  const anchor = resolveAnchor(settings);

  if (settings.preventEnlargement) {
    target.width = Math.min(target.width, sourceWidth);
    target.height = Math.min(target.height, sourceHeight);
  }

  if (settings.cropMode === "contain" || settings.cropMode === "fit") {
    const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
    const drawWidth = Math.round(sourceWidth * scale);
    const drawHeight = Math.round(sourceHeight * scale);
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      destX: Math.round((target.width - drawWidth) * anchor.x),
      destY: Math.round((target.height - drawHeight) * anchor.y),
      drawWidth,
      drawHeight,
      needsPadding: true,
    };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (settings.cropMode === "fill") {
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      destX: 0,
      destY: 0,
      drawWidth: target.width,
      drawHeight: target.height,
      needsPadding: false,
    };
  }

  if (settings.cropMode === "exact") {
    cropWidth = Math.min(sourceWidth, target.width);
    cropHeight = Math.min(sourceHeight, target.height);
  } else if (sourceRatio > ratio) {
    cropWidth = Math.round(sourceHeight * ratio);
  } else {
    cropHeight = Math.round(sourceWidth / ratio);
  }

  const sourceX = Math.round((sourceWidth - cropWidth) * anchor.x);
  const sourceY = Math.round((sourceHeight - cropHeight) * anchor.y);
  return {
    targetWidth: target.width,
    targetHeight: target.height,
    sourceX: clamp(sourceX, 0, sourceWidth - cropWidth),
    sourceY: clamp(sourceY, 0, sourceHeight - cropHeight),
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
    destX: 0,
    destY: 0,
    drawWidth: target.width,
    drawHeight: target.height,
    needsPadding: false,
  };
}

function applyOrientationTransform(ctx, orientation, width, height) {
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }
}

function fillBackground(ctx, width, height, settings) {
  let color = null;
  if (settings.paddingMode === "white") color = "#ffffff";
  if (settings.paddingMode === "black") color = "#000000";
  if (settings.paddingMode === "custom") color = settings.backgroundColor || "#ffffff";
  if (settings.format === "image/jpeg" && !color) color = settings.backgroundColor || "#ffffff";
  if (!color) return;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

async function canvasToBlob(canvas, mimeType, quality) {
  return canvas.convertToBlob({ type: mimeType, quality });
}

function getTargetBytes(settings) {
  const value = Number(settings.targetSizeValue || 500);
  return settings.targetSizeUnit === "MB" ? value * 1024 * 1024 : value * 1024;
}

async function encodeCanvas(canvas, settings) {
  const mimeType = settings.format;
  const baseQuality = clamp(Number(settings.quality || 85) / 100, 0.35, 1);

  if (mimeType === "image/png" || settings.targetSizeEnabled !== "on") {
    return canvasToBlob(canvas, mimeType, mimeType === "image/png" ? undefined : baseQuality);
  }

  let blob = await canvasToBlob(canvas, mimeType, baseQuality);
  let quality = baseQuality;
  let count = 0;
  const targetBytes = getTargetBytes(settings);

  while (blob.size > targetBytes && quality > 0.35 && count < 7) {
    quality = Math.max(0.35, quality - 0.08);
    blob = await canvasToBlob(canvas, mimeType, quality);
    count += 1;
  }

  return blob;
}

async function processImage(file, settings) {
  const orientation = await getExifOrientation(file);
  const bitmap = await createImageBitmap(file);
  const swapped = [5, 6, 7, 8].includes(orientation);
  const normalizedCanvas = new OffscreenCanvas(swapped ? bitmap.height : bitmap.width, swapped ? bitmap.width : bitmap.height);
  const normalizedContext = normalizedCanvas.getContext("2d", { alpha: true });
  applyOrientationTransform(normalizedContext, orientation, normalizedCanvas.width, normalizedCanvas.height);
  normalizedContext.drawImage(bitmap, 0, 0);
  bitmap.close();

  const plan = computeResizePlan(normalizedCanvas.width, normalizedCanvas.height, settings);
  const croppedCanvas = new OffscreenCanvas(plan.sourceWidth, plan.sourceHeight);
  const cropContext = croppedCanvas.getContext("2d", { alpha: true });
  cropContext.drawImage(
    normalizedCanvas,
    plan.sourceX,
    plan.sourceY,
    plan.sourceWidth,
    plan.sourceHeight,
    0,
    0,
    plan.sourceWidth,
    plan.sourceHeight,
  );

  const resizedCanvas = new OffscreenCanvas(plan.drawWidth, plan.drawHeight);
  let usedCanvasFallback = false;
  try {
    await pica.resize(croppedCanvas, resizedCanvas, {
      alpha: true,
      unsharpAmount: 80,
      unsharpRadius: 0.6,
      unsharpThreshold: 1,
    });
  } catch (error) {
    if (!isCanvasReadBlockedError(error)) {
      throw error;
    }

    const resizeContext = resizedCanvas.getContext("2d", { alpha: true });
    resizeContext.imageSmoothingEnabled = true;
    resizeContext.imageSmoothingQuality = "high";
    resizeContext.drawImage(croppedCanvas, 0, 0, plan.drawWidth, plan.drawHeight);
    usedCanvasFallback = true;
  }

  const outputCanvas = new OffscreenCanvas(plan.targetWidth, plan.targetHeight);
  const ctx = outputCanvas.getContext("2d", { alpha: true });
  if (plan.needsPadding) {
    fillBackground(ctx, plan.targetWidth, plan.targetHeight, settings);
  }
  ctx.drawImage(resizedCanvas, plan.destX, plan.destY, plan.drawWidth, plan.drawHeight);

  const blob = await encodeCanvas(outputCanvas, settings);
  return {
    blob,
    width: outputCanvas.width,
    height: outputCanvas.height,
    warnings: buildWarnings(settings, usedCanvasFallback),
  };
}

self.onmessage = async (event) => {
  if (event.data.type !== "process") {
    return;
  }

  try {
    const result = await processImage(event.data.file, event.data.settings);
    self.postMessage({ type: "done", result });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message || "Image processing failed." });
  }
};

function buildWarnings(settings, usedCanvasFallback) {
  const warnings = [];
  if (settings.metadataMode === "keep") {
    warnings.push("Most browsers strip metadata during export.");
  }
  if (usedCanvasFallback) {
    warnings.push("Pica was unavailable in this browser context, so high-quality canvas scaling was used instead.");
  }
  return warnings;
}

function isCanvasReadBlockedError(error) {
  const message = error?.message || "";
  return /cannot use getimagedata on canvas/i.test(message)
    || /fingerprinting protection/i.test(message)
    || /operation is insecure/i.test(message);
}

function parseAspectRatio(aspectRatio, customWidth, customHeight, originalWidth, originalHeight) {
  if (aspectRatio === "original") {
    return originalWidth / originalHeight;
  }
  if (aspectRatio === "custom") {
    return Number(customWidth) / Number(customHeight);
  }
  const [width, height] = aspectRatio.split(":").map(Number);
  return width / height;
}
