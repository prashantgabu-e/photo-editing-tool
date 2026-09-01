import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, FileArchive, FolderOpen, ImagePlus, LoaderCircle, Play, Plus, RotateCcw, SlidersHorizontal, Sparkles, Upload, X } from "lucide-react";
import { mergePresetLists } from "./config/presets";
import { buildOutputFilename } from "./lib/core/renamer";
import { processFile } from "./lib/core/processor";
import { buildZip } from "./lib/core/zip";
import { downloadBlob } from "./lib/download";
import { ProcessingQueue } from "./lib/queue";
import { loadBatchHistory, loadCustomPresets, loadSettings, saveBatchHistory, saveSettings } from "./lib/storage";
import { detectMimeType, formatBytes, getAutoConcurrency, revokeUrl } from "./lib/utils";
import type { BatchHistoryEntry, QueueItem, Settings, StoredPreset } from "./types";

const supportedMimes = ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif", "image/avif"];
const steps = ["Add images", "Review", "Edit & preview", "Export"];

function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [customPresets] = useState<StoredPreset[]>(() => loadCustomPresets());
  const [history, setHistory] = useState<BatchHistoryEntry[]>(() => loadBatchHistory());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
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
    });
    return () => queueRef.current?.terminateAll();
  }, []);
  useEffect(() => saveSettings(settings), [settings]);

  const presets = useMemo(() => mergePresetLists(customPresets), [customPresets]);
  const activeItem = items.find((item) => item.id === activeId) ?? items[0] ?? null;
  const stats = useMemo(() => ({ totalSize: items.reduce((sum, item) => sum + item.file.size, 0), done: items.filter((item) => item.status === "done").length, failed: items.filter((item) => item.status === "failed").length, processedSize: items.reduce((sum, item) => sum + (item.result?.blob.size || 0), 0) }), [items]);
  const estimate = useMemo(() => {
    const outputPixels = Math.max(1, settings.width * settings.height);
    const sourcePixels = activeItem ? Math.max(1, activeItem.width * activeItem.height) : outputPixels;
    const qualityFactor = settings.format === "image/png" ? 1.05 : settings.quality / 100;
    return Math.round(stats.totalSize * Math.min(1.2, (outputPixels / sourcePixels) * qualityFactor));
  }, [activeItem, settings.format, settings.height, settings.quality, settings.width, stats.totalSize]);

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const additions: QueueItem[] = [];
    for (const file of Array.from(fileList)) {
      const mime = detectMimeType(file);
      if (!supportedMimes.includes(mime)) continue;
      try {
        const bitmap = await createImageBitmap(file);
        additions.push({ id: crypto.randomUUID(), file, mime, width: bitmap.width, height: bitmap.height, previewUrl: URL.createObjectURL(file), status: "waiting", error: "", warnings: [], result: null, outputName: "", overrides: {} });
        bitmap.close();
      } catch {
        additions.push({ id: crypto.randomUUID(), file, mime, width: 0, height: 0, previewUrl: "", status: "failed", error: "This image could not be decoded in the browser.", warnings: [], result: null, outputName: "", overrides: {} });
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
  function resolvedSettings(item: QueueItem) { return { ...settings, ...item.overrides }; }
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
    await queueRef.current.process(queued, settings, settings.concurrency === "auto" ? getAutoConcurrency() : Number(settings.concurrency));
    setProcessing(false); setStep(3);
    const entry: BatchHistoryEntry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), count: targets.length, settings: { ...settings }, zipName: settings.zipName };
    setHistory((current) => { const next = [entry, ...current].slice(0, 8); saveBatchHistory(next); return next; });
  }
  async function downloadZip() { const ready = items.filter((item) => selectedIds.includes(item.id) && item.status === "done" && item.result); if (ready.length) { const bundle = await buildZip(ready, settings.zipName); downloadBlob(bundle.blob, bundle.filename); } }
  function retryFailed() { setItems((current) => current.map((item) => item.status === "failed" ? { ...item, status: "waiting", error: "" } : item)); void processAll(); }
  function startNewBatch() { if (items.length && !window.confirm("Start a new batch? The current images and results will be cleared.")) return; queueRef.current?.cancel(); items.forEach((item) => { revokeUrl(item.previewUrl); revokeUrl(item.previewProcessedUrl); revokeUrl(item.result?.downloadUrl); }); setItems([]); setSelectedIds([]); setActiveId(null); setProcessing(false); setStep(0); }
  function restoreHistory(entry: BatchHistoryEntry) { setSettings(entry.settings); setStep(0); }
  const canAdvance = step === 0 ? items.length > 0 : step === 1 ? selectedIds.length > 0 : step === 2 ? selectedIds.length > 0 : false;

  return <div className="app-shell"><header className="topbar"><div><p className="eyebrow">Private browser processing</p><h1>PixelBatch</h1></div><button className="ghost-button" type="button" onClick={startNewBatch}><RotateCcw size={17} />New batch</button></header><main className="workflow"><ol className="stepper" aria-label="Batch workflow">{steps.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""}><button type="button" onClick={() => (index <= step || (index === 1 && items.length) || (index === 2 && selectedIds.length)) && setStep(index)}><span>{index < step ? <Check size={15} /> : index + 1}</span>{label}</button></li>)}</ol>{step === 0 && <AddStep items={items} stats={stats} fileRef={filesRef} folderRef={folderRef} addFiles={addFiles} onContinue={() => setStep(1)} history={history} restoreHistory={restoreHistory} />}{step === 1 && <ReviewStep items={items} selectedIds={selectedIds} activeId={activeItem?.id || null} toggleItem={toggleItem} setSelectedIds={setSelectedIds} setActiveId={setActiveId} removeItem={removeItem} onContinue={() => setStep(2)} />}{step === 2 && <EditStep settings={settings} presets={presets} activeItem={activeItem} selectedCount={selectedIds.length} estimate={estimate} updateSettings={updateSettings} applyPreset={applyPreset} refreshPreview={refreshPreview} previewing={previewing} updateOverride={updateOverride} onProcess={processAll} />}{step === 3 && <ExportStep items={items.filter((item) => selectedIds.includes(item.id))} stats={stats} processing={processing} downloadZip={downloadZip} retryFailed={retryFailed} startNewBatch={startNewBatch} downloadSingle={(item) => item.result && downloadBlob(item.result.blob, item.outputName)} />}</main><footer className="workflow-footer"><button className="ghost-button" type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}><ChevronLeft size={18} />Back</button>{step < 3 ? <button className="primary-button" type="button" disabled={!canAdvance || (step === 2 && processing)} onClick={() => step === 2 ? void processAll() : setStep((current) => current + 1)}>{step === 2 ? <><Play size={18} />Process selected</> : <>Continue<ChevronRight size={18} /></>}</button> : null}</footer></div>;
}

function AddStep({ items, stats, fileRef, folderRef, addFiles, onContinue, history, restoreHistory }: { items: QueueItem[]; stats: { totalSize: number }; fileRef: React.RefObject<HTMLInputElement | null>; folderRef: React.RefObject<HTMLInputElement | null>; addFiles: (files: FileList | null) => Promise<void>; onContinue: () => void; history: BatchHistoryEntry[]; restoreHistory: (entry: BatchHistoryEntry) => void; }) { return <section className="step-card add-step"><div className="step-intro"><span className="badge"><Sparkles size={14} />Step 1 of 4</span><h2>Build your image batch.</h2><p>Drop images, browse for files, or import an entire product-photo folder. Everything stays on this device.</p></div><label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><Upload size={28} /><strong>Drop images or folders here</strong><span>JPEG, PNG, WebP, BMP, GIF, and AVIF</span><div className="upload-actions"><button className="primary-button" type="button" onClick={(event) => { event.preventDefault(); fileRef.current?.click(); }}><ImagePlus size={18} />Choose images</button><button className="ghost-button" type="button" onClick={(event) => { event.preventDefault(); folderRef.current?.click(); }}><FolderOpen size={18} />Choose folder</button></div><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /><input ref={folderRef} type="file" accept="image/*" multiple hidden {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label>{items.length ? <div className="import-summary"><strong>{items.length} images ready</strong><span>{formatBytes(stats.totalSize)} total</span><button className="primary-button" onClick={onContinue}>Review images <ChevronRight size={18} /></button></div> : null}{history.length ? <div className="history"><p className="eyebrow">Recent settings</p>{history.slice(0, 3).map((entry) => <button type="button" key={entry.id} className="history-item" onClick={() => restoreHistory(entry)}><span>{entry.count} images · {entry.settings.width}×{entry.settings.height} · {entry.settings.format.replace("image/", "").toUpperCase()}</span><small>{new Date(entry.createdAt).toLocaleDateString()}</small></button>)}</div> : null}</section>; }

function ReviewStep({ items, selectedIds, activeId, toggleItem, setSelectedIds, setActiveId, removeItem, onContinue }: { items: QueueItem[]; selectedIds: string[]; activeId: string | null; toggleItem: (id: string) => void; setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>; setActiveId: (id: string) => void; removeItem: (id: string) => void; onContinue: () => void; }) { const allSelected = items.length > 0 && selectedIds.length === items.length; return <section className="step-card"><div className="section-head"><div><span className="badge">Step 2 of 4</span><h2>Review your selection.</h2><p>Choose the images that should receive the batch settings.</p></div><button className="ghost-button" type="button" onClick={() => setSelectedIds(allSelected ? [] : items.map((item) => item.id))}>{allSelected ? "Deselect all" : "Select all"}</button></div><div className="review-toolbar"><strong>{selectedIds.length} of {items.length} selected</strong><span>Click a thumbnail to inspect it.</span></div><div className="thumbnail-grid">{items.map((item) => <article key={item.id} className={`thumbnail-card${activeId === item.id ? " is-active" : ""}${selectedIds.includes(item.id) ? " is-selected" : ""}`}><button type="button" className="thumbnail-image" onClick={() => setActiveId(item.id)}><img src={item.previewUrl} alt={item.file.name} /><span className="thumbnail-check" onClick={(event) => { event.stopPropagation(); toggleItem(item.id); }}>{selectedIds.includes(item.id) ? <Check size={15} /> : null}</span></button><div><strong title={item.file.name}>{item.file.name}</strong><span>{item.width}×{item.height} · {formatBytes(item.file.size)}</span></div><button className="remove-button" type="button" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.file.name}`}><X size={16} /></button></article>)}</div><div className="inline-actions"><button className="primary-button" type="button" disabled={!selectedIds.length} onClick={onContinue}>Edit selected images <ChevronRight size={18} /></button></div></section>; }

function EditStep({ settings, presets, activeItem, selectedCount, estimate, updateSettings, applyPreset, refreshPreview, previewing, updateOverride, onProcess }: { settings: Settings; presets: StoredPreset[]; activeItem: QueueItem | null; selectedCount: number; estimate: number; updateSettings: <K extends keyof Settings>(key: K, value: Settings[K]) => void; applyPreset: (id: string) => void; refreshPreview: () => Promise<void>; previewing: boolean; updateOverride: <K extends "cropAnchor" | "focalX" | "focalY">(key: K, value: Settings[K]) => void; onProcess: () => Promise<void>; }) { const activeSettings = activeItem ? { ...settings, ...activeItem.overrides } : settings; return <section className="edit-layout"><div className="step-card editor"><span className="badge">Step 3 of 4</span><h2>Set the batch output.</h2><p>These changes apply to {selectedCount} selected images. Use the preview for confidence before processing.</p><div className="preset-chips">{presets.filter((preset) => preset.id !== "custom-current").map((preset) => <button key={preset.id} type="button" className={settings.presetId === preset.id ? "is-active" : ""} onClick={() => applyPreset(preset.id)}>{preset.name}</button>)}</div><div className="control-groups"><div><h3><SlidersHorizontal size={17} />Size & crop</h3><div className="control-grid"><Field label="Resize"><select value={settings.resizeMode} onChange={(event) => updateSettings("resizeMode", event.target.value as Settings["resizeMode"])}><option value="exact">Exact size</option><option value="width">By width</option><option value="height">By height</option><option value="max">Maximum size</option><option value="percentage">Percentage</option></select></Field><Field label="Aspect ratio"><select value={settings.aspectRatio} onChange={(event) => updateSettings("aspectRatio", event.target.value as Settings["aspectRatio"])}><option value="original">Original</option><option value="1:1">1:1 Square</option><option value="4:5">4:5 Portrait</option><option value="16:9">16:9 Wide</option><option value="2:3">2:3 Portrait</option><option value="custom">Custom</option></select></Field><Field label="Width"><input type="number" min={1} value={settings.width} onChange={(event) => updateSettings("width", Number(event.target.value))} /></Field><Field label="Height"><input type="number" min={1} value={settings.height} onChange={(event) => updateSettings("height", Number(event.target.value))} /></Field><Field label="Fit"><select value={settings.cropMode} onChange={(event) => updateSettings("cropMode", event.target.value as Settings["cropMode"])}><option value="cover">Cover</option><option value="contain">Contain</option><option value="fit">Fit inside</option><option value="fill">Fill</option><option value="exact">Exact crop</option></select></Field><Field label="Background"><select value={settings.paddingMode} onChange={(event) => updateSettings("paddingMode", event.target.value as Settings["paddingMode"])}><option value="transparent">Transparent</option><option value="white">White</option><option value="black">Black</option><option value="custom">Custom color</option></select></Field></div></div><div><h3>Format & naming</h3><div className="control-grid"><Field label="Format"><select value={settings.format} onChange={(event) => updateSettings("format", event.target.value as Settings["format"])}><option value="image/webp">WebP</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select></Field><Field label={`Quality: ${settings.quality}`}><input type="range" min={35} max={100} value={settings.quality} onChange={(event) => updateSettings("quality", Number(event.target.value))} /></Field><Field label="Rename"><select value={settings.renameMode} onChange={(event) => updateSettings("renameMode", event.target.value as Settings["renameMode"])}><option value="keep">Keep original</option><option value="prefix">Add prefix</option><option value="suffix">Add suffix</option><option value="sequential">Sequence</option><option value="findReplace">Find & replace</option></select></Field><Field label="ZIP name"><input value={settings.zipName} onChange={(event) => updateSettings("zipName", event.target.value)} /></Field></div></div></div></div><aside className="preview-panel"><div className="preview-heading"><div><p className="eyebrow">Live preview</p><h3>{activeItem?.file.name || "Select an image"}</h3></div><button className="ghost-button" type="button" disabled={!activeItem || previewing} onClick={() => void refreshPreview()}>{previewing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}Preview</button></div><div className="preview-pair"><Preview label="Original" src={activeItem?.previewUrl} /><Preview label="Output" src={activeItem?.previewProcessedUrl} /></div><div className="output-summary"><strong>{selectedCount} images → {settings.format.replace("image/", "").toUpperCase()}, {settings.width}×{settings.height}, {settings.quality}%</strong><span>Estimated output: about {formatBytes(estimate)} · {settings.zipName}.zip</span></div>{activeItem ? <div className="override-box"><p><strong>Only this image</strong> <span>Fine-tune its crop focal point without changing the batch.</span></p><Field label="Crop anchor"><select value={activeSettings.cropAnchor} onChange={(event) => updateOverride("cropAnchor", event.target.value as Settings["cropAnchor"])}><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option><option value="focal">Manual focal point</option></select></Field>{activeSettings.cropAnchor === "focal" ? <div className="control-grid"><Field label={`Focal X: ${activeSettings.focalX}%`}><input type="range" min={0} max={100} value={activeSettings.focalX} onChange={(event) => updateOverride("focalX", Number(event.target.value))} /></Field><Field label={`Focal Y: ${activeSettings.focalY}%`}><input type="range" min={0} max={100} value={activeSettings.focalY} onChange={(event) => updateOverride("focalY", Number(event.target.value))} /></Field></div> : null}</div> : null}<button className="primary-button process-button" type="button" onClick={() => void onProcess()}><Play size={18} />Process {selectedCount} images</button></aside></section>; }

function ExportStep({ items, stats, processing, downloadZip, retryFailed, startNewBatch, downloadSingle }: { items: QueueItem[]; stats: { done: number; failed: number; processedSize: number }; processing: boolean; downloadZip: () => Promise<void>; retryFailed: () => void; startNewBatch: () => void; downloadSingle: (item: QueueItem) => void; }) { return <section className="step-card export-step"><span className="badge">Step 4 of 4</span><h2>{processing ? "Processing your batch…" : "Your batch is ready."}</h2><p>{stats.done} complete · {stats.failed} failed · {formatBytes(stats.processedSize)} processed</p><div className="export-actions"><button className="primary-button" disabled={!stats.done} onClick={() => void downloadZip()}><FileArchive size={18} />Download ZIP</button>{stats.failed ? <button className="ghost-button" onClick={retryFailed}>Retry failed</button> : null}<button className="ghost-button" onClick={startNewBatch}><Plus size={18} />New batch</button></div><div className="result-list">{items.map((item) => <article key={item.id} className="result-row"><img src={item.result?.downloadUrl || item.previewUrl} alt="" /><div><strong>{item.outputName || item.file.name}</strong><span>{item.status === "done" ? `${formatBytes(item.result?.blob.size || 0)} · ready` : item.status === "failed" ? item.error : item.status}</span></div>{item.result ? <button className="ghost-button" onClick={() => downloadSingle(item)}><Download size={17} />Download</button> : null}</article>)}</div></section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Preview({ label, src }: { label: string; src?: string }) { return <figure className="preview-card"><figcaption>{label}</figcaption>{src ? <img src={src} alt={`${label} preview`} /> : <div className="preview-empty">Generate a preview</div>}</figure>; }
export default App;
