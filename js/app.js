import { processFile } from "./processor.js";
import { mergePresetLists, qualityPresets } from "./presets.js";
import { buildOutputFilename } from "./renamer.js";
import { ProcessingQueue } from "./queue.js";
import { createState, defaultSettings } from "./state.js";
import { clearSettings, saveCustomPresets, saveSettings } from "./storage.js";
import { getElements, renderPreview, renderProgress, renderQueue, renderSafetyWarning } from "./ui.js";
import { buildZip } from "./zip.js";
import { debounce, detectMimeType, getAutoConcurrency, getExtensionForMime, isSupportedImageType, parseAspectRatio, revokeUrl } from "./utils.js";

const state = createState();
const elements = getElements();

const queue = new ProcessingQueue({
  workerScript: new URL("../workers/image-worker.js", import.meta.url),
  onItemUpdate: handleItemUpdate,
  onProgress: () => {
    renderProgress(elements, state.items);
  },
  processorFallback: processFile,
});

init();

function init() {
  applyTheme(state.settings.theme);
  populateForm();
  populatePresets();
  bindEvents();
  renderAll();
}

function bindEvents() {
  elements.addFilesBtn.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", (event) => {
    addFiles(event.target.files);
    event.target.value = "";
  });

  elements.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("dragover");
  });
  elements.dropzone.addEventListener("dragleave", () => elements.dropzone.classList.remove("dragover"));
  elements.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("dragover");
    addFiles(event.dataTransfer.files);
  });

  elements.clearQueueBtn.addEventListener("click", clearQueue);
  elements.processBtn.addEventListener("click", processAll);
  elements.pauseBtn.addEventListener("click", () => {
    state.paused = true;
    queue.pause();
  });
  elements.resumeBtn.addEventListener("click", () => {
    state.paused = false;
    queue.resume();
  });
  elements.cancelBtn.addEventListener("click", cancelProcessing);
  elements.retryBtn.addEventListener("click", retryFailed);
  elements.refreshPreviewBtn.addEventListener("click", refreshPreview);
  elements.downloadZipBtn.addEventListener("click", downloadZip);

  elements.queueBody.addEventListener("click", handleQueueClick);

  document.querySelectorAll("input, select").forEach((control) => {
    control.addEventListener("input", () => {
      syncSettingsFromForm();
      debouncedPreview();
    });
    control.addEventListener("change", () => {
      syncSettingsFromForm();
      debouncedPreview();
    });
  });

  document.querySelector("#theme-select").addEventListener("change", (event) => {
    state.settings.theme = event.target.value;
    applyTheme(state.settings.theme);
    persistSettings();
  });

  document.querySelector("#preset-select").addEventListener("change", (event) => {
    applyPreset(event.target.value);
  });

  document.querySelector("#quality-preset").addEventListener("change", (event) => {
    applyQualityPreset(event.target.value);
  });

  document.querySelector("#save-preset-btn").addEventListener("click", saveCurrentPreset);
  document.querySelector("#delete-preset-btn").addEventListener("click", deleteSelectedPreset);
  document.querySelector("#reset-settings-btn").addEventListener("click", resetSettings);
}

function populateForm() {
  setValue("#theme-select", state.settings.theme);
  setValue("#resize-mode", state.settings.resizeMode);
  setValue("#aspect-ratio", state.settings.aspectRatio);
  setValue("#width-input", state.settings.width);
  setValue("#height-input", state.settings.height);
  setValue("#scale-input", state.settings.scale);
  setValue("#custom-ratio-width", state.settings.customRatioWidth);
  setValue("#custom-ratio-height", state.settings.customRatioHeight);
  setValue("#crop-mode", state.settings.cropMode);
  setValue("#crop-anchor", state.settings.cropAnchor);
  setValue("#focal-x", state.settings.focalX);
  setValue("#focal-y", state.settings.focalY);
  setValue("#format-select", state.settings.format);
  setValue("#quality-input", state.settings.quality);
  setValue("#quality-preset", state.settings.qualityPreset);
  setValue("#target-size-enabled", state.settings.targetSizeEnabled);
  setValue("#target-size-value", state.settings.targetSizeValue);
  setValue("#target-size-unit", state.settings.targetSizeUnit);
  setValue("#padding-mode", state.settings.paddingMode);
  setValue("#background-color", state.settings.backgroundColor);
  setCheckbox("#prevent-enlargement", state.settings.preventEnlargement);
  setCheckbox("#maintain-aspect", state.settings.maintainAspect);
  setCheckbox("#sanitize-filenames", state.settings.sanitizeFilenames);
  setValue("#rename-mode", state.settings.renameMode);
  setValue("#rename-value-a", state.settings.renameValueA);
  setValue("#rename-value-b", state.settings.renameValueB);
  setValue("#rename-start", state.settings.renameStart);
  setValue("#rename-padding", state.settings.renamePadding);
  setValue("#zip-name", state.settings.zipName);
  setValue("#concurrency-select", state.settings.concurrency);
  setValue("#metadata-mode", state.settings.metadataMode);
}

function populatePresets() {
  const select = document.querySelector("#preset-select");
  const presets = mergePresetLists(state.customPresets);
  select.innerHTML = presets.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join("");
  select.value = state.settings.presetId || "custom-current";
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    const mime = detectMimeType(file);
    if (!isSupportedImageType(mime)) {
      continue;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const previewUrl = URL.createObjectURL(file);
      state.items.push({
        id: crypto.randomUUID(),
        file,
        mime,
        width: bitmap.width,
        height: bitmap.height,
        previewUrl,
        status: "waiting",
        error: "",
        warnings: [],
        result: null,
        outputName: "",
      });
      bitmap.close();
    } catch {
      state.items.push({
        id: crypto.randomUUID(),
        file,
        mime,
        width: 0,
        height: 0,
        previewUrl: "",
        status: "failed",
        error: "This image could not be decoded in the browser.",
        warnings: [],
        result: null,
        outputName: "",
      });
    }
  }

  if (!state.selectedItemId && state.items.length) {
    state.selectedItemId = state.items[0].id;
  }

  renderAll();
  debouncedPreview();
}

function clearQueue() {
  queue.cancel();
  state.processing = false;
  state.paused = false;
  state.items.forEach(cleanItemResources);
  state.items = [];
  state.selectedItemId = null;
  state.zipBlob = null;
  state.zipFilename = "";
  renderAll();
}

async function processAll() {
  if (!state.items.length || state.processing) {
    return;
  }

  state.processing = true;
  state.paused = false;
  state.zipBlob = null;
  state.zipFilename = "";
  syncSettingsFromForm();

  state.items.forEach((item, index) => {
    if (item.result?.downloadUrl) {
      revokeUrl(item.result.downloadUrl);
    }
    item.status = "waiting";
    item.error = "";
    item.result = null;
    item.outputName = buildOutputFilename(item, state.settings, index);
  });

  renderAll();
  await processPending();
  state.processing = false;
  renderAll();
}

async function processPending() {
  const pendingItems = state.items.filter((item) => item.status === "waiting");
  if (!pendingItems.length) {
    return;
  }
  const concurrency = state.settings.concurrency === "auto"
    ? getAutoConcurrency()
    : Number(state.settings.concurrency);
  await queue.process(pendingItems, { ...state.settings }, concurrency);
}

function cancelProcessing() {
  queue.cancel();
  state.processing = false;
  state.paused = false;
  state.items.forEach((item) => {
    if (item.status === "waiting" || item.status === "processing") {
      item.status = "cancelled";
    }
  });
  renderAll();
}

function retryFailed() {
  state.items.forEach((item, index) => {
    if (item.status === "failed" || item.status === "cancelled") {
      item.status = "waiting";
      item.error = "";
      item.outputName = buildOutputFilename(item, state.settings, index);
    }
  });
  renderAll();
}

async function refreshPreview() {
  const item = getSelectedItem();
  if (!item) {
    return;
  }

  try {
    if (item.previewProcessedUrl) {
      revokeUrl(item.previewProcessedUrl);
    }
    const result = await processFile(item.file, state.settings);
    item.previewProcessedUrl = URL.createObjectURL(result.blob);
    item.resultPreviewOnly = result;
    elements.processedPreview.src = item.previewProcessedUrl;
    elements.previewMeta.textContent = `${item.file.name} • ${item.width}x${item.height} • ${result.width}x${result.height} • ${result.blob.size.toLocaleString()} bytes`;
  } catch (error) {
    elements.previewMeta.textContent = `Preview failed: ${error.message}`;
  }
}

async function downloadZip() {
  const { blob, filename } = await buildZip(state.items, state.settings.zipName);
  window.saveAs(blob, filename);
  state.zipBlob = blob;
  state.zipFilename = filename;
}

function handleQueueClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    const row = event.target.closest("tr[data-id]");
    if (row) {
      state.selectedItemId = row.dataset.id;
      renderAll();
      renderPreview(elements, getSelectedItem());
    }
    return;
  }

  const item = state.items.find((entry) => entry.id === button.dataset.id);
  if (!item) {
    return;
  }

  if (button.dataset.action === "preview") {
    state.selectedItemId = item.id;
    renderAll();
    renderPreview(elements, item);
  }

  if (button.dataset.action === "download" && item.result?.blob) {
    window.saveAs(item.result.blob, item.outputName || `image.${getExtensionForMime(state.settings.format)}`);
  }
}

function handleItemUpdate(itemId, update) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  item.status = update.status || item.status;
  item.error = update.error || "";
  item.warnings = update.warnings || [];

  if (update.result) {
    if (item.result?.downloadUrl) {
      revokeUrl(item.result.downloadUrl);
    }
    item.result = {
      ...update.result,
      blob: update.result.blob,
      downloadUrl: URL.createObjectURL(update.result.blob),
    };
  }

  if (state.selectedItemId === itemId) {
    renderPreview(elements, item);
  }

  renderAll();
}

function applyPreset(presetId) {
  const presets = mergePresetLists(state.customPresets);
  const preset = presets.find((entry) => entry.id === presetId);
  if (!preset || !preset.settings) {
    state.settings.presetId = presetId;
    persistSettings();
    return;
  }

  state.settings = { ...state.settings, ...preset.settings, presetId };
  populateForm();
  persistSettings();
  renderAll();
  debouncedPreview();
}

function applyQualityPreset(presetId) {
  state.settings.qualityPreset = presetId;
  if (presetId === "custom") {
    persistSettings();
    return;
  }

  const profile = qualityPresets[presetId];
  if (!profile) {
    return;
  }
  state.settings.quality = state.settings.format === "image/jpeg" ? profile.jpeg : profile.webp;
  populateForm();
  persistSettings();
}

function saveCurrentPreset() {
  const name = document.querySelector("#preset-name-input").value.trim();
  if (!name) {
    return;
  }
  syncSettingsFromForm();
  const preset = {
    id: crypto.randomUUID(),
    name,
    settings: { ...state.settings, presetId: undefined },
  };
  state.customPresets.push(preset);
  saveCustomPresets(state.customPresets);
  populatePresets();
  document.querySelector("#preset-select").value = preset.id;
  document.querySelector("#preset-name-input").value = "";
}

function deleteSelectedPreset() {
  const presetId = document.querySelector("#preset-select").value;
  const before = state.customPresets.length;
  state.customPresets = state.customPresets.filter((preset) => preset.id !== presetId);
  if (state.customPresets.length !== before) {
    saveCustomPresets(state.customPresets);
    state.settings.presetId = "custom-current";
    populatePresets();
    persistSettings();
  }
}

function resetSettings() {
  clearSettings();
  state.settings = { ...defaultSettings };
  populateForm();
  applyTheme(state.settings.theme);
  persistSettings();
  debouncedPreview();
}

function syncSettingsFromForm() {
  const nextSettings = {
    ...state.settings,
    presetId: document.querySelector("#preset-select").value,
    resizeMode: getValue("#resize-mode"),
    aspectRatio: getValue("#aspect-ratio"),
    width: getNumber("#width-input"),
    height: getNumber("#height-input"),
    scale: getNumber("#scale-input"),
    customRatioWidth: getNumber("#custom-ratio-width"),
    customRatioHeight: getNumber("#custom-ratio-height"),
    cropMode: getValue("#crop-mode"),
    cropAnchor: getValue("#crop-anchor"),
    focalX: getNumber("#focal-x"),
    focalY: getNumber("#focal-y"),
    format: getValue("#format-select"),
    quality: getNumber("#quality-input"),
    qualityPreset: getValue("#quality-preset"),
    targetSizeEnabled: getValue("#target-size-enabled"),
    targetSizeValue: getNumber("#target-size-value"),
    targetSizeUnit: getValue("#target-size-unit"),
    paddingMode: getValue("#padding-mode"),
    backgroundColor: getValue("#background-color"),
    preventEnlargement: getCheckbox("#prevent-enlargement"),
    maintainAspect: getCheckbox("#maintain-aspect"),
    sanitizeFilenames: getCheckbox("#sanitize-filenames"),
    renameMode: getValue("#rename-mode"),
    renameValueA: getValue("#rename-value-a"),
    renameValueB: getValue("#rename-value-b"),
    renameStart: getNumber("#rename-start"),
    renamePadding: getNumber("#rename-padding"),
    zipName: getValue("#zip-name"),
    concurrency: getValue("#concurrency-select"),
    metadataMode: getValue("#metadata-mode"),
  };
  enforceAspectDimensions(nextSettings);
  state.settings = nextSettings;
  persistSettings();
}

function persistSettings() {
  saveSettings(state.settings);
}

function renderAll() {
  renderQueue(elements, state.items, state.selectedItemId);
  renderProgress(elements, state.items);
  renderPreview(elements, getSelectedItem());
  renderSafetyWarning(elements, state.items);
}

function getSelectedItem() {
  return state.items.find((item) => item.id === state.selectedItemId) || null;
}

function applyTheme(theme) {
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolvedTheme;
}

const debouncedPreview = debounce(refreshPreview, 350);

function enforceAspectDimensions(settings) {
  if (settings.resizeMode !== "exact" || !settings.maintainAspect || settings.aspectRatio === "original") {
    return;
  }

  const ratio = parseAspectRatio(
    settings.aspectRatio,
    settings.customRatioWidth,
    settings.customRatioHeight,
    settings.width,
    settings.height,
  );
  settings.height = Math.max(1, Math.round(settings.width / ratio));
  setValue("#height-input", settings.height);
}

function cleanItemResources(item) {
  revokeUrl(item.previewUrl);
  revokeUrl(item.previewProcessedUrl);
  revokeUrl(item.result?.downloadUrl);
}

function setValue(selector, value) {
  const node = document.querySelector(selector);
  if (node) {
    node.value = value;
  }
}

function setCheckbox(selector, value) {
  const node = document.querySelector(selector);
  if (node) {
    node.checked = value;
  }
}

function getValue(selector) {
  return document.querySelector(selector).value;
}

function getNumber(selector) {
  return Number(document.querySelector(selector).value);
}

function getCheckbox(selector) {
  return document.querySelector(selector).checked;
}
