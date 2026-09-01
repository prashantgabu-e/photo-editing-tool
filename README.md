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
- Browser re-encoding usually strips most metadata.
- `PNG` preserves transparency, while `JPEG` uses the selected background color for transparent areas.
- `GIF` input is decoded as a still image frame by browser image APIs.
