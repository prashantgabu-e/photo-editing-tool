import { buildTodayStamp } from "./utils.js";

export async function buildZip(items, zipName) {
  const zip = new window.JSZip();
  const folder = zip.folder("processed");

  items
    .filter((item) => item.result?.blob && item.outputName)
    .forEach((item) => {
      folder.file(item.outputName, item.result.blob);
    });

  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `${(zipName || "processed-images").trim() || "processed-images"}-${buildTodayStamp()}.zip`,
  };
}
