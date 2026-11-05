import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, FileArchive, Film, FolderOpen, ImagePlus, Info, LoaderCircle, Play, Plus, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { mergePresetLists } from "./config/presets";
import { buildOutputFilename } from "./lib/core/renamer";
import { processFile } from "./lib/core/processor";
import { processVideoWatermark } from "./lib/core/videoProcessor";
import { buildZip } from "./lib/core/zip";
import { downloadBlob } from "./lib/download";
import { ProcessingQueue } from "./lib/queue";
import { loadBatchHistory, loadCustomPresets, loadSettings, saveBatchHistory, saveSettings } from "./lib/storage";
import { detectMimeType, formatBytes, getAutoConcurrency, isVideoMimeType, revokeUrl } from "./lib/utils";
import { ExifToolWorkspace } from "./components/ExifToolWorkspace";
import { inspectContentCredentials } from "./lib/contentCredentials";
import type { BatchHistoryEntry, QueueItem, Settings, StoredPreset } from "./types";

const supportedMimes = ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif", "image/avif"];
const supportedVideoMimes = ["video/mp4", "video/webm", "video/quicktime"];
const steps = ["Add files", "Review", "Edit & preview", "Export"];

function readVideoMetadata(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth || 0, height: video.videoHeight || 0 });
      video.removeAttribute("src");
      video.load();
    };
    video.onerror = () => reject(new Error("Video metadata could not be read."));
    video.src = src;
  });
}

function getFormatLabel(format: Settings["format"]) {
  return format === "original" ? "Original format" : format.replace("image/", "").toUpperCase();
}

function getImageOutputSummary(settings: Settings) {
  const size = settings.resizeEnabled ? `${settings.width}×${settings.height}` : "original size";
  const format = settings.formatEnabled || settings.compressEnabled ? getFormatLabel(settings.format === "original" ? "image/webp" : settings.format) : "original format";
  const target = settings.compressEnabled ? `, target ${settings.targetSizeValue} ${settings.targetSizeUnit}` : "";
  return `${format}, ${size}${settings.formatEnabled && settings.format !== "image/png" ? `, ${settings.quality}%` : ""}${target}`;
}

function App() {
  const isLocalRun = typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [customPresets] = useState<StoredPreset[]>(() => loadCustomPresets());
  const [history, setHistory] = useState<BatchHistoryEntry[]>(() => loadBatchHistory());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [workspace, setWorkspace] = useState<"batch" | "exiftool">("batch");
  const [processing, setProcessing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<ProcessingQueue<QueueItem> | null>(null);

  useEffect(() => {
    queueRef.current = new ProcessingQueue<QueueItem>({
      createWorker: () => new Worker(new URL("./workers/image-worker.ts", import.meta.url), { type: "module" }),
      onItemUpdate: (id, patch) => setItems((current) => current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (patch.result) {
          revokeUrl(item.result?.downloadUrl);
          next.result = { ...patch.result, downloadUrl: URL.createObjectURL(patch.result.blob) };
        }
        return next;
      })),
      onProgress: () => setItems((current) => [...current]),
      processorFallback: processFile,
      decorateResult: async (file, result, itemSettings) => {
        if (!itemSettings.privacyCleanEnabled) return result;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          return { ...result, warnings: [...result.warnings, "Privacy Clean verification supports JPEG, PNG, and WebP only."] };
        }
        const [source, output] = await Promise.all([inspectContentCredentials(file), inspectContentCredentials(result.blob)]);
        return {
          ...result,
          warnings: [...result.warnings, `Source: ${source.message}`, `Clean copy: ${output.message}`],
        };
      },
    });
    return () => queueRef.current?.terminateAll();
  }, []);
  useEffect(() => saveSettings(settings), [settings]);

  const presets = useMemo(() => mergePresetLists(customPresets), [customPresets]);
  const activeItem = items.find((item) => item.id === activeId) ?? items[0] ?? null;
  const stats = useMemo(() => ({ totalSize: items.reduce((sum, item) => sum + item.file.size, 0), done: items.filter((item) => item.status === "done").length, failed: items.filter((item) => item.status === "failed").length, processedSize: items.reduce((sum, item) => sum + (item.result?.blob.size || 0), 0) }), [items]);
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds]);
  const selectedStats = useMemo(() => ({ done: selectedItems.filter((item) => item.status === "done").length, failed: selectedItems.filter((item) => item.status === "failed").length, processedSize: selectedItems.reduce((sum, item) => sum + (item.result?.blob.size || 0), 0) }), [selectedItems]);
  const estimate = useMemo(() => {
    const outputPixels = settings.resizeEnabled ? Math.max(1, settings.width * settings.height) : activeItem ? Math.max(1, activeItem.width * activeItem.height) : 1;
    const sourcePixels = activeItem ? Math.max(1, activeItem.width * activeItem.height) : outputPixels;
    const qualityFactor = !settings.formatEnabled || settings.format === "image/png" || settings.format === "original" ? 1.05 : settings.quality / 100;
    return Math.round(stats.totalSize * Math.min(1.2, (outputPixels / sourcePixels) * qualityFactor));
  }, [activeItem, settings.format, settings.height, settings.quality, settings.width, stats.totalSize]);

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const additions: QueueItem[] = [];
    for (const file of Array.from(fileList)) {
      const mime = detectMimeType(file);
      const mediaType = isVideoMimeType(mime) ? "video" : "image";
      if (mediaType === "image" && !supportedMimes.includes(mime)) continue;
      if (mediaType === "video" && !supportedVideoMimes.includes(mime)) continue;
      try {
        if (mediaType === "video") {
          const previewUrl = URL.createObjectURL(file);
          const metadata = await readVideoMetadata(previewUrl);
          additions.push({ id: crypto.randomUUID(), file, mime, mediaType, width: metadata.width, height: metadata.height, previewUrl, status: "waiting", error: "", warnings: [], result: null, outputName: "", overrides: {}, progressText: "" });
        } else {
          const bitmap = await createImageBitmap(file);
          additions.push({ id: crypto.randomUUID(), file, mime, mediaType, width: bitmap.width, height: bitmap.height, previewUrl: URL.createObjectURL(file), status: "waiting", error: "", warnings: [], result: null, outputName: "", overrides: {}, progressText: "" });
          bitmap.close();
        }
      } catch {
        additions.push({ id: crypto.randomUUID(), file, mime, mediaType, width: 0, height: 0, previewUrl: "", status: "failed", error: `This ${mediaType} could not be decoded in the browser.`, warnings: [], result: null, outputName: "", overrides: {}, progressText: "" });
      }
    }
    if (!additions.length) return;
    setItems((current) => [...current, ...additions]);
    setSelectedIds((current) => [...new Set([...current, ...additions.map((item) => item.id)])]);
    setActiveId((current) => current || additions[0].id);
  }
  function updateSettings<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings((current) => ({ ...current, [key]: value, presetId: "custom-current" })); }
  function applyPreset(id: string) { const preset = presets.find((entry) => entry.id === id); if (preset) setSettings((current) => ({ ...current, ...(preset.settings || {}), presetId: id })); }
  function toggleItem(id: string) { setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]); }
  function removeItem(id: string) {
    setItems((current) => current.filter((item) => { if (item.id === id) { revokeUrl(item.previewUrl); revokeUrl(item.previewProcessedUrl); revokeUrl(item.result?.downloadUrl); return false; } return true; }));
    setSelectedIds((current) => current.filter((entry) => entry !== id));
    if (activeId === id) setActiveId(null);
  }
  function updateOverride<K extends "cropAnchor" | "focalX" | "focalY">(key: K, value: Settings[K]) { if (activeItem) setItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, overrides: { ...item.overrides, [key]: value } } : item)); }
  function resolvedSettings(item: QueueItem) {
    const next = { ...settings, ...item.overrides };
    if (!next.resizeEnabled) {
      next.resizeMode = "original";
    }
    if (!next.cropEnabled) {
      next.aspectRatio = "original";
      next.cropMode = "fit";
    }
    if (!next.formatEnabled) {
      next.format = "original";
    }
    if (next.compressEnabled) {
      next.targetSizeEnabled = "on";
      if (next.format === "original") {
        next.format = "image/webp";
      }
    } else {
      next.targetSizeEnabled = "off";
    }
    if (!next.metadataEnabled) {
      next.metadataMode = "strip";
    }
    if (next.privacyCleanEnabled) {
      next.metadataEnabled = false;
      next.metadataMode = "strip";
      next.quality = 100;
    }
    if (!next.renameEnabled) {
      next.renameMode = "keep";
    }
    return next;
  }
  async function refreshPreview() {
    if (!activeItem) return;
    setPreviewing(true);
    try { const result = await processFile(activeItem.file, resolvedSettings(activeItem)); setItems((current) => current.map((item) => { if (item.id !== activeItem.id) return item; revokeUrl(item.previewProcessedUrl); return { ...item, previewProcessedUrl: URL.createObjectURL(result.blob), resultPreviewOnly: result }; })); } finally { setPreviewing(false); }
  }
  async function processAll() {
    const targets = items.filter((item) => selectedIds.includes(item.id));
    if (!targets.length || processing || !queueRef.current) return;
    setProcessing(true);
    const queued = targets.map((item, index) => ({ ...item, status: "waiting" as const, error: "", warnings: [], result: null, outputName: buildOutputFilename(item, resolvedSettings(item), index), processingSettings: resolvedSettings(item) }));
    setItems((current) => current.map((item) => queued.find((queuedItem) => queuedItem.id === item.id) || item));
    setStep(3);
    const imageItems = queued.filter((item) => item.mediaType === "image");
    const videoItems = queued.filter((item) => item.mediaType === "video");
    if (imageItems.length) {
      await queueRef.current.process(imageItems, settings, settings.concurrency === "auto" ? getAutoConcurrency() : Number(settings.concurrency));
    }
    for (const item of videoItems) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "processing", error: "", warnings: [], progressText: "Starting video cleanup" } : entry));
      try {
        const result = item.processingSettings?.geminiWatermarkRemoval === "on"
          ? await processVideoWatermark(item.file, (progress) => {
            setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, progressText: progress.text } : entry));
          })
          : { blob: new Blob([await item.file.arrayBuffer()], { type: item.file.type || "video/mp4" }), width: item.width, height: item.height, warnings: [] };
        setItems((current) => current.map((entry) => {
          if (entry.id !== item.id) return entry;
          revokeUrl(entry.result?.downloadUrl);
          return { ...entry, status: "done", result: { ...result, downloadUrl: URL.createObjectURL(result.blob) }, warnings: result.warnings, error: "", progressText: "Ready" };
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Video processing failed.";
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message, warnings: [], progressText: "" } : entry));
      }
    }
    setProcessing(false);
    const entry: BatchHistoryEntry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), count: targets.length, settings: { ...settings }, zipName: settings.zipName };
    setHistory((current) => { const next = [entry, ...current].slice(0, 8); saveBatchHistory(next); return next; });
  }
  async function downloadZip() { const ready = items.filter((item) => selectedIds.includes(item.id) && item.status === "done" && item.result); if (ready.length) { const bundle = await buildZip(ready, settings.zipName); downloadBlob(bundle.blob, bundle.filename); } }
  function retryFailed() { setItems((current) => current.map((item) => item.status === "failed" ? { ...item, status: "waiting", error: "" } : item)); void processAll(); }
  function startNewBatch() { if (items.length && !window.confirm("Start a new batch? The current images and results will be cleared.")) return; queueRef.current?.cancel(); items.forEach((item) => { revokeUrl(item.previewUrl); revokeUrl(item.previewProcessedUrl); revokeUrl(item.result?.downloadUrl); }); setItems([]); setSelectedIds([]); setActiveId(null); setProcessing(false); setStep(0); }
  function restoreHistory(entry: BatchHistoryEntry) { setSettings(entry.settings); setStep(0); }
  const canAdvance = step === 0 ? items.length > 0 : step === 1 ? selectedIds.length > 0 : step === 2 ? selectedIds.length > 0 : false;

  return <div className={`app-shell${workspace === "exiftool" ? " exiftool-shell" : ""}`}><header className="topbar"><div><p className="eyebrow">Private browser processing</p><h1>PixelBatch</h1></div><div className="topbar-actions"><nav className="workspace-switcher" aria-label="Workspace"><button className={workspace === "batch" ? "is-active" : ""} type="button" onClick={() => setWorkspace("batch")}>Batch editor</button>{isLocalRun ? <button className={workspace === "exiftool" ? "is-active" : ""} type="button" onClick={() => setWorkspace("exiftool")}>ExifTool</button> : null}</nav>{workspace === "batch" ? <button className="ghost-button" type="button" onClick={startNewBatch}><RotateCcw size={17} />New batch</button> : null}</div></header>{workspace === "batch" ? <><main className="workflow"><ol className="stepper" aria-label="Batch workflow">{steps.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""}><button type="button" onClick={() => (index <= step || (index === 1 && items.length) || (index === 2 && selectedIds.length)) && setStep(index)}><span>{index < step ? <Check size={15} /> : index + 1}</span>{label}</button></li>)}</ol>{step === 0 && <AddStep items={items} stats={stats} fileRef={filesRef} folderRef={folderRef} addFiles={addFiles} onContinue={() => setStep(1)} history={history} restoreHistory={restoreHistory} />}{step === 1 && <ReviewStep items={items} selectedIds={selectedIds} activeId={activeItem?.id || null} toggleItem={toggleItem} setSelectedIds={setSelectedIds} setActiveId={setActiveId} removeItem={removeItem} onContinue={() => setStep(2)} />}{step === 2 && <EditStep settings={settings} presets={presets} activeItem={activeItem} selectedItems={selectedItems} selectedCount={selectedIds.length} estimate={estimate} updateSettings={updateSettings} applyPreset={applyPreset} refreshPreview={refreshPreview} previewing={previewing} updateOverride={updateOverride} onProcess={processAll} />}{step === 3 && <ExportStep items={selectedItems} stats={selectedStats} processing={processing} downloadZip={downloadZip} retryFailed={retryFailed} startNewBatch={startNewBatch} downloadSingle={(item) => item.result && downloadBlob(item.result.blob, item.outputName)} />}</main><footer className="workflow-footer"><button className="ghost-button" type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}><ChevronLeft size={18} />Back</button>{step < 3 ? <button className="primary-button" type="button" disabled={!canAdvance || (step === 2 && processing)} onClick={() => step === 2 ? void processAll() : setStep((current) => current + 1)}>{step === 2 ? <><Play size={18} />Process selected</> : <>Continue<ChevronRight size={18} /></>}</button> : null}</footer></> : isLocalRun ? <ExifToolWorkspace /> : null}</div>;
}

function AddStep({ items, stats, fileRef, folderRef, addFiles, onContinue, history, restoreHistory }: { items: QueueItem[]; stats: { totalSize: number }; fileRef: React.RefObject<HTMLInputElement | null>; folderRef: React.RefObject<HTMLInputElement | null>; addFiles: (files: FileList | null) => Promise<void>; onContinue: () => void; history: BatchHistoryEntry[]; restoreHistory: (entry: BatchHistoryEntry) => void; }) {
  const imageCount = items.filter((item) => item.mediaType === "image").length;
  const videoCount = items.filter((item) => item.mediaType === "video").length;
  return <section className="step-card add-step"><div className="step-intro"><span className="badge"><Sparkles size={14} />Step 1 of 4</span><h2>Build your batch.</h2><p>Drop images or Gemini-generated videos, browse for files, or import a folder. Everything stays on this device.</p></div><label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><Upload size={28} /><strong>Drop images, videos, or folders here</strong><span>Images plus MP4, WebM, and MOV videos</span><div className="upload-actions"><button className="primary-button" type="button" onClick={(event) => { event.preventDefault(); fileRef.current?.click(); }}><ImagePlus size={18} />Choose files</button><button className="ghost-button" type="button" onClick={(event) => { event.preventDefault(); folderRef.current?.click(); }}><FolderOpen size={18} />Choose folder</button></div><input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.m4v" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /><input ref={folderRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.m4v" multiple hidden {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label>{items.length ? <div className="import-summary"><strong>{items.length} files ready</strong><span>{imageCount} images · {videoCount} videos · {formatBytes(stats.totalSize)} total</span><button className="primary-button" onClick={onContinue}>Review files <ChevronRight size={18} /></button></div> : null}{history.length ? <div className="history"><p className="eyebrow">Recent settings</p>{history.slice(0, 3).map((entry) => <button type="button" key={entry.id} className="history-item" onClick={() => restoreHistory(entry)}><span>{entry.count} files · {entry.settings.resizeMode === "original" ? "original size" : `${entry.settings.width}×${entry.settings.height}`} · {getFormatLabel(entry.settings.format)}</span><small>{new Date(entry.createdAt).toLocaleDateString()}</small></button>)}</div> : null}</section>;
}

function ReviewStep({ items, selectedIds, activeId, toggleItem, setSelectedIds, setActiveId, removeItem, onContinue }: { items: QueueItem[]; selectedIds: string[]; activeId: string | null; toggleItem: (id: string) => void; setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>; setActiveId: (id: string) => void; removeItem: (id: string) => void; onContinue: () => void; }) { const allSelected = items.length > 0 && selectedIds.length === items.length; return <section className="step-card"><div className="section-head"><div><span className="badge">Step 2 of 4</span><h2>Review your selection.</h2><p>Choose the images and videos that should receive the batch settings.</p></div><button className="ghost-button" type="button" onClick={() => setSelectedIds(allSelected ? [] : items.map((item) => item.id))}>{allSelected ? "Deselect all" : "Select all"}</button></div><div className="review-toolbar"><strong>{selectedIds.length} of {items.length} selected</strong><span>Click a thumbnail to inspect it.</span></div><div className="thumbnail-grid">{items.map((item) => <article key={item.id} className={`thumbnail-card${activeId === item.id ? " is-active" : ""}${selectedIds.includes(item.id) ? " is-selected" : ""}`}><button type="button" className="thumbnail-image" onClick={() => setActiveId(item.id)}>{item.mediaType === "video" ? <><video src={item.previewUrl} muted preload="metadata" /><span className="media-type"><Film size={13} />Video</span></> : <img src={item.previewUrl} alt={item.file.name} />}<span className="thumbnail-check" onClick={(event) => { event.stopPropagation(); toggleItem(item.id); }}>{selectedIds.includes(item.id) ? <Check size={15} /> : null}</span></button><div><strong title={item.file.name}>{item.file.name}</strong><span>{item.width && item.height ? `${item.width}×${item.height} · ` : ""}{formatBytes(item.file.size)}</span></div><button className="remove-button" type="button" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.file.name}`}><X size={16} /></button></article>)}</div><div className="inline-actions"><button className="primary-button" type="button" disabled={!selectedIds.length} onClick={onContinue}>Edit selected files <ChevronRight size={18} /></button></div></section>; }

function EditStep({ settings, presets, activeItem, selectedItems, selectedCount, estimate, updateSettings, applyPreset, refreshPreview, previewing, updateOverride, onProcess }: { settings: Settings; presets: StoredPreset[]; activeItem: QueueItem | null; selectedItems: QueueItem[]; selectedCount: number; estimate: number; updateSettings: <K extends keyof Settings>(key: K, value: Settings[K]) => void; applyPreset: (id: string) => void; refreshPreview: () => Promise<void>; previewing: boolean; updateOverride: <K extends "cropAnchor" | "focalX" | "focalY">(key: K, value: Settings[K]) => void; onProcess: () => Promise<void>; }) {
  const activeSettings = activeItem ? { ...settings, ...activeItem.overrides } : settings;
  const activeIsVideo = activeItem?.mediaType === "video";
  const selectedImageCount = selectedItems.filter((item) => item.mediaType === "image").length;
  const selectedVideoCount = selectedItems.filter((item) => item.mediaType === "video").length;
  const isVideoOnly = selectedVideoCount > 0 && selectedImageCount === 0;
  return <section className="edit-layout">
    <div className="step-card editor">
      <span className="badge">Step 3 of 4</span>
      <h2>Set the batch output.</h2>
      <p>{isVideoOnly ? "Video batches support Gemini watermark cleanup and output renaming." : "Use Cleanup Only when you just want Gemini watermark removal without resize, crop, or format changes."}</p>
      {!isVideoOnly ? <div className="preset-chips">{presets.filter((preset) => preset.id !== "custom-current").map((preset) => <button key={preset.id} type="button" className={settings.presetId === preset.id ? "is-active" : ""} onClick={() => applyPreset(preset.id)}>{preset.name}</button>)}</div> : null}
      <div className="operation-list">
        <OperationRow title="Gemini watermark" enabled={settings.geminiWatermarkRemoval === "on"} onToggle={(enabled) => updateSettings("geminiWatermarkRemoval", enabled ? "on" : "off")} summary={isVideoOnly ? "Runs Gemini video cleanup." : "Can run by itself on selected images."} help={isVideoOnly ? "Removes the visible Gemini mark from supported Gemini-generated videos. Rename is the only other video operation." : "Removes the visible Gemini mark from supported Gemini-generated images. Leave every other row off when you only want cleanup."}>
          <p className="operation-note">{isVideoOnly ? "Video resize, crop, format, compression, metadata, and padding are not applied." : "No resize, crop, format, or rename operation is required."}</p>
        </OperationRow>
        {!isVideoOnly ? <>
        <OperationRow title="Resize" enabled={settings.resizeEnabled} onToggle={(enabled) => updateSettings("resizeEnabled", enabled)} summary={settings.resizeEnabled ? `${settings.resizeMode}, ${settings.width}x${settings.height}` : "Original size"} help="Changes pixel dimensions. Use exact size for fixed exports, by width/height to preserve proportion, max size for thumbnails, or percentage when you think in scale.">
          <div className="control-grid">
            <Field label="Mode"><select disabled={!settings.resizeEnabled} value={settings.resizeMode} onChange={(event) => updateSettings("resizeMode", event.target.value as Settings["resizeMode"])}><option value="original">Original size</option><option value="exact">Exact size</option><option value="width">By width</option><option value="height">By height</option><option value="max">Maximum size</option><option value="percentage">Percentage / Scale</option></select></Field>
            <Field label="Width"><input disabled={!settings.resizeEnabled} type="number" min={1} value={settings.width} onChange={(event) => updateSettings("width", Number(event.target.value))} /></Field>
            <Field label="Height"><input disabled={!settings.resizeEnabled} type="number" min={1} value={settings.height} onChange={(event) => updateSettings("height", Number(event.target.value))} /></Field>
            <Field label={`Scale: ${settings.scale}%`}><input disabled={!settings.resizeEnabled || settings.resizeMode !== "percentage"} type="range" min={1} max={300} value={settings.scale} onChange={(event) => updateSettings("scale", Number(event.target.value))} /></Field>
          </div>
        </OperationRow>
        <OperationRow title="Crop" enabled={settings.cropEnabled} onToggle={(enabled) => updateSettings("cropEnabled", enabled)} summary={settings.cropEnabled ? `${settings.aspectRatio}, ${settings.cropMode}` : "No crop"} help="Changes framing. Cover fills the target and may cut edges; contain/fit keeps the full image and may add background padding.">
          <div className="control-grid">
            <Field label="Aspect ratio"><select disabled={!settings.cropEnabled} value={settings.aspectRatio} onChange={(event) => updateSettings("aspectRatio", event.target.value as Settings["aspectRatio"])}><option value="original">Original</option><option value="1:1">1:1 Square</option><option value="4:5">4:5 Portrait</option><option value="16:9">16:9 Wide</option><option value="2:3">2:3 Portrait</option><option value="custom">Custom</option></select></Field>
            <Field label="Fit"><select disabled={!settings.cropEnabled} value={settings.cropMode} onChange={(event) => updateSettings("cropMode", event.target.value as Settings["cropMode"])}><option value="cover">Cover</option><option value="contain">Contain</option><option value="fit">Fit inside</option><option value="fill">Fill</option><option value="exact">Exact crop</option></select></Field>
          </div>
        </OperationRow>
        <OperationRow title="Format" enabled={settings.formatEnabled} onToggle={(enabled) => { updateSettings("formatEnabled", enabled); if (enabled && settings.format === "original") updateSettings("format", "image/webp"); }} summary={settings.formatEnabled ? getFormatLabel(settings.format) : "Original format"} help="Converts the output file type. WebP is usually smaller, JPEG is widely compatible, PNG preserves sharp edges and transparency but can be larger.">
          <div className="control-grid">
            <Field label="Image format"><select disabled={!settings.formatEnabled} value={settings.format === "original" ? "image/webp" : settings.format} onChange={(event) => updateSettings("format", event.target.value as Settings["format"])}><option value="image/webp">WebP</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select></Field>
            <Field label={`Quality: ${settings.quality}`}><input disabled={!settings.formatEnabled || settings.format === "image/png"} type="range" min={35} max={100} value={settings.quality} onChange={(event) => updateSettings("quality", Number(event.target.value))} /></Field>
          </div>
        </OperationRow>
        <OperationRow title="Compress" enabled={settings.compressEnabled} onToggle={(enabled) => { updateSettings("compressEnabled", enabled); updateSettings("targetSizeEnabled", enabled ? "on" : "off"); if (enabled && settings.format === "original") updateSettings("format", "image/webp"); }} summary={settings.compressEnabled ? `Target ${settings.targetSizeValue} ${settings.targetSizeUnit}` : "No target size"} help="Tries to reduce file size by lowering export quality. It does not change image dimensions. WebP or JPEG works best; PNG cannot always hit small targets.">
          <div className="control-grid">
            <Field label="Target size"><input disabled={!settings.compressEnabled} type="number" min={1} value={settings.targetSizeValue} onChange={(event) => updateSettings("targetSizeValue", Number(event.target.value))} /></Field>
            <Field label="Unit"><select disabled={!settings.compressEnabled} value={settings.targetSizeUnit} onChange={(event) => updateSettings("targetSizeUnit", event.target.value as Settings["targetSizeUnit"])}><option value="KB">KB</option><option value="MB">MB</option></select></Field>
          </div>
        </OperationRow>
        <OperationRow title="Metadata" enabled={settings.metadataEnabled} onToggle={(enabled) => { updateSettings("metadataEnabled", enabled); updateSettings("metadataMode", enabled ? "keep" : "strip"); }} summary={settings.metadataEnabled ? "Try to keep metadata" : "Strip metadata"} help="Canvas export usually strips EXIF and camera data in browsers. Enable this only when preserving whatever metadata survives is important.">
          <div className="control-grid">
            <Field label="Metadata"><select disabled={!settings.metadataEnabled} value={settings.metadataMode} onChange={(event) => updateSettings("metadataMode", event.target.value as Settings["metadataMode"])}><option value="strip">Strip metadata</option><option value="keep">Keep where possible</option></select></Field>
          </div>
        </OperationRow>
        <OperationRow title="Privacy clean" enabled={settings.privacyCleanEnabled} onToggle={(enabled) => updateSettings("privacyCleanEnabled", enabled)} summary={settings.privacyCleanEnabled ? "High-quality clean copies + Content Credentials check" : "Off"} help="Creates a fresh browser-encoded copy at maximum quality, without copying EXIF, IPTC, XMP, or embedded Content Credentials. JPEG, PNG, and WebP only.">
          <p className="operation-note">The result list reports C2PA / Content Credentials checks for the source and output. PNG stays lossless; JPEG and WebP are re-encoded at maximum browser quality. Visible watermarks are not changed.</p>
        </OperationRow>
        <OperationRow title="Border / padding" enabled={settings.borderEnabled} onToggle={(enabled) => updateSettings("borderEnabled", enabled)} summary={settings.borderEnabled ? `${settings.borderSize}px ${settings.paddingMode}` : "No border"} help="Adds an even margin around the finished image. Useful for marketplace product photos that need breathing room.">
          <div className="control-grid">
            <Field label="Padding"><input disabled={!settings.borderEnabled} type="number" min={0} value={settings.borderSize} onChange={(event) => updateSettings("borderSize", Number(event.target.value))} /></Field>
            <Field label="Background"><select disabled={!settings.borderEnabled} value={settings.paddingMode} onChange={(event) => updateSettings("paddingMode", event.target.value as Settings["paddingMode"])}><option value="transparent">Transparent</option><option value="white">White</option><option value="black">Black</option><option value="custom">Custom color</option></select></Field>
            <Field label="Custom color"><input disabled={!settings.borderEnabled || settings.paddingMode !== "custom"} type="color" value={settings.backgroundColor} onChange={(event) => updateSettings("backgroundColor", event.target.value)} /></Field>
          </div>
        </OperationRow>
        </> : null}
        <OperationRow title="Rename" enabled={settings.renameEnabled} onToggle={(enabled) => updateSettings("renameEnabled", enabled)} summary={settings.renameEnabled ? settings.renameMode : "Keep original names"} help="Changes output filenames only. Use sequence for ordered batches, prefix/suffix for labels, or find and replace to clean repeated text.">
          <div className="control-grid">
            <Field label="Mode"><select disabled={!settings.renameEnabled} value={settings.renameMode} onChange={(event) => updateSettings("renameMode", event.target.value as Settings["renameMode"])}><option value="keep">Keep original</option><option value="prefix">Add prefix</option><option value="suffix">Add suffix</option><option value="sequential">Sequence</option><option value="findReplace">Find & replace</option></select></Field>
            <Field label="Value A"><input disabled={!settings.renameEnabled} value={settings.renameValueA} onChange={(event) => updateSettings("renameValueA", event.target.value)} /></Field>
            <Field label="Value B"><input disabled={!settings.renameEnabled} value={settings.renameValueB} onChange={(event) => updateSettings("renameValueB", event.target.value)} /></Field>
          </div>
        </OperationRow>
        <div className="operation-row always-on"><div className="operation-head"><div><strong>Batch download</strong><small>ZIP and individual downloads are always available after processing.</small><p className="operation-help"><Info size={14} />The ZIP name affects the bundle only. Individual files still use their output filenames.</p></div></div><div className="control-grid"><Field label="ZIP name"><input value={settings.zipName} onChange={(event) => updateSettings("zipName", event.target.value)} /></Field></div></div>
      </div>
    </div>
    <aside className="preview-panel">
      <div className="preview-heading"><div><p className="eyebrow">Preview</p><h3>{activeItem?.file.name || "Select a file"}</h3></div><button className="ghost-button" type="button" disabled={!activeItem || activeIsVideo || previewing} onClick={() => void refreshPreview()}>{previewing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}Preview</button></div>
      <div className="preview-pair"><Preview label="Original" src={activeItem?.previewUrl} mediaType={activeItem?.mediaType} /><Preview label="Output" src={activeItem?.previewProcessedUrl} mediaType={activeItem?.mediaType} /></div>
      <div className="output-summary"><strong>{selectedCount} files to {activeIsVideo ? "MP4 video cleanup" : getImageOutputSummary(settings)}</strong><span>{settings.geminiWatermarkRemoval === "on" ? "Gemini watermark cleanup on · " : ""}Estimated output: about {formatBytes(estimate)} · {settings.zipName}.zip</span></div>
      {activeItem && activeItem.mediaType === "image" ? <div className="override-box"><p><strong>Only this image</strong> <span>Fine-tune its crop focal point without changing the batch.</span></p><Field label="Crop anchor"><select value={activeSettings.cropAnchor} onChange={(event) => updateOverride("cropAnchor", event.target.value as Settings["cropAnchor"])}><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option><option value="focal">Manual focal point</option></select></Field>{activeSettings.cropAnchor === "focal" ? <div className="control-grid"><Field label={`Focal X: ${activeSettings.focalX}%`}><input type="range" min={0} max={100} value={activeSettings.focalX} onChange={(event) => updateOverride("focalX", Number(event.target.value))} /></Field><Field label={`Focal Y: ${activeSettings.focalY}%`}><input type="range" min={0} max={100} value={activeSettings.focalY} onChange={(event) => updateOverride("focalY", Number(event.target.value))} /></Field></div> : null}</div> : null}
      <button className="primary-button process-button" type="button" onClick={() => void onProcess()}><Play size={18} />Process {selectedCount} files</button>
    </aside>
  </section>;
}

function ExportStep({ items, stats, processing, downloadZip, retryFailed, startNewBatch, downloadSingle }: { items: QueueItem[]; stats: { done: number; failed: number; processedSize: number }; processing: boolean; downloadZip: () => Promise<void>; retryFailed: () => void; startNewBatch: () => void; downloadSingle: (item: QueueItem) => void; }) {
  return <section className="step-card export-step"><span className="badge">Step 4 of 4</span><h2>{processing ? "Processing your batch..." : "Your batch is ready."}</h2><p>{stats.done} complete · {stats.failed} failed · {formatBytes(stats.processedSize)} processed</p><div className="export-actions"><button className="primary-button" disabled={!stats.done} onClick={() => void downloadZip()}><FileArchive size={18} />Download ZIP</button>{stats.failed ? <button className="ghost-button" onClick={retryFailed}>Retry failed</button> : null}<button className="ghost-button" onClick={startNewBatch}><Plus size={18} />New batch</button></div><div className="result-list">{items.map((item) => <article key={item.id} className="result-row">{item.mediaType === "video" ? <video src={item.result?.downloadUrl || item.previewUrl} muted preload="metadata" /> : <img src={item.result?.downloadUrl || item.previewUrl} alt="" />}<div><strong>{item.outputName || item.file.name}</strong><span>{item.status === "done" ? `${formatBytes(item.result?.blob.size || 0)} · ${item.warnings.length ? item.warnings.join(" ") : "ready"}` : item.status === "failed" ? item.error : item.progressText || item.status}</span></div>{item.result ? <button className="ghost-button" onClick={() => downloadSingle(item)}><Download size={17} />Download</button> : null}</article>)}</div></section>;
}
function OperationRow({ title, enabled, summary, help, onToggle, children }: { title: string; enabled: boolean; summary: string; help: string; onToggle: (enabled: boolean) => void; children: React.ReactNode }) { return <section className={`operation-row${enabled ? " is-enabled" : ""}`}><label className="operation-head"><input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} /><span><strong>{title}</strong><small>{summary}</small><p className="operation-help"><Info size={14} />{help}</p></span></label><div className="operation-body">{children}</div></section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Preview({ label, src, mediaType }: { label: string; src?: string; mediaType?: QueueItem["mediaType"] }) { return <figure className="preview-card"><figcaption>{label}</figcaption>{src ? mediaType === "video" ? <video src={src} controls muted preload="metadata" /> : <img src={src} alt={`${label} preview`} /> : <div className="preview-empty">{mediaType === "video" ? "Available after processing" : "Generate a preview"}</div>}</figure>; }
export default App;
