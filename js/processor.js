import { computeResizePlan } from "./crop.js";
import { encodeCanvas } from "./encoder.js";
import { highQualityResize } from "./resize.js";
import { getExifOrientation } from "./utils.js";

export async function processFile(file, settings) {
  const orientation = await getExifOrientation(file);
  const bitmap = await createImageBitmap(file);
  const normalizedCanvas = drawOrientedBitmap(bitmap, orientation);
  bitmap.close();

  const plan = computeResizePlan(normalizedCanvas.width, normalizedCanvas.height, settings);
  const croppedCanvas = drawSourceCrop(normalizedCanvas, plan);
  disposeCanvas(normalizedCanvas);

  const resizedCanvas = await resizeIntoOutputCanvas(croppedCanvas, plan, settings);
  if (croppedCanvas !== resizedCanvas) {
    disposeCanvas(croppedCanvas);
  }

  const blob = await encodeCanvas(resizedCanvas, settings);
  const output = {
    blob,
    width: resizedCanvas.width,
    height: resizedCanvas.height,
    warnings: collectWarnings(file, blob, settings),
  };
  disposeCanvas(resizedCanvas);
  return output;
}

function drawOrientedBitmap(bitmap, orientation) {
  const swapped = [5, 6, 7, 8].includes(orientation);
  const canvas = document.createElement("canvas");
  canvas.width = swapped ? bitmap.height : bitmap.width;
  canvas.height = swapped ? bitmap.width : bitmap.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  applyOrientationTransform(ctx, orientation, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function drawSourceCrop(canvas, plan) {
  const output = document.createElement("canvas");
  output.width = plan.sourceWidth;
  output.height = plan.sourceHeight;
  const ctx = output.getContext("2d", { alpha: true });
  ctx.drawImage(
    canvas,
    plan.sourceX,
    plan.sourceY,
    plan.sourceWidth,
    plan.sourceHeight,
    0,
    0,
    plan.sourceWidth,
    plan.sourceHeight,
  );
  return output;
}

async function resizeIntoOutputCanvas(croppedCanvas, plan, settings) {
  const output = document.createElement("canvas");
  output.width = plan.targetWidth;
  output.height = plan.targetHeight;
  const ctx = output.getContext("2d", { alpha: true });

  if (plan.needsPadding) {
    fillBackground(ctx, output.width, output.height, settings);
  }

  const resizedCanvas = await highQualityResize(croppedCanvas, plan.drawWidth, plan.drawHeight);
  ctx.drawImage(resizedCanvas, plan.destX, plan.destY, plan.drawWidth, plan.drawHeight);
  if (resizedCanvas !== croppedCanvas) {
    disposeCanvas(resizedCanvas);
  }
  return output;
}

function fillBackground(ctx, width, height, settings) {
  const color = resolveBackgroundColor(settings);
  if (!color) {
    return;
  }
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function resolveBackgroundColor(settings) {
  if (settings.paddingMode === "white") return "#ffffff";
  if (settings.paddingMode === "black") return "#000000";
  if (settings.paddingMode === "custom") return settings.backgroundColor || "#ffffff";
  if (settings.format === "image/jpeg") return settings.backgroundColor || "#ffffff";
  return null;
}

function collectWarnings(file, blob, settings) {
  const warnings = [];
  if (settings.metadataMode === "keep") {
    warnings.push("Most browsers strip metadata during canvas export.");
  }
  if ((file.size > 50 * 1024 * 1024) || file.size === 0) {
    warnings.push("Large files can increase processing time.");
  }
  if (settings.targetSizeEnabled === "on" && blob.size > resolveTargetBytes(settings)) {
    warnings.push("Target file size could not be reached without dropping quality too far.");
  }
  return warnings;
}

function resolveTargetBytes(settings) {
  const value = Number(settings.targetSizeValue || 500);
  return settings.targetSizeUnit === "MB" ? value * 1024 * 1024 : value * 1024;
}

function disposeCanvas(canvas) {
  canvas.width = 1;
  canvas.height = 1;
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
