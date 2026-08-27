import { loadCustomPresets, loadSettings } from "./storage.js";

export const defaultSettings = {
  theme: "system",
  presetId: "product-portrait",
  resizeMode: "exact",
  width: 1024,
  height: 1536,
  scale: 100,
  aspectRatio: "2:3",
  customRatioWidth: 2,
  customRatioHeight: 3,
  cropMode: "cover",
  cropAnchor: "center",
  focalX: 50,
  focalY: 50,
  format: "image/webp",
  quality: 85,
  qualityPreset: "balanced",
  targetSizeEnabled: "off",
  targetSizeValue: 500,
  targetSizeUnit: "KB",
  paddingMode: "transparent",
  backgroundColor: "#ffffff",
  preventEnlargement: true,
  maintainAspect: true,
  renameMode: "keep",
  renameValueA: "",
  renameValueB: "",
  renameStart: 1,
  renamePadding: 3,
  sanitizeFilenames: true,
  zipName: "processed-images",
  concurrency: "auto",
  metadataMode: "strip",
};

export function createState() {
  return {
    settings: loadSettings(defaultSettings),
    customPresets: loadCustomPresets(),
    items: [],
    selectedItemId: null,
    processing: false,
    paused: false,
    zipBlob: null,
    zipFilename: "",
  };
}
