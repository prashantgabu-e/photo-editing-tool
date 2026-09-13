import type { ProcessedResult } from "../../types";

type VideoProgress = {
  progress: number | null;
  text: string;
};

const VIDEO_PROCESSOR_PATH = `${import.meta.env.BASE_URL}gwr-video/video-preview.html`;
const VIDEO_TIMEOUT_MS = 30 * 60 * 1000;

export async function processVideoWatermark(
  file: File,
  onProgress?: (progress: VideoProgress) => void,
): Promise<ProcessedResult> {
  const frame = document.createElement("iframe");
  frame.src = VIDEO_PROCESSOR_PATH;
  frame.title = "Gemini video watermark processor";
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  frame.style.left = "-10px";
  frame.style.bottom = "-10px";
  document.body.appendChild(frame);

  try {
    await waitForFrame(frame);
    const doc = requireFrameDocument(frame);
    const win = requireFrameWindow(frame);
    const input = requireElement<HTMLInputElement>(doc, "#fileInput");
    const processButton = requireElement<HTMLButtonElement>(doc, "#processBtn");

    onProgress?.({ progress: 0, text: "Loading video" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitUntil(() => !processButton.disabled, VIDEO_TIMEOUT_MS, doc);
    onProgress?.({ progress: 0.05, text: "Removing watermark" });
    processButton.click();

    const link = requireElement<HTMLAnchorElement>(doc, "#downloadBtn");
    const progressBar = doc.querySelector<HTMLElement>("#progressBar");
    const progressText = doc.querySelector<HTMLElement>("#progressText");
    const status = doc.querySelector<HTMLElement>("#status");
    let lastReported = "";

    await waitUntil(() => {
      const tone = status?.dataset.tone || "";
      const message = (status?.textContent || progressText?.textContent || "").trim();
      const width = progressBar?.style.width || "";
      const percent = Number.parseFloat(width);
      const label = message || width || "Processing";

      if (label !== lastReported) {
        lastReported = label;
        onProgress?.({
          progress: Number.isFinite(percent) ? percent / 100 : null,
          text: label,
        });
      }

      if (tone === "error") {
        throw new Error(message || "Video watermark removal failed.");
      }

      return Boolean(link.href) && link.getAttribute("aria-disabled") === "false";
    }, VIDEO_TIMEOUT_MS, doc);

    const blob = await win.fetch(link.href).then((response) => response.blob());
    onProgress?.({ progress: 1, text: "Ready" });
    return {
      blob: new Blob([await blob.arrayBuffer()], { type: blob.type || "video/mp4" }),
      width: 0,
      height: 0,
      warnings: ["Gemini video watermark removal is best-effort and targets visible Gemini marks."],
    };
  } finally {
    frame.remove();
  }
}

function waitForFrame(frame: HTMLIFrameElement) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Video processor did not load.")), 30000);
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function requireFrameDocument(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  if (!doc) {
    throw new Error("Video processor is not available.");
  }
  return doc;
}

function requireFrameWindow(frame: HTMLIFrameElement) {
  const win = frame.contentWindow;
  if (!win) {
    throw new Error("Video processor is not available.");
  }
  return win;
}

function requireElement<T extends Element>(doc: Document, selector: string) {
  const element = doc.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Video processor control missing: ${selector}`);
  }
  return element;
}

async function waitUntil(check: () => boolean, timeoutMs: number, doc: Document) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    if (!doc.defaultView) {
      throw new Error("Video processor closed unexpectedly.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("Video processing timed out.");
}
