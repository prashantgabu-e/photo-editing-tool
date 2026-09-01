import picaFactory from "pica";
import { computeResizePlan } from "../lib/core/crop";
import { encodeCanvas } from "../lib/core/encoder";
import { getExifOrientation } from "../lib/utils";
import type { Settings } from "../types";

const pica = picaFactory();

self.onmessage = async (event: MessageEvent<{ type: "process"; file: File; settings: Settings }>) => {
  if (event.data.type !== "process") {
    return;
  }

  try {
    const result = await processImage(event.data.file, event.data.settings);
    self.postMessage({ type: "done", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image processing failed.";
    self.postMessage({ type: "error", error: message });
  }
};

async function processImage(file: File, settings: Settings) {
  const orientation = await getExifOrientation(file);
  const bitmap = await createImageBitmap(file);
  const swapped = [5, 6, 7, 8].includes(orientation);
  const normalizedCanvas = new OffscreenCanvas(swapped ? bitmap.height : bitmap.width, swapped ? bitmap.width : bitmap.height);
  const normalizedContext = normalizedCanvas.getContext("2d", { alpha: true });
  if (!normalizedContext) {
    throw new Error("Canvas context could not be created.");
  }

  applyOrientationTransform(normalizedContext, orientation, normalizedCanvas.width, normalizedCanvas.height);
  normalizedContext.drawImage(bitmap, 0, 0);
  bitmap.close();

  const plan = computeResizePlan(normalizedCanvas.width, normalizedCanvas.height, settings);
  const croppedCanvas = new OffscreenCanvas(plan.sourceWidth, plan.sourceHeight);
  const croppedContext = croppedCanvas.getContext("2d", { alpha: true });
  if (!croppedContext) {
    throw new Error("Canvas context could not be created.");
  }
  croppedContext.drawImage(
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

  const output = new OffscreenCanvas(plan.targetWidth, plan.targetHeight);
  const outputContext = output.getContext("2d", { alpha: true });
  if (!outputContext) {
    throw new Error("Canvas context could not be created.");
  }

  if (plan.needsPadding) {
    fillBackground(outputContext, output.width, output.height, settings);
  }

  const resized = new OffscreenCanvas(plan.drawWidth, plan.drawHeight);
  await pica.resize(croppedCanvas as never, resized as never, {
    alpha: true,
    unsharpAmount: 80,
    unsharpRadius: 0.6,
    unsharpThreshold: 1,
  });

  outputContext.drawImage(resized, plan.destX, plan.destY, plan.drawWidth, plan.drawHeight);
  const blob = await encodeCanvas(output, settings);

  return {
    blob,
    width: output.width,
    height: output.height,
    warnings: collectWarnings(file, blob, settings),
  };
}

function fillBackground(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number, settings: Settings) {
  const color = resolveBackgroundColor(settings);
  if (!color) {
    return;
  }
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function resolveBackgroundColor(settings: Settings) {
  if (settings.paddingMode === "white") return "#ffffff";
  if (settings.paddingMode === "black") return "#000000";
  if (settings.paddingMode === "custom") return settings.backgroundColor || "#ffffff";
  if (settings.format === "image/jpeg") return settings.backgroundColor || "#ffffff";
  return null;
}

function collectWarnings(file: File, blob: Blob, settings: Settings) {
  const warnings: string[] = [];
  if (settings.metadataMode === "keep") {
    warnings.push("Most browsers strip metadata during canvas export.");
  }
  if (file.size > 50 * 1024 * 1024 || file.size === 0) {
    warnings.push("Large files can increase processing time.");
  }
  if (settings.targetSizeEnabled === "on" && blob.size > resolveTargetBytes(settings)) {
    warnings.push("Target file size could not be reached without dropping quality too far.");
  }
  return warnings;
}

function resolveTargetBytes(settings: Settings) {
  const value = Number(settings.targetSizeValue || 500);
  return settings.targetSizeUnit === "MB" ? value * 1024 * 1024 : value * 1024;
}

function applyOrientationTransform(
  ctx: OffscreenCanvasRenderingContext2D,
  orientation: number,
  width: number,
  height: number,
) {
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
