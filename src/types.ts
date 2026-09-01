export type ThemeMode = "system" | "light" | "dark";
export type ResizeMode = "exact" | "width" | "height" | "max" | "percentage";
export type AspectRatio = "original" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "custom";
export type CropMode = "cover" | "contain" | "fill" | "fit" | "exact";
export type CropAnchor = "center" | "top" | "bottom" | "left" | "right" | "focal";
export type OutputFormat = "image/webp" | "image/png" | "image/jpeg";
export type QualityPreset = "maximum" | "high" | "balanced" | "small" | "custom";
export type ToggleMode = "off" | "on";
export type PaddingMode = "transparent" | "white" | "black" | "custom";
export type RenameMode = "keep" | "prefix" | "suffix" | "sequential" | "findReplace";
export type ConcurrencyMode = "auto" | "1" | "2" | "4";
export type MetadataMode = "strip" | "keep";
export type QueueStatus = "waiting" | "processing" | "done" | "failed" | "cancelled";

export interface Settings {
  theme: ThemeMode;
  presetId: string;
  resizeMode: ResizeMode;
  width: number;
  height: number;
  scale: number;
  aspectRatio: AspectRatio;
  customRatioWidth: number;
  customRatioHeight: number;
  cropMode: CropMode;
  cropAnchor: CropAnchor;
  focalX: number;
  focalY: number;
  format: OutputFormat;
  quality: number;
  qualityPreset: QualityPreset;
  targetSizeEnabled: ToggleMode;
  targetSizeValue: number;
  targetSizeUnit: "KB" | "MB";
  paddingMode: PaddingMode;
  backgroundColor: string;
  preventEnlargement: boolean;
  maintainAspect: boolean;
  renameMode: RenameMode;
  renameValueA: string;
  renameValueB: string;
  renameStart: number;
  renamePadding: number;
  sanitizeFilenames: boolean;
  zipName: string;
  concurrency: ConcurrencyMode;
  metadataMode: MetadataMode;
}

export interface StoredPreset {
  id: string;
  name: string;
  builtIn?: boolean;
  settings: Partial<Settings> | null;
}

export interface ProcessedResult {
  blob: Blob;
  width: number;
  height: number;
  warnings: string[];
  downloadUrl?: string;
}

export interface QueueItem {
  id: string;
  file: File;
  mime: string;
  width: number;
  height: number;
  previewUrl: string;
  status: QueueStatus;
  error: string;
  warnings: string[];
  result: ProcessedResult | null;
  outputName: string;
  previewProcessedUrl?: string;
  resultPreviewOnly?: ProcessedResult | null;
  overrides: Partial<Pick<Settings, "cropAnchor" | "focalX" | "focalY">>;
  processingSettings?: Settings;
}

export interface BatchHistoryEntry {
  id: string;
  createdAt: string;
  count: number;
  settings: Settings;
  zipName: string;
}
