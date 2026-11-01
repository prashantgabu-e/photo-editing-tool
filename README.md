# PixelBatch

PixelBatch is a React 19 + TypeScript image workspace for batch resizing, cropping, converting, renaming, and exporting images directly in the browser. The app is mobile-first, installable as a PWA, and built for static deployment to `docs/` on GitHub Pages.

## Tech Stack

- Frontend: React 19 with TypeScript
- Build tool: Vite 7
- Routing: React Router with hash-based routes for GitHub Pages
- UI: Custom CSS and Lucide React icons
- Deployment: Static build output to `docs/`
- PWA: Web manifest + service worker + install prompt

## Features

- Mobile-first card layout with bottom navigation
- Multi-image upload with drag-and-drop
- Resize modes: exact, width, height, max bounds, percentage
- Crop modes: cover, contain, fit, fill, exact crop
- Aspect ratio presets, custom ratios, and manual focal controls
- WebP, PNG, and JPEG export
- Quality presets and target-size reduction for JPEG/WebP
- Batch rename modes: keep, prefix, suffix, sequential, find/replace
- Queue-based processing with worker-backed batch execution
- ZIP export for processed results
- Local settings and custom preset persistence with `localStorage`
- Light, dark, and system theme support

## Run Locally

```powershell
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## ExifTool workspace

The **ExifTool** workspace is intentionally separate from the browser batch editor. Web browsers and GitHub Pages cannot execute programs installed on a visitor's computer, so the workspace uses a small companion service running on `127.0.0.1`.

1. Install [ExifTool](https://exiftool.org/) and make sure `exiftool` is available on your system PATH.
2. In a second terminal at the project root, run:

   ```powershell
   npm run exiftool:bridge
   ```

3. In the app, open **ExifTool** and select **Check connection**. The default bridge URL is `http://127.0.0.1:4318`.

The first version supports reading metadata and making a ZIP of copies with all metadata removed. Browser-selected files (including folder selections) are uploaded only to the local bridge, processed in a temporary directory, and deleted there after each operation. The originals are not modified.

If ExifTool is installed outside your PATH, start the bridge with its explicit location:

```powershell
$env:EXIFTOOL_PATH = "C:\\path\\to\\exiftool.exe"
npm run exiftool:bridge
```

If port `4318` is already used, either keep using the bridge already running there or choose another port and enter its URL in the ExifTool workspace:

```powershell
$env:EXIFTOOL_BRIDGE_PORT = "4319"
npm run exiftool:bridge
```

## Build for GitHub Pages

```powershell
npm run build
```

This writes the production-ready static site to `docs/`.

## Deploy

1. Push the repository to GitHub.
2. In the repository settings, open `Pages`.
3. Set the source to deploy from the branch and `/docs` folder.
4. Save and wait for GitHub Pages to publish.

## Notes

- Images are processed locally in the browser and are not uploaded anywhere.
- The ExifTool workspace requires the user to run the local companion service, including when this UI is deployed on GitHub Pages. A GitHub Pages deployment alone cannot access locally installed ExifTool.
- Browser re-encoding usually strips most metadata.
- `PNG` preserves transparency, while `JPEG` uses the selected background color for transparent areas.
- `GIF` input is decoded as a still image frame by browser image APIs.
