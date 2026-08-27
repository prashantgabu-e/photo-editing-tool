# PixelBatch

PixelBatch is a fully client-side batch image processing tool for ecommerce and product photography workflows. It runs entirely in the browser, supports GitHub Pages deployment, and keeps images on the user's device.

## Features

- Multi-image upload with drag-and-drop
- Resize modes: exact, width, height, max bounds, percentage
- Crop modes: cover, contain, fit, fill, exact crop
- Aspect ratio presets and manual focal crop controls
- WebP, PNG, and JPEG export
- Quality presets and iterative target-size reduction for JPEG/WebP
- Batch rename modes: keep, prefix, suffix, sequential, find/replace
- Queue-based processing with configurable concurrency
- ZIP export for processed results
- Local settings and custom preset persistence with `localStorage`
- Light, dark, and system theme support

## Processing Pipeline

The app follows this order:

1. Decode image
2. Normalize EXIF orientation
3. Determine crop and output dimensions
4. Crop and/or fit image
5. Resize output
6. Add padding/background if needed
7. Encode in the selected format
8. Apply target file-size logic where enabled
9. Rename output
10. Add result to the download queue
11. Release temporary memory

## Project Structure

```text
.
|-- index.html
|-- css/
|   `-- styles.css
|-- js/
|   |-- app.js
|   |-- crop.js
|   |-- encoder.js
|   |-- presets.js
|   |-- processor.js
|   |-- queue.js
|   |-- renamer.js
|   |-- resize.js
|   |-- state.js
|   |-- storage.js
|   |-- ui.js
|   |-- utils.js
|   `-- zip.js
`-- workers/
    `-- image-worker.js
```

## Run Locally

Because the app uses ES modules and web workers, open it through a static server instead of double-clicking `index.html`.

Examples:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, open `Pages`.
3. Set the source to deploy from the main branch root.
4. Save and wait for GitHub Pages to publish the site.

No backend, build step, secrets, or environment variables are required.

## Notes

- Images are processed locally in the browser and are not uploaded anywhere.
- Browser re-encoding usually strips most metadata.
- `PNG` output preserves transparency, while `JPEG` uses the selected background color for transparent areas.
- `GIF` input is decoded as a still image frame by browser image APIs.
