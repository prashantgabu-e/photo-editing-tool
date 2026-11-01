import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const port = Number(process.env.EXIFTOOL_BRIDGE_PORT || 4319);
const exiftoolPath = process.env.EXIFTOOL_PATH || (process.platform === "win32" ? "exiftool.exe" : "exiftool");
const maxUploadBytes = Number(process.env.EXIFTOOL_MAX_UPLOAD_BYTES || 250 * 1024 * 1024);

function isAllowedOrigin(origin) {
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/[^/]+\.github\.io$/.test(origin);
}

function headers(origin, extra = {}) {
  return {
    ...(isAllowedOrigin(origin) && origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-file-name",
    ...extra,
  };
}

function runExiftool(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exiftoolPath, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      const errorText = Buffer.concat(stderr).toString().trim();
      if (code !== 0) reject(new Error(errorText || `ExifTool exited with code ${code}.`));
      else resolve({ stdout: Buffer.concat(stdout), stderr: errorText });
    });
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxUploadBytes) {
        reject(new Error(`Files must be ${Math.floor(maxUploadBytes / 1024 / 1024)} MB or smaller.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function safeFilename(value) {
  const name = basename(String(value || "upload"));
  return name.replace(/[^a-zA-Z0-9._() -]/g, "_") || "upload";
}

async function withTemporaryUpload(request, callback) {
  const filename = safeFilename(request.headers["x-file-name"]);
  const folder = await mkdtemp(join(tmpdir(), "pixelbatch-exiftool-"));
  const input = join(folder, `${randomUUID()}-${filename}`);
  try {
    await writeFile(input, await readRequestBody(request));
    return await callback({ folder, input, filename });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function sendJson(response, status, origin, payload) {
  response.writeHead(status, headers(origin, { "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    sendJson(response, 403, origin, { error: "This origin is not allowed to use the local ExifTool bridge." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers(origin));
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/api/exiftool/health") {
      const { stdout } = await runExiftool(["-ver"]);
      sendJson(response, 200, origin, { available: true, version: stdout.toString().trim() });
      return;
    }

    if (request.method === "POST" && request.url === "/api/exiftool/metadata") {
      const result = await withTemporaryUpload(request, async ({ input, filename }) => {
        const { stdout } = await runExiftool(["-j", "-G1", "-n", input]);
        const [metadata = {}] = JSON.parse(stdout.toString());
        return { filename, metadata };
      });
      sendJson(response, 200, origin, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/exiftool/strip") {
      const result = await withTemporaryUpload(request, async ({ folder, input, filename }) => {
        const output = join(folder, `clean-${randomUUID()}${extname(filename)}`);
        await runExiftool(["-all=", "-o", output, input]);
        return { filename, file: await readFile(output) };
      });
      response.writeHead(200, headers(origin, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${result.filename}"`,
      }));
      response.end(result.file);
      return;
    }

    sendJson(response, 404, origin, { error: "Route not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ExifTool bridge failed.";
    sendJson(response, 500, origin, { error: message });
  }
});

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`ExifTool bridge could not start: port ${port} is already in use.`);
    console.error("Use the bridge already running on that port, stop it, or set EXIFTOOL_BRIDGE_PORT to a free port.");
  } else {
    console.error("ExifTool bridge could not start:", error.message);
  }
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ExifTool bridge listening at http://127.0.0.1:${port}`);
  console.log(`Using ExifTool: ${exiftoolPath}`);
});
