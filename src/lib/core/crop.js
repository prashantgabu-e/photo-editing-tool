import { clamp, parseAspectRatio } from "../utils";

export function computeResizePlan(sourceWidth, sourceHeight, settings) {
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
    const fittedWidth = Math.round(sourceWidth * scale);
    const fittedHeight = Math.round(sourceHeight * scale);

    return {
      targetWidth: target.width,
      targetHeight: target.height,
      drawWidth: fittedWidth,
      drawHeight: fittedHeight,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      destX: Math.round((target.width - fittedWidth) * anchor.x),
      destY: Math.round((target.height - fittedHeight) * anchor.y),
      needsPadding: true,
    };
  }

  if (settings.cropMode === "fill") {
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      drawWidth: target.width,
      drawHeight: target.height,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      destX: 0,
      destY: 0,
      needsPadding: false,
    };
  }

  if (settings.cropMode === "exact") {
    const cropWidth = Math.min(sourceWidth, target.width);
    const cropHeight = Math.min(sourceHeight, target.height);
    const sourceX = Math.round((sourceWidth - cropWidth) * anchor.x);
    const sourceY = Math.round((sourceHeight - cropHeight) * anchor.y);
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      drawWidth: target.width,
      drawHeight: target.height,
      sourceX,
      sourceY,
      sourceWidth: cropWidth,
      sourceHeight: cropHeight,
      destX: 0,
      destY: 0,
      needsPadding: false,
    };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceRatio > ratio) {
    cropWidth = Math.round(sourceHeight * ratio);
  } else {
    cropHeight = Math.round(sourceWidth / ratio);
  }

  const maxSourceX = sourceWidth - cropWidth;
  const maxSourceY = sourceHeight - cropHeight;
  const sourceX = Math.round(clamp(maxSourceX * anchor.x, 0, maxSourceX));
  const sourceY = Math.round(clamp(maxSourceY * anchor.y, 0, maxSourceY));

  return {
    targetWidth: target.width,
    targetHeight: target.height,
    drawWidth: target.width,
    drawHeight: target.height,
    sourceX,
    sourceY,
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
    destX: 0,
    destY: 0,
    needsPadding: false,
  };
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

export function getTargetDimensions(sourceWidth, sourceHeight, settings) {
  const width = Number(settings.width || sourceWidth);
  const height = Number(settings.height || sourceHeight);
  const scale = Number(settings.scale || 100) / 100;

  if (settings.resizeMode === "width") {
    return {
      width,
      height: Math.round(sourceHeight * (width / sourceWidth)),
    };
  }

  if (settings.resizeMode === "height") {
    return {
      width: Math.round(sourceWidth * (height / sourceHeight)),
      height,
    };
  }

  if (settings.resizeMode === "percentage") {
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }

  if (settings.resizeMode === "max") {
    const factor = Math.min(width / sourceWidth, height / sourceHeight);
    return {
      width: Math.max(1, Math.round(sourceWidth * factor)),
      height: Math.max(1, Math.round(sourceHeight * factor)),
    };
  }

  return { width, height };
}
