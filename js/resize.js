export async function highQualityResize(sourceCanvas, width, height) {
  const outputCanvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });

  const picaInstance = window.pica?.();
  if (picaInstance) {
    try {
      await picaInstance.resize(sourceCanvas, outputCanvas, {
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
  }

  const context = outputCanvas.getContext("2d", { alpha: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, width, height);
  return outputCanvas;
}

function isCanvasReadBlockedError(error) {
  const message = error?.message || "";
  return /cannot use getimagedata on canvas/i.test(message)
    || /fingerprinting protection/i.test(message)
    || /operation is insecure/i.test(message);
}
