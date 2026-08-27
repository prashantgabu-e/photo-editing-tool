import { formatBytes } from "./utils.js";

export function getElements() {
  return {
    body: document.body,
    fileInput: document.querySelector("#file-input"),
    addFilesBtn: document.querySelector("#add-files-btn"),
    clearQueueBtn: document.querySelector("#clear-queue-btn"),
    dropzone: document.querySelector("#dropzone"),
    queueBody: document.querySelector("#queue-body"),
    processBtn: document.querySelector("#process-btn"),
    pauseBtn: document.querySelector("#pause-btn"),
    resumeBtn: document.querySelector("#resume-btn"),
    cancelBtn: document.querySelector("#cancel-btn"),
    retryBtn: document.querySelector("#retry-btn"),
    refreshPreviewBtn: document.querySelector("#refresh-preview-btn"),
    originalPreview: document.querySelector("#original-preview"),
    processedPreview: document.querySelector("#processed-preview"),
    previewMeta: document.querySelector("#preview-meta"),
    progressFill: document.querySelector("#progress-fill"),
    statTotal: document.querySelector("#stat-total"),
    statDone: document.querySelector("#stat-done"),
    statFailed: document.querySelector("#stat-failed"),
    statRemaining: document.querySelector("#stat-remaining"),
    summaryOriginal: document.querySelector("#summary-original"),
    summaryProcessed: document.querySelector("#summary-processed"),
    summarySaved: document.querySelector("#summary-saved"),
    summaryReduction: document.querySelector("#summary-reduction"),
    downloadZipBtn: document.querySelector("#download-zip-btn"),
    safetyWarning: document.querySelector("#safety-warning"),
  };
}

export function renderQueue(elements, items, selectedItemId) {
  if (!items.length) {
    elements.queueBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">Add a batch of product images to begin.</td>
      </tr>
    `;
    return;
  }

  elements.queueBody.innerHTML = items.map((item) => {
    const output = item.result
      ? `${item.result.width}x${item.result.height} / ${formatBytes(item.result.blob.size)}`
      : "Pending";
    const selectedClass = item.id === selectedItemId ? ' data-selected="true"' : "";
    return `
      <tr${selectedClass} data-id="${item.id}">
        <td><img class="queue-thumb" src="${item.previewUrl}" alt=""></td>
        <td>
          <strong>${escapeHtml(item.file.name)}</strong>
          <div class="inline-note">${item.mime}</div>
          ${item.error ? `<div class="inline-note">${escapeHtml(item.error)}</div>` : ""}
        </td>
        <td>${item.width}x${item.height}<br>${formatBytes(item.file.size)}</td>
        <td>${output}</td>
        <td><span class="status-pill status-${item.status}">${item.status}</span></td>
        <td>
          <div class="row-actions">
            <button type="button" data-action="preview" data-id="${item.id}">Preview</button>
            ${item.result?.downloadUrl ? `<button type="button" data-action="download" data-id="${item.id}">Download</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

export function renderProgress(elements, items) {
  const total = items.length;
  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const cancelled = items.filter((item) => item.status === "cancelled").length;
  const remaining = total - done - failed - cancelled;
  const originalTotal = items.reduce((sum, item) => sum + item.file.size, 0);
  const processedTotal = items.reduce((sum, item) => sum + (item.result?.blob.size || 0), 0);
  const saved = Math.max(0, originalTotal - processedTotal);
  const reduction = originalTotal ? (saved / originalTotal) * 100 : 0;
  const complete = done + failed + cancelled;
  const percent = total ? (complete / total) * 100 : 0;

  elements.progressFill.style.width = `${percent}%`;
  elements.statTotal.textContent = String(total);
  elements.statDone.textContent = String(done);
  elements.statFailed.textContent = String(failed);
  elements.statRemaining.textContent = String(Math.max(remaining, 0));
  elements.summaryOriginal.textContent = formatBytes(originalTotal);
  elements.summaryProcessed.textContent = formatBytes(processedTotal);
  elements.summarySaved.textContent = formatBytes(saved);
  elements.summaryReduction.textContent = `${reduction.toFixed(1)}%`;
  elements.downloadZipBtn.disabled = !done;
}

export function renderPreview(elements, item) {
  if (!item) {
    elements.originalPreview.removeAttribute("src");
    elements.processedPreview.removeAttribute("src");
    elements.previewMeta.textContent = "Select an image to preview the processed result.";
    return;
  }

  elements.originalPreview.src = item.previewUrl;
  if (item.result?.downloadUrl) {
    elements.processedPreview.src = item.result.downloadUrl;
  } else if (item.previewProcessedUrl) {
    elements.processedPreview.src = item.previewProcessedUrl;
  } else {
    elements.processedPreview.removeAttribute("src");
  }

  const processedInfo = item.result || item.resultPreviewOnly;
  const processedLabel = processedInfo?.blob
    ? `${processedInfo.width}x${processedInfo.height} • ${formatBytes(processedInfo.blob.size)}`
    : "Not processed yet";
  elements.previewMeta.textContent = `${item.file.name} • ${item.width}x${item.height} • ${formatBytes(item.file.size)} -> ${processedLabel}`;
}

export function renderSafetyWarning(elements, items) {
  const veryLargeFile = items.find((item) => item.width > 12000 || item.height > 12000 || item.file.size > 50 * 1024 * 1024);
  if (veryLargeFile) {
    elements.safetyWarning.textContent = `Warning: ${veryLargeFile.file.name} is unusually large and may take longer to process.`;
    elements.safetyWarning.classList.remove("hidden");
    return;
  }
  elements.safetyWarning.classList.add("hidden");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
