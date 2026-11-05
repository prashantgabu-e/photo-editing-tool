import { createC2pa, Reader } from "@contentauth/c2pa-web";
import c2paWasmUrl from "@contentauth/c2pa-web/resources/c2pa.wasm?url";

let c2paPromise: ReturnType<typeof createC2pa> | undefined;

function c2pa() {
  c2paPromise ??= createC2pa({ wasmSrc: c2paWasmUrl });
  return c2paPromise;
}

export async function inspectContentCredentials(file: Blob) {
  try {
    const reader = await Reader.fromBlob(await c2pa(), file.type, file);
    if (!reader) return { detected: false, message: "No embedded Content Credentials detected." };
    try {
      const label = await reader.activeLabel();
      return { detected: true, message: label ? `Content Credentials detected (${label}).` : "Content Credentials detected." };
    } finally {
      await reader.free();
    }
  } catch (error) {
    return { detected: false, message: error instanceof Error ? `Content Credentials could not be checked: ${error.message}` : "Content Credentials could not be checked." };
  }
}
