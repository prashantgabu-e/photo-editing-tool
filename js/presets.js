export const qualityPresets = {
  maximum: { jpeg: 95, webp: 95 },
  high: { jpeg: 90, webp: 90 },
  balanced: { jpeg: 85, webp: 82 },
  small: { jpeg: 72, webp: 70 },
};

export const builtInPresets = [
  {
    id: "custom-current",
    name: "Current Settings",
    builtIn: true,
    settings: null,
  },
  {
    id: "product-portrait",
    name: "Product Portrait",
    builtIn: true,
    settings: {
      resizeMode: "exact",
      width: 1024,
      height: 1536,
      aspectRatio: "2:3",
      cropMode: "cover",
      cropAnchor: "center",
      format: "image/webp",
      quality: 85,
      qualityPreset: "balanced",
    },
  },
  {
    id: "square-product",
    name: "Square Product",
    builtIn: true,
    settings: {
      resizeMode: "exact",
      width: 1200,
      height: 1200,
      aspectRatio: "1:1",
      cropMode: "cover",
      cropAnchor: "center",
      format: "image/webp",
      quality: 85,
      qualityPreset: "balanced",
    },
  },
  {
    id: "instagram-portrait",
    name: "Instagram Portrait",
    builtIn: true,
    settings: {
      resizeMode: "exact",
      width: 1080,
      height: 1350,
      aspectRatio: "4:5",
      cropMode: "cover",
      cropAnchor: "center",
      format: "image/webp",
      quality: 85,
      qualityPreset: "balanced",
    },
  },
  {
    id: "shopify-portrait",
    name: "Shopify Portrait",
    builtIn: true,
    settings: {
      resizeMode: "exact",
      width: 1200,
      height: 1800,
      aspectRatio: "2:3",
      cropMode: "cover",
      cropAnchor: "center",
      format: "image/webp",
      quality: 85,
      qualityPreset: "balanced",
    },
  },
  {
    id: "full-hd",
    name: "Full HD",
    builtIn: true,
    settings: {
      resizeMode: "exact",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
      cropMode: "cover",
      cropAnchor: "center",
      format: "image/jpeg",
      quality: 90,
      qualityPreset: "high",
    },
  },
];

export function mergePresetLists(customPresets) {
  return [
    ...builtInPresets,
    ...customPresets.map((preset) => ({ ...preset, builtIn: false })),
  ];
}
