import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  Download,
  FolderOpen,
  Home,
  ImagePlus,
  ListTodo,
  LoaderCircle,
  MoonStar,
  PackageCheck,
  Pause,
  Play,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SunMedium,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import { builtInPresets, defaultSettings, mergePresetLists, qualityPresets } from "./config/presets";
import { buildOutputFilename } from "./lib/core/renamer";
import { processFile } from "./lib/core/processor";
import { buildZip } from "./lib/core/zip";
import { downloadBlob } from "./lib/download";
import { ProcessingQueue } from "./lib/queue";
import { clearSettings, loadCustomPresets, loadSettings, saveCustomPresets, saveSettings } from "./lib/storage";
import { detectMimeType, formatBytes, getAutoConcurrency, revokeUrl } from "./lib/utils";
import type { QueueItem, QueueStatus, Settings, StoredPreset, ThemeMode } from "./types";
const supportedMimes = ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif", "image/avif"];

const routes = [
  { to: "/", label: "Workspace", icon: Home },
  { to: "/queue", label: "Queue", icon: ListTodo },
  { to: "/settings", label: "Settings", icon: Settings2 },
  { to: "/export", label: "Export", icon: PackageCheck },
] as const;

function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [customPresets, setCustomPresets] = useState<StoredPreset[]>(() => loadCustomPresets());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [zipPackage, setZipPackage] = useState<{ blob: Blob; filename: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installReady, setInstallReady] = useState(false);
  const [customPresetName, setCustomPresetName] = useState("");
  const queueRef = useRef<ProcessingQueue<QueueItem> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueRef.current = new ProcessingQueue<QueueItem>({
      createWorker: () => new Worker(new URL("./workers/image-worker.ts", import.meta.url), { type: "module" }),
      onItemUpdate: (itemId, patch) => {
        setItems((current) =>
          current.map((item) => {
            if (item.id !== itemId) {
              return item;
            }

            const next: QueueItem = { ...item, ...patch };
            if (patch.result) {
              revokeUrl(item.result?.downloadUrl);
              next.result = {
                ...patch.result,
                downloadUrl: URL.createObjectURL(patch.result.blob),
              };
            }
            return next;
          }),
        );
      },
      onProgress: () => {
        setItems((current) => [...current]);
      },
      processorFallback: processFile,
    });

    return () => {
      queueRef.current?.terminateAll();
    };
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveCustomPresets(customPresets);
  }, [customPresets]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallReady(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const presets = useMemo(() => mergePresetLists(customPresets), [customPresets]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const safetyWarning = items.find((item) => item.width > 12000 || item.height > 12000 || item.file.size > 50 * 1024 * 1024);

  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((item) => item.status === "done").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const cancelled = items.filter((item) => item.status === "cancelled").length;
    const remaining = Math.max(total - done - failed - cancelled, 0);
    const originalTotal = items.reduce((sum, item) => sum + item.file.size, 0);
    const processedTotal = items.reduce((sum, item) => sum + (item.result?.blob.size || 0), 0);
    const saved = Math.max(0, originalTotal - processedTotal);
    const reduction = originalTotal ? (saved / originalTotal) * 100 : 0;
    const complete = done + failed + cancelled;
    const percent = total ? (complete / total) * 100 : 0;

    return { total, done, failed, remaining, originalTotal, processedTotal, saved, reduction, percent };
  }, [items]);

  async function addFiles(fileList: FileList | null) {
    if (!fileList) {
      return;
    }

    const nextItems: QueueItem[] = [];
    for (const file of Array.from(fileList)) {
      const mime = detectMimeType(file);
      if (!supportedMimes.includes(mime)) {
        continue;
      }

      try {
        const bitmap = await createImageBitmap(file);
        nextItems.push({
          id: crypto.randomUUID(),
          file,
          mime,
          width: bitmap.width,
          height: bitmap.height,
          previewUrl: URL.createObjectURL(file),
          status: "waiting",
          error: "",
          warnings: [],
          result: null,
          outputName: "",
        });
        bitmap.close();
      } catch {
        nextItems.push({
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

    setItems((current) => {
      const merged = [...current, ...nextItems];
      if (!selectedItemId && merged.length) {
        setSelectedItemId(merged[0].id);
      }
      return merged;
    });
  }

  function updateSettings<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({
      ...current,
      [key]: value,
      presetId: key === "presetId" ? (value as string) : "custom-current",
    }));
  }

  function applyPreset(presetId: string) {
    const preset = presets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    setSettings((current) => ({
      ...current,
      ...(preset.settings || {}),
      presetId,
    }));
    setCustomPresetName(preset.builtIn ? "" : preset.name);
  }

  function applyQualityPreset(value: Settings["qualityPreset"]) {
    const presetMap = qualityPresets[value as keyof typeof qualityPresets];
    if (!presetMap) {
      updateSettings("qualityPreset", value);
      return;
    }

    setSettings((current) => ({
      ...current,
      qualityPreset: value,
      quality: current.format === "image/jpeg" ? presetMap.jpeg : presetMap.webp,
      presetId: "custom-current",
    }));
  }

  function saveCurrentPreset() {
    const name = customPresetName.trim();
    if (!name) {
      return;
    }

    const preset: StoredPreset = {
      id: crypto.randomUUID(),
      name,
      settings: { ...settings, presetId: "custom-current" },
    };

    setCustomPresets((current) => [...current, preset]);
    setSettings((current) => ({ ...current, presetId: preset.id }));
  }

  function deleteSelectedPreset() {
    const selectedPreset = customPresets.find((preset) => preset.id === settings.presetId);
    if (!selectedPreset) {
      return;
    }

    setCustomPresets((current) => current.filter((preset) => preset.id !== selectedPreset.id));
    setSettings((current) => ({ ...current, presetId: builtInPresets[1].id }));
    setCustomPresetName("");
  }

  async function refreshPreview() {
    if (!selectedItem) {
      return;
    }

    const preview = await processFile(selectedItem.file, settings);
    setItems((current) =>
      current.map((item) => {
        if (item.id !== selectedItem.id) {
          return item;
        }

        revokeUrl(item.previewProcessedUrl);
        return {
          ...item,
          previewProcessedUrl: URL.createObjectURL(preview.blob),
          resultPreviewOnly: preview,
        };
      }),
    );
  }

  async function processAll() {
    if (!items.length || processing || !queueRef.current) {
      return;
    }

    setProcessing(true);
    setPaused(false);
    setZipPackage(null);

    const queuedItems = items.map((item, index) => ({
      ...item,
      status: "waiting" as const,
      error: "",
      warnings: [],
      result: null,
      outputName: buildOutputFilename(item, settings, index),
    }));

    setItems((current) =>
      current.map((item, index) => {
        revokeUrl(item.result?.downloadUrl);
        return queuedItems[index];
      }),
    );

    const concurrency = settings.concurrency === "auto" ? getAutoConcurrency() : Number(settings.concurrency);
    await queueRef.current.process(queuedItems, settings, concurrency);
    setProcessing(false);
  }

  function clearQueue() {
    queueRef.current?.cancel();
    setProcessing(false);
    setPaused(false);
    setZipPackage(null);
    setItems((current) => {
      current.forEach((item) => {
        revokeUrl(item.previewUrl);
        revokeUrl(item.previewProcessedUrl);
        revokeUrl(item.result?.downloadUrl);
      });
      return [];
    });
    setSelectedItemId(null);
  }

  function cancelProcessing() {
    queueRef.current?.cancel();
    setProcessing(false);
    setPaused(false);
    setItems((current) =>
      current.map((item) =>
        item.status === "waiting" || item.status === "processing" ? { ...item, status: "cancelled" } : item,
      ),
    );
  }

  function retryFailed() {
    setItems((current) =>
      current.map((item, index) =>
        item.status === "failed" || item.status === "cancelled"
          ? {
              ...item,
              status: "waiting",
              error: "",
              warnings: [],
              outputName: buildOutputFilename(item, settings, index),
            }
          : item,
      ),
    );
  }

  async function handleDownloadZip() {
    const readyItems = items.filter((item) => item.status === "done" && item.result);
    if (!readyItems.length) {
      return;
    }

    const bundle = await buildZip(readyItems, settings.zipName);
    setZipPackage(bundle);
    downloadBlob(bundle.blob, bundle.filename);
  }

  async function installApp() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallReady(false);
      setInstallPrompt(null);
    }
  }

  function resetAllSettings() {
    clearSettings();
    setSettings(defaultSettings);
    setCustomPresetName("");
  }

  function pauseQueue() {
    queueRef.current?.pause();
    setPaused(true);
  }

  function resumeQueue() {
    queueRef.current?.resume();
    setPaused(false);
  }

  function downloadSingle(item: QueueItem) {
    if (item.result?.blob) {
      downloadBlob(item.result.blob, item.outputName || buildOutputFilename(item, settings, 0));
    }
  }

  const pageProps: PageProps = {
    settings,
    presets,
    customPresets,
    items,
    selectedItem,
    selectedItemId,
    processing,
    paused,
    stats,
    zipPackage,
    installReady,
    customPresetName,
    safetyWarning,
    fileInputRef,
    setCustomPresetName,
    updateSettings,
    applyPreset,
    applyQualityPreset,
    saveCurrentPreset,
    deleteSelectedPreset,
    refreshPreview,
    processAll,
    clearQueue,
    cancelProcessing,
    retryFailed,
    handleDownloadZip,
    installApp,
    resetAllSettings,
    pauseQueue,
    resumeQueue,
    addFiles,
    selectItem: setSelectedItemId,
    downloadSingle,
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Local-first image workspace</p>
          <h1>PixelBatch</h1>
        </div>
        <button className="icon-button" type="button" onClick={resetAllSettings} aria-label="Reset settings">
          <RefreshCcw size={18} />
        </button>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<WorkspacePage {...pageProps} />} />
          <Route path="/queue" element={<QueuePage {...pageProps} />} />
          <Route path="/settings" element={<SettingsPage {...pageProps} />} />
          <Route path="/export" element={<ExportPage {...pageProps} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        {routes.map((route) => {
          const Icon = route.icon;
          return (
            <NavLink key={route.to} to={route.to} className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}>
              <Icon size={18} />
              <span>{route.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function WorkspacePage(props: PageProps) {
  const {
    settings,
    presets,
    items,
    selectedItem,
    stats,
    installReady,
    safetyWarning,
    fileInputRef,
    updateSettings,
    applyPreset,
    processAll,
    clearQueue,
    installApp,
    addFiles,
    refreshPreview,
    selectItem,
  } = props;

  return (
    <div className="screen-grid">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="badge"><Sparkles size={14} /> Calm SaaS workflow</span>
          <h2>Batch-edit product photos with a phone-friendly workspace.</h2>
          <p>Resize, crop, convert, rename, and export everything locally in the browser with large tap targets and simple steps.</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus size={18} />
            Add images
          </button>
          <button className="secondary-button" type="button" onClick={processAll} disabled={!items.length}>
            <Zap size={18} />
            Process batch
          </button>
        </div>
      </section>

      {installReady ? (
        <section className="surface-card install-card">
          <div>
            <p className="eyebrow">PWA Ready</p>
            <h3>Install PixelBatch like an app</h3>
            <p>Save it to your home screen for a full-screen, app-like editing flow.</p>
          </div>
          <button className="primary-button" type="button" onClick={installApp}>
            <Smartphone size={18} />
            Install app
          </button>
        </section>
      ) : null}

      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Quick Upload</p>
            <h3>Drop files or browse</h3>
          </div>
          <button className="ghost-button" type="button" onClick={clearQueue} disabled={!items.length}>
            <Trash2 size={16} />
            Clear
          </button>
        </div>
        <label
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void addFiles(event.dataTransfer.files);
          }}
        >
          <FolderOpen size={22} />
          <strong>Drop image files here</strong>
          <span>JPG, PNG, WebP, BMP, GIF, AVIF</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        {safetyWarning ? <p className="warning-note">{safetyWarning.file.name} is unusually large and may take longer to process.</p> : null}
      </section>

      <section className="stats-strip">
        <StatCard label="Queued" value={String(stats.total)} icon={ListTodo} />
        <StatCard label="Done" value={String(stats.done)} icon={PackageCheck} />
        <StatCard label="Saved" value={formatBytes(stats.saved)} icon={ShieldCheck} />
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Preview</p>
            <h3>Before and after</h3>
          </div>
          <button className="ghost-button" type="button" onClick={refreshPreview} disabled={!selectedItem}>
            <Wand2 size={16} />
            Refresh
          </button>
        </div>
        <p className="section-copy">
          {selectedItem
            ? `${selectedItem.file.name} • ${selectedItem.width}x${selectedItem.height} • ${formatBytes(selectedItem.file.size)}`
            : "Select an image from the queue to preview its processed output."}
        </p>
        <div className="preview-grid">
          <PreviewPane title="Original" src={selectedItem?.previewUrl} />
          <PreviewPane title="Processed" src={selectedItem?.result?.downloadUrl || selectedItem?.previewProcessedUrl} />
        </div>
        {items.length ? (
          <div className="chip-row">
            {items.slice(0, 6).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`queue-chip${item.id === selectedItem?.id ? " is-selected" : ""}`}
                onClick={() => selectItem(item.id)}
              >
                {item.file.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Fast Preset</p>
            <h3>Output profile</h3>
          </div>
        </div>
        <div className="field-grid">
          <Field label="Preset">
            <select value={settings.presetId} onChange={(event) => applyPreset(event.target.value)}>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="dual-grid">
            <Field label="Width">
              <input type="number" min={1} value={settings.width} onChange={(event) => updateSettings("width", Number(event.target.value))} />
            </Field>
            <Field label="Height">
              <input type="number" min={1} value={settings.height} onChange={(event) => updateSettings("height", Number(event.target.value))} />
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Format">
              <select value={settings.format} onChange={(event) => updateSettings("format", event.target.value as Settings["format"])}>
                <option value="image/webp">WebP</option>
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
              </select>
            </Field>
            <Field label="Quality">
              <input type="range" min={35} max={100} value={settings.quality} onChange={(event) => updateSettings("quality", Number(event.target.value))} />
            </Field>
          </div>
        </div>
      </section>
    </div>
  );
}

function QueuePage(props: PageProps) {
  const { items, processing, paused, selectedItemId, selectItem, pauseQueue, resumeQueue, cancelProcessing, retryFailed, downloadSingle } = props;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const filteredItems = items.filter((item) => item.file.name.toLowerCase().includes(deferredQuery.trim().toLowerCase()));

  return (
    <div className="screen-grid">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Batch Queue</p>
            <h3>Processing status</h3>
          </div>
          <span className="status-badge">{items.length} files</span>
        </div>
        <div className="queue-toolbar">
          <input type="search" className="search-input" placeholder="Search files" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="toolbar-actions">
            <button className="ghost-button" type="button" onClick={paused ? resumeQueue : pauseQueue} disabled={!processing}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="ghost-button" type="button" onClick={cancelProcessing} disabled={!processing}>
              <Trash2 size={16} />
              Cancel
            </button>
            <button className="secondary-button" type="button" onClick={retryFailed}>
              <RefreshCcw size={16} />
              Retry
            </button>
          </div>
        </div>
      </section>

      <section className="queue-list">
        {filteredItems.length ? (
          filteredItems.map((item) => (
            <article key={item.id} className={`queue-card${item.id === selectedItemId ? " is-selected" : ""}`} onClick={() => selectItem(item.id)}>
              <div className="queue-card-top">
                <div className="thumb-shell">
                  {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <div className="thumb-placeholder" />}
                </div>
                <div className="queue-meta">
                  <h4>{item.file.name}</h4>
                  <p>{item.width}x{item.height} • {formatBytes(item.file.size)}</p>
                  {item.result ? <p>Output: {item.result.width}x{item.result.height} • {formatBytes(item.result.blob.size)}</p> : null}
                  <StatusPill status={item.status} />
                </div>
              </div>
              {item.error ? <p className="error-note">{item.error}</p> : null}
              {item.warnings.length ? <p className="warning-note">{item.warnings[0]}</p> : null}
              <div className="card-actions">
                <button className="ghost-button" type="button" onClick={(event) => { event.stopPropagation(); selectItem(item.id); }}>
                  Preview
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!item.result}
                  onClick={(event) => {
                    event.stopPropagation();
                    downloadSingle(item);
                  }}
                >
                  <Download size={16} />
                  Download
                </button>
              </div>
            </article>
          ))
        ) : (
          <section className="surface-card empty-card">
            <p>No files match your current search.</p>
          </section>
        )}
      </section>
    </div>
  );
}

function SettingsPage(props: PageProps) {
  const {
    settings,
    customPresets,
    customPresetName,
    updateSettings,
    applyQualityPreset,
    setCustomPresetName,
    saveCurrentPreset,
    deleteSelectedPreset,
  } = props;

  return (
    <div className="screen-grid">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Transform</p>
            <h3>Image settings</h3>
          </div>
          <ThemePicker value={settings.theme} onChange={(value) => updateSettings("theme", value)} />
        </div>
        <div className="field-grid">
          <Field label="Resize mode">
            <select value={settings.resizeMode} onChange={(event) => updateSettings("resizeMode", event.target.value as Settings["resizeMode"])}>
              <option value="exact">Exact size</option>
              <option value="width">Resize by width</option>
              <option value="height">Resize by height</option>
              <option value="max">Maximum dimensions</option>
              <option value="percentage">Percentage scale</option>
            </select>
          </Field>
          <Field label="Aspect ratio">
            <select value={settings.aspectRatio} onChange={(event) => updateSettings("aspectRatio", event.target.value as Settings["aspectRatio"])}>
              <option value="original">Original</option>
              <option value="1:1">1:1</option>
              <option value="2:3">2:3</option>
              <option value="3:2">3:2</option>
              <option value="3:4">3:4</option>
              <option value="4:3">4:3</option>
              <option value="4:5">4:5</option>
              <option value="5:4">5:4</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          {settings.aspectRatio === "custom" ? (
            <div className="dual-grid">
              <Field label="Custom ratio width">
                <input type="number" min={1} value={settings.customRatioWidth} onChange={(event) => updateSettings("customRatioWidth", Number(event.target.value))} />
              </Field>
              <Field label="Custom ratio height">
                <input type="number" min={1} value={settings.customRatioHeight} onChange={(event) => updateSettings("customRatioHeight", Number(event.target.value))} />
              </Field>
            </div>
          ) : null}
          <div className="dual-grid">
            <Field label="Width">
              <input type="number" min={1} value={settings.width} onChange={(event) => updateSettings("width", Number(event.target.value))} />
            </Field>
            <Field label="Height">
              <input type="number" min={1} value={settings.height} onChange={(event) => updateSettings("height", Number(event.target.value))} />
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Scale %">
              <input type="number" min={1} max={400} value={settings.scale} onChange={(event) => updateSettings("scale", Number(event.target.value))} />
            </Field>
            <Field label="Crop mode">
              <select value={settings.cropMode} onChange={(event) => updateSettings("cropMode", event.target.value as Settings["cropMode"])}>
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="fill">Fill</option>
                <option value="fit">Fit inside</option>
                <option value="exact">Exact crop</option>
              </select>
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Crop anchor">
              <select value={settings.cropAnchor} onChange={(event) => updateSettings("cropAnchor", event.target.value as Settings["cropAnchor"])}>
                <option value="center">Center</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="focal">Manual focal</option>
              </select>
            </Field>
            <Field label="Output format">
              <select value={settings.format} onChange={(event) => updateSettings("format", event.target.value as Settings["format"])}>
                <option value="image/webp">WebP</option>
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
              </select>
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Quality preset">
              <select value={settings.qualityPreset} onChange={(event) => applyQualityPreset(event.target.value as Settings["qualityPreset"])}>
                <option value="maximum">Maximum quality</option>
                <option value="high">High quality</option>
                <option value="balanced">Balanced</option>
                <option value="small">Small file</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label={`Quality ${settings.quality}`}>
              <input type="range" min={35} max={100} value={settings.quality} onChange={(event) => updateSettings("quality", Number(event.target.value))} />
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Padding mode">
              <select value={settings.paddingMode} onChange={(event) => updateSettings("paddingMode", event.target.value as Settings["paddingMode"])}>
                <option value="transparent">Transparent</option>
                <option value="white">White</option>
                <option value="black">Black</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="Background color">
              <input type="color" value={settings.backgroundColor} onChange={(event) => updateSettings("backgroundColor", event.target.value)} />
            </Field>
          </div>
          <div className="dual-grid">
            <Field label={`Focal X ${settings.focalX}%`}>
              <input type="range" min={0} max={100} value={settings.focalX} onChange={(event) => updateSettings("focalX", Number(event.target.value))} />
            </Field>
            <Field label={`Focal Y ${settings.focalY}%`}>
              <input type="range" min={0} max={100} value={settings.focalY} onChange={(event) => updateSettings("focalY", Number(event.target.value))} />
            </Field>
          </div>
          <div className="dual-grid">
            <ToggleField label="Prevent enlargement" checked={settings.preventEnlargement} onChange={(value) => updateSettings("preventEnlargement", value)} />
            <ToggleField label="Maintain aspect" checked={settings.maintainAspect} onChange={(value) => updateSettings("maintainAspect", value)} />
          </div>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Naming & Export</p>
            <h3>Output rules</h3>
          </div>
        </div>
        <div className="field-grid">
          <Field label="Rename mode">
            <select value={settings.renameMode} onChange={(event) => updateSettings("renameMode", event.target.value as Settings["renameMode"])}>
              <option value="keep">Keep original</option>
              <option value="prefix">Prefix</option>
              <option value="suffix">Suffix</option>
              <option value="sequential">Sequential</option>
              <option value="findReplace">Find & replace</option>
            </select>
          </Field>
          <Field label="Zip name">
            <input type="text" value={settings.zipName} onChange={(event) => updateSettings("zipName", event.target.value)} />
          </Field>
          <div className="dual-grid">
            <Field label="Rename value A">
              <input type="text" value={settings.renameValueA} onChange={(event) => updateSettings("renameValueA", event.target.value)} />
            </Field>
            <Field label="Rename value B">
              <input type="text" value={settings.renameValueB} onChange={(event) => updateSettings("renameValueB", event.target.value)} />
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Start number">
              <input type="number" min={1} value={settings.renameStart} onChange={(event) => updateSettings("renameStart", Number(event.target.value))} />
            </Field>
            <Field label="Padding">
              <select value={String(settings.renamePadding)} onChange={(event) => updateSettings("renamePadding", Number(event.target.value))}>
                <option value="1">1</option>
                <option value="2">01</option>
                <option value="3">001</option>
                <option value="4">0001</option>
              </select>
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Target size">
              <input type="number" min={1} value={settings.targetSizeValue} onChange={(event) => updateSettings("targetSizeValue", Number(event.target.value))} />
            </Field>
            <Field label="Unit">
              <select value={settings.targetSizeUnit} onChange={(event) => updateSettings("targetSizeUnit", event.target.value as Settings["targetSizeUnit"])}>
                <option value="KB">KB</option>
                <option value="MB">MB</option>
              </select>
            </Field>
          </div>
          <div className="dual-grid">
            <Field label="Reduce file size">
              <select value={settings.targetSizeEnabled} onChange={(event) => updateSettings("targetSizeEnabled", event.target.value as Settings["targetSizeEnabled"])}>
                <option value="off">Off</option>
                <option value="on">Try to reach target</option>
              </select>
            </Field>
            <Field label="Metadata">
              <select value={settings.metadataMode} onChange={(event) => updateSettings("metadataMode", event.target.value as Settings["metadataMode"])}>
                <option value="strip">Strip metadata</option>
                <option value="keep">Keep where possible</option>
              </select>
            </Field>
          </div>
          <div className="dual-grid">
            <ToggleField label="Sanitize filenames" checked={settings.sanitizeFilenames} onChange={(value) => updateSettings("sanitizeFilenames", value)} />
            <Field label="Concurrency">
              <select value={settings.concurrency} onChange={(event) => updateSettings("concurrency", event.target.value as Settings["concurrency"])}>
                <option value="auto">Auto</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4</option>
              </select>
            </Field>
          </div>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Custom Presets</p>
            <h3>Save your favorite setup</h3>
          </div>
          <span className="status-badge">{customPresets.length} saved</span>
        </div>
        <div className="field-grid">
          <Field label="Preset name">
            <input type="text" placeholder="Shopify portrait" value={customPresetName} onChange={(event) => setCustomPresetName(event.target.value)} />
          </Field>
          <div className="card-actions">
            <button className="primary-button" type="button" onClick={saveCurrentPreset}>
              Save preset
            </button>
            <button className="ghost-button" type="button" onClick={deleteSelectedPreset}>
              Delete selected
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ExportPage(props: PageProps) {
  const { stats, settings, items, zipPackage, processing, processAll, handleDownloadZip } = props;
  const doneItems = items.filter((item) => item.status === "done");
  const failedItems = items.filter((item) => item.status === "failed");

  return (
    <div className="screen-grid">
      <section className="hero-card export-hero">
        <div className="hero-copy">
          <span className="badge"><ShieldCheck size={14} /> Private by design</span>
          <h2>Everything stays in your browser.</h2>
          <p>Export each processed image or bundle the whole batch into a dated ZIP for quick sharing and repeatable static deployment.</p>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" type="button" onClick={processAll} disabled={processing || !items.length}>
            {processing ? <LoaderCircle className="spin" size={18} /> : <Zap size={18} />}
            {processing ? "Processing..." : "Run batch"}
          </button>
          <button className="primary-button" type="button" onClick={handleDownloadZip} disabled={!doneItems.length}>
            <Download size={18} />
            Download ZIP
          </button>
        </div>
      </section>

      <section className="stats-strip">
        <StatCard label="Progress" value={`${stats.percent.toFixed(0)}%`} icon={PackageCheck} />
        <StatCard label="Processed" value={formatBytes(stats.processedTotal)} icon={Download} />
        <StatCard label="Failed" value={String(failedItems.length)} icon={RefreshCcw} />
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Export Summary</p>
            <h3>Batch results</h3>
          </div>
        </div>
        <div className="summary-list">
          <SummaryRow label="Ready files" value={`${doneItems.length} of ${items.length}`} />
          <SummaryRow label="Original total" value={formatBytes(stats.originalTotal)} />
          <SummaryRow label="Processed total" value={formatBytes(stats.processedTotal)} />
          <SummaryRow label="Space saved" value={formatBytes(stats.saved)} />
          <SummaryRow label="Reduction" value={`${stats.reduction.toFixed(1)}%`} />
          <SummaryRow label="ZIP name" value={zipPackage?.filename || `${settings.zipName}-YYYY-MM-DD.zip`} />
        </div>
      </section>
    </div>
  );
}

function PreviewPane({ title, src }: { title: string; src?: string }) {
  return (
    <figure className="preview-card">
      <figcaption>{title}</figcaption>
      {src ? <img src={src} alt={title} /> : <div className="preview-empty">No image yet</div>}
    </figure>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Home }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: QueueStatus }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button type="button" className={`toggle-button${checked ? " is-on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
        <span />
      </button>
    </label>
  );
}

function ThemePicker({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }) {
  return (
    <div className="theme-picker" role="group" aria-label="Theme">
      <button type="button" className={value === "light" ? "is-active" : ""} onClick={() => onChange("light")}>
        <SunMedium size={16} />
      </button>
      <button type="button" className={value === "system" ? "is-active" : ""} onClick={() => onChange("system")}>
        <Smartphone size={16} />
      </button>
      <button type="button" className={value === "dark" ? "is-active" : ""} onClick={() => onChange("dark")}>
        <MoonStar size={16} />
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function applyTheme(theme: ThemeMode) {
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
}

type PageProps = {
  settings: Settings;
  presets: StoredPreset[];
  customPresets: StoredPreset[];
  items: QueueItem[];
  selectedItem: QueueItem | null;
  selectedItemId: string | null;
  processing: boolean;
  paused: boolean;
  stats: {
    total: number;
    done: number;
    failed: number;
    remaining: number;
    originalTotal: number;
    processedTotal: number;
    saved: number;
    reduction: number;
    percent: number;
  };
  zipPackage: { blob: Blob; filename: string } | null;
  installReady: boolean;
  customPresetName: string;
  safetyWarning?: QueueItem;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  setCustomPresetName: (value: string) => void;
  updateSettings: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  applyPreset: (presetId: string) => void;
  applyQualityPreset: (value: Settings["qualityPreset"]) => void;
  saveCurrentPreset: () => void;
  deleteSelectedPreset: () => void;
  refreshPreview: () => Promise<void>;
  processAll: () => Promise<void>;
  clearQueue: () => void;
  cancelProcessing: () => void;
  retryFailed: () => void;
  handleDownloadZip: () => Promise<void>;
  installApp: () => Promise<void>;
  resetAllSettings: () => void;
  pauseQueue: () => void;
  resumeQueue: () => void;
  addFiles: (fileList: FileList | null) => Promise<void>;
  selectItem: (id: string | null) => void;
  downloadSingle: (item: QueueItem) => void;
};

export default App;
