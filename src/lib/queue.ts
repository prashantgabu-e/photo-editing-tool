import type { ProcessedResult, Settings } from "../types";

type ItemLike = { id: string; file: File };

type ItemPatch = {
  status?: "waiting" | "processing" | "done" | "failed" | "cancelled";
  result?: ProcessedResult;
  warnings?: string[];
  error?: string;
};

interface QueueConfig {
  createWorker: () => Worker;
  onItemUpdate: (itemId: string, patch: ItemPatch) => void;
  onProgress: () => void;
  processorFallback: (file: File, settings: Settings) => Promise<ProcessedResult>;
}

export class ProcessingQueue<TItem extends ItemLike> {
  private createWorker: QueueConfig["createWorker"];
  private onItemUpdate: QueueConfig["onItemUpdate"];
  private onProgress: QueueConfig["onProgress"];
  private processorFallback: QueueConfig["processorFallback"];
  private activeWorkers = new Map<string, Worker>();
  private pendingItems: TItem[] = [];
  private paused = false;
  private cancelled = false;
  private schedule: (() => void) | null = null;

  constructor(config: QueueConfig) {
    this.createWorker = config.createWorker;
    this.onItemUpdate = config.onItemUpdate;
    this.onProgress = config.onProgress;
    this.processorFallback = config.processorFallback;
  }

  async process(items: TItem[], settings: Settings, concurrency: number) {
    this.pendingItems = [...items];
    this.paused = false;
    this.cancelled = false;
    const limit = Math.max(1, concurrency);

    return new Promise<void>((resolve) => {
      this.schedule = () => {
        if (this.cancelled) {
          this.terminateAll();
          resolve();
          return;
        }

        if (this.paused) {
          return;
        }

        while (this.activeWorkers.size < limit && this.pendingItems.length) {
          const item = this.pendingItems.shift();
          if (item) {
            this.runItem(item, settings, this.schedule!);
          }
        }

        if (this.activeWorkers.size === 0 && this.pendingItems.length === 0) {
          this.schedule = null;
          resolve();
        }
      };

      this.schedule();
    });
  }

  private runItem(item: TItem, settings: Settings, schedule: () => void) {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      void this.runFallback(item, settings, schedule);
      return;
    }

    const worker = this.createWorker();
    this.activeWorkers.set(item.id, worker);
    this.onItemUpdate(item.id, { status: "processing", error: "", warnings: [] });

    worker.onmessage = (event: MessageEvent<{ type: "done" | "error"; result?: ProcessedResult; error?: string }>) => {
      if (event.data.type === "done" && event.data.result) {
        this.onItemUpdate(item.id, {
          status: "done",
          result: event.data.result,
          error: "",
          warnings: event.data.result.warnings || [],
        });
      } else {
        this.onItemUpdate(item.id, {
          status: "failed",
          error: event.data.error || "Image processing failed.",
          warnings: [],
        });
      }

      worker.terminate();
      this.activeWorkers.delete(item.id);
      this.onProgress();
      schedule();
    };

    worker.onerror = (event) => {
      this.onItemUpdate(item.id, {
        status: "failed",
        error: event.message || "Worker failed unexpectedly.",
        warnings: [],
      });
      worker.terminate();
      this.activeWorkers.delete(item.id);
      this.onProgress();
      schedule();
    };

    worker.postMessage({
      type: "process",
      file: item.file,
      settings,
    });
  }

  private async runFallback(item: TItem, settings: Settings, schedule: () => void) {
    this.onItemUpdate(item.id, { status: "processing", error: "", warnings: [] });
    try {
      const result = await this.processorFallback(item.file, settings);
      this.onItemUpdate(item.id, { status: "done", result, error: "", warnings: result.warnings || [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image processing failed.";
      this.onItemUpdate(item.id, { status: "failed", error: message, warnings: [] });
    }

    this.onProgress();
    schedule();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.schedule?.();
  }

  cancel() {
    this.cancelled = true;
  }

  terminateAll() {
    this.activeWorkers.forEach((worker) => worker.terminate());
    this.activeWorkers.clear();
  }
}
