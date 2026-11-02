import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { CheckCircle2, Download, FileArchive, FileSearch, FolderOpen, ImagePlus, LoaderCircle, ScanLine, ShieldAlert, Tags, WandSparkles, X } from "lucide-react";
import { downloadBlob } from "../lib/download";

type MetadataResult = {
  filename: string;
  metadata: Record<string, unknown>;
  error?: string;
};

type BridgeStatus = { state: "checking" | "ready" | "offline"; version?: string; message?: string };
type ExportResult = { filename: string; zipPath: string; blob: Blob };

const defaultBridgeUrl = "http://127.0.0.1:4318";

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function readError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function ExifToolWorkspace() {
  const [bridgeUrl, setBridgeUrl] = useState(() => localStorage.getItem("pixelbatch-exiftool-bridge") || defaultBridgeUrl);
  const [status, setStatus] = useState<BridgeStatus>({ state: "offline", message: "Check the local bridge to begin." });
  const [files, setFiles] = useState<File[]>([]);
  const [records, setRecords] = useState<MetadataResult[]>([]);
  const [exports, setExports] = useState<ExportResult[]>([]);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const filesLabel = useMemo(() => {
    const folders = new Set(files.map((file) => file.webkitRelativePath.split("/").filter(Boolean)[0]).filter(Boolean));
    return folders.size ? `${files.length} files from ${folders.size} folder${folders.size === 1 ? "" : "s"}` : `${files.length} file${files.length === 1 ? "" : "s"}`;
  }, [files]);

  async function checkBridge() {
    const cleanUrl = bridgeUrl.trim().replace(/\/$/, "");
    if (!cleanUrl) return;
    setStatus({ state: "checking" });
    setNotice("");
    localStorage.setItem("pixelbatch-exiftool-bridge", cleanUrl);
    try {
      const response = await fetch(endpoint(cleanUrl, "/api/exiftool/health"));
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json() as { version: string };
      setStatus({ state: "ready", version: body.version });
    } catch (error) {
      setStatus({ state: "offline", message: error instanceof Error ? error.message : "The bridge could not be reached." });
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list));
    setRecords([]);
    setExports([]);
    setNotice("");
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setRecords([]);
    setExports([]);
    setNotice("");
  }

  async function upload(file: File, path: "/api/exiftool/metadata" | "/api/exiftool/strip") {
    const response = await fetch(endpoint(bridgeUrl, path), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": file.name },
      body: file,
    });
    if (!response.ok) throw new Error(await readError(response));
    return response;
  }

  async function inspectMetadata() {
    if (!files.length || status.state !== "ready") return;
    setWorking(true);
    setNotice("");
    const next: MetadataResult[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Reading ${index + 1} of ${files.length}: ${file.name}`);
        try {
          const response = await upload(file, "/api/exiftool/metadata");
          const body = await response.json() as Omit<MetadataResult, "error">;
          next.push({ ...body, filename: file.webkitRelativePath || file.name });
        } catch (error) {
          next.push({ filename: file.webkitRelativePath || file.name, metadata: {}, error: error instanceof Error ? error.message : "Could not read metadata." });
        }
      }
      setRecords(next);
      setNotice(`Read metadata from ${next.filter((record) => !record.error).length} of ${files.length} files.`);
    } finally {
      setProgress("");
      setWorking(false);
    }
  }

  async function stripMetadata() {
    if (!files.length || status.state !== "ready") return;
    setWorking(true);
    setNotice("");
    const results: ExportResult[] = [];
    let succeeded = 0;
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Creating clean copy ${index + 1} of ${files.length}: ${file.name}`);
        try {
          const response = await upload(file, "/api/exiftool/strip");
          results.push({ filename: file.name, zipPath: file.webkitRelativePath || file.name, blob: await response.blob() });
          succeeded += 1;
        } catch (error) {
          setNotice((current) => `${current}${current ? " " : ""}${file.name}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }
      if (succeeded) {
        setExports(results);
        setNotice((current) => `${current}${current ? " " : ""}${succeeded} cleaned file${succeeded === 1 ? "" : "s"} ready to export.`);
      }
    } finally {
      setProgress("");
      setWorking(false);
    }
  }

  async function downloadAll() {
    if (!exports.length) return;
    const zip = new JSZip();
    exports.forEach((result) => zip.file(result.zipPath, result.blob));
    downloadBlob(await zip.generateAsync({ type: "blob" }), "exiftool-cleaned-images.zip");
  }

  const metadataPreview = records[0] ? Object.entries(records[0].metadata).filter(([key]) => !["SourceFile", "File:FileName", "File:Directory"].includes(key)).slice(0, 18) : [];

  return <main className="exiftool-workspace">
    <section className="step-card exiftool-hero">
      <div className="step-intro"><span className="badge"><WandSparkles size={14} />Local ExifTool</span><h2>Photo metadata tools</h2><p>Runs on this laptop only.</p></div>
      <div className={`bridge-status is-${status.state}`}><span>{status.state === "ready" ? <CheckCircle2 size={19} /> : <ShieldAlert size={19} />}</span><div><strong>{status.state === "ready" ? `ExifTool ${status.version} is ready` : status.state === "checking" ? "Checking local bridge…" : "Local bridge is not connected"}</strong><small>{status.state === "ready" ? "Your browser can now use the local ExifTool installation." : status.message || "Start the companion service, then check it here."}</small></div></div>
      <div className="bridge-controls"><label className="field"><span>Local bridge URL</span><input value={bridgeUrl} inputMode="url" onChange={(event) => setBridgeUrl(event.target.value)} placeholder={defaultBridgeUrl} /></label><button className="ghost-button" type="button" disabled={status.state === "checking"} onClick={() => void checkBridge()}>{status.state === "checking" ? <LoaderCircle className="spin" size={18} /> : <ScanLine size={18} />}Check connection</button></div>
      <p className="bridge-help">Start once: <code>npm run exiftool:bridge</code></p>
    </section>

    <section className="step-card exiftool-sources">
      <div className="section-head"><div><p className="eyebrow">1. Sources</p><h3>Files or folder</h3><p>Choose what ExifTool should process.</p></div>{files.length ? <button className="ghost-button" type="button" onClick={() => { setFiles([]); setRecords([]); setExports([]); setNotice(""); }}>Clear</button> : null}</div>
      <div className="exiftool-pickers"><button className="picker-card" type="button" onClick={() => filesRef.current?.click()}><ImagePlus size={23} /><strong>Choose images</strong><span>Select one or more image files.</span></button><button className="picker-card" type="button" onClick={() => folderRef.current?.click()}><FolderOpen size={23} /><strong>Choose folder</strong><span>Process every selected file independently.</span></button></div>
      <input ref={filesRef} type="file" accept="image/*,.dng,.cr2,.nef,.arw,.raf,.orf,.rw2,.heic" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
      <input ref={folderRef} type="file" accept="image/*,.dng,.cr2,.nef,.arw,.raf,.orf,.rw2,.heic" multiple hidden {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
      {files.length ? <><div className="exiftool-selection"><Tags size={18} /><strong>{filesLabel}</strong><span>Remove any files you do not want to process.</span></div><div className="exiftool-file-list">{files.map((file, index) => <div className="exiftool-file-item" key={`${file.webkitRelativePath || file.name}-${index}`}><span title={file.webkitRelativePath || file.name}>{file.webkitRelativePath || file.name}</span><button className="remove-file-button" type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}><X size={15} /></button></div>)}</div></> : null}
    </section>

    <section className="step-card exiftool-actions">
      <div><p className="eyebrow">2. Operation</p><h3>Run ExifTool</h3><p>Copies only — originals stay unchanged.</p></div>
      <div className="exiftool-action-grid"><button className="operation-choice" type="button" disabled={!files.length || status.state !== "ready" || working} onClick={() => void inspectMetadata()}><FileSearch size={23} /><strong>Read metadata</strong><span>View the tags ExifTool finds in each selected file.</span></button><button className="operation-choice" type="button" disabled={!files.length || status.state !== "ready" || working} onClick={() => void stripMetadata()}><Tags size={23} /><strong>Remove all metadata</strong><span>Prepare cleaned copies with <code>-all=</code> for individual or ZIP download.</span></button></div>
      {working ? <p className="exiftool-progress"><LoaderCircle className="spin" size={17} />{progress}</p> : null}{notice ? <p className="exiftool-notice">{notice}</p> : null}
    </section>

    <section className="step-card exiftool-output">
      {!records.length && !exports.length ? <div className="exiftool-empty"><Tags size={24} /><div><p className="eyebrow">3. Results</p><h3>Ready when you are</h3><p>Your metadata preview or exported files will appear here.</p></div></div> : null}
      {records.length ? <div className="metadata-results"><div className="section-head"><div><p className="eyebrow">3. Metadata results</p><h3>{records[0].filename}</h3><p>{records.length} file{records.length === 1 ? "" : "s"} scanned · first 18 tags shown</p></div></div><dl>{metadataPreview.map(([key, value]) => <div key={key}><dt>{key.replace(/^[^:]+:/, "")}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>{records.some((record) => record.error) ? <p className="exiftool-error">Some files could not be read.</p> : null}</div> : null}
      {exports.length ? <div className="exiftool-export"><div className="section-head"><div><p className="eyebrow">3. Export</p><h3>{exports.length} cleaned file{exports.length === 1 ? "" : "s"} ready</h3><p>Download one file or the full batch.</p></div><button className="primary-button" type="button" onClick={() => void downloadAll()}><FileArchive size={18} />ZIP</button></div><div className="result-list">{exports.map((result, index) => <article className="exiftool-export-row" key={`${result.zipPath}-${index}`}><Tags size={19} /><div><strong>{result.filename}</strong><span>{Math.round(result.blob.size / 1024).toLocaleString()} KB · metadata removed</span></div><button className="ghost-button" type="button" onClick={() => downloadBlob(result.blob, result.filename)}><Download size={17} />Download</button></article>)}</div></div> : null}
    </section>
  </main>;
}
