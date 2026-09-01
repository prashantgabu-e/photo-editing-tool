import picaFactory from "pica";

const pica = picaFactory();

export async function highQualityResize(sourceCanvas: CanvasImageSource, width: number, height: number) {
  const outputCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });

  try {
    await pica.resize(sourceCanvas as HTMLCanvasElement, outputCanvas as HTMLCanvasElement, {
      alpha: true,
      unsharpAmount: 80,
      unsharpRadius: 0.6,
      unsharpThreshold: 1,
    });
    return outputCanvas;
  } catch (error) {
    if (!isCanvasReadBlockedError(error)) {
      throw error;
    }
  }

  const context = outputCanvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Canvas context could not be created.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, width, height);
  return outputCanvas;
}

function isCanvasReadBlockedError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /cannot use getimagedata on canvas/i.test(message)
    || /fingerprinting protection/i.test(message)
    || /operation is insecure/i.test(message);
}
