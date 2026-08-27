export class ProcessingQueue {
  constructor({ workerScript, onItemUpdate, onProgress, processorFallback }) {
    this.workerScript = workerScript;
    this.onItemUpdate = onItemUpdate;
    this.onProgress = onProgress;
    this.processorFallback = processorFallback;
    this.activeWorkers = new Map();
    this.pendingItems = [];
    this.paused = false;
    this.cancelled = false;
    this.completed = 0;
    this.schedule = null;
  }

  async process(items, settings, concurrency) {
    this.pendingItems = [...items];
    this.paused = false;
    this.cancelled = false;
    this.completed = 0;
    const limit = Math.max(1, concurrency);

    return new Promise((resolve) => {
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
          this.runItem(item, settings, this.schedule);
        }

        if (this.activeWorkers.size === 0 && this.pendingItems.length === 0) {
          this.schedule = null;
          resolve();
        }
      };

      this.schedule();
    });
  }

  runItem(item, settings, schedule) {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      this.runFallback(item, settings, schedule);
      return;
    }

    const worker = new Worker(this.workerScript, { type: "module" });
    this.activeWorkers.set(item.id, worker);
    this.onItemUpdate(item.id, { status: "processing", error: "", warnings: [] });

    worker.onmessage = (event) => {
      if (event.data.type === "done") {
        this.onItemUpdate(item.id, {
          status: "done",
          result: event.data.result,
          error: "",
          warnings: event.data.result.warnings || [],
        });
      } else if (event.data.type === "error") {
        this.onItemUpdate(item.id, {
          status: "failed",
          error: event.data.error,
          warnings: [],
        });
      }

      worker.terminate();
      this.activeWorkers.delete(item.id);
      this.completed += 1;
      this.onProgress();
      schedule();
    };

    worker.onerror = (event) => {
      this.onItemUpdate(item.id, {
        status: "failed",
        error: event.message || "Worker failed unexpectedly.",
      });
      worker.terminate();
      this.activeWorkers.delete(item.id);
      this.completed += 1;
      this.onProgress();
      schedule();
    };

    worker.postMessage({
      type: "process",
      file: item.file,
      settings,
    });
  }

  async runFallback(item, settings, schedule) {
    this.onItemUpdate(item.id, { status: "processing", error: "", warnings: [] });
    try {
      const result = await this.processorFallback(item.file, settings);
      this.onItemUpdate(item.id, {
        status: "done",
        result,
        error: "",
        warnings: result.warnings || [],
      });
    } catch (error) {
      this.onItemUpdate(item.id, {
        status: "failed",
        error: error.message || "Image processing failed.",
        warnings: [],
      });
    }

    this.completed += 1;
    this.onProgress();
    schedule();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    if (this.schedule) {
      this.schedule();
    }
  }

  cancel() {
    this.cancelled = true;
  }

  terminateAll() {
    this.activeWorkers.forEach((worker) => worker.terminate());
    this.activeWorkers.clear();
  }
}
