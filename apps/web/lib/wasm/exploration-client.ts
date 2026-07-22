"use client";

import type {
  ExplorationFilters,
  ExplorationWorkerLoadResult,
  ExplorationWorkerQueryResult,
  ExplorationWorkerRequest,
  ExplorationWorkerResponse,
} from "./exploration-types";

type PendingRequest = {
  readonly resolve: (
    value: ExplorationWorkerLoadResult | ExplorationWorkerQueryResult,
  ) => void;
  readonly reject: (reason: Error) => void;
};

type WorkerRequestInput = ExplorationWorkerRequest extends infer Request
  ? Request extends { readonly id: number }
    ? Omit<Request, "id">
    : never
  : never;

let activeClient: ExplorationWorkerClient | null = null;

function activateClient(client: ExplorationWorkerClient) {
  activeClient?.dispose("A newer local exploration workspace replaced this one");
  activeClient = client;
}

export class ExplorationWorkerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #disposed = false;
  #disposeReason = "The exploration worker was disposed";
  #leases = 0;
  #releaseTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #disposeListeners = new Set<(reason: string) => void>();

  constructor() {
    this.#worker = new Worker(new URL("./exploration.worker.ts", import.meta.url), {
      type: "module",
    });
    this.#worker.addEventListener(
      "message",
      (event: MessageEvent<ExplorationWorkerResponse>) => {
        const pending = this.#pending.get(event.data.id);

        if (pending === undefined) {
          return;
        }

        this.#pending.delete(event.data.id);

        if (event.data.ok) {
          pending.resolve(event.data.result);
        } else {
          pending.reject(new Error(event.data.error));
        }
      },
    );
    this.#worker.addEventListener("error", (event) => {
      this.dispose(event.message || "The exploration worker failed");
    });
  }

  activate() {
    if (!this.#disposed) {
      activateClient(this);
    }
  }

  #request(
    request: WorkerRequestInput,
    transfer: Transferable[] = [],
  ): Promise<ExplorationWorkerLoadResult | ExplorationWorkerQueryResult> {
    if (this.#disposed) {
      return Promise.reject(new Error(this.#disposeReason));
    }

    const id = this.#nextId;
    this.#nextId += 1;

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });

      try {
        this.#worker.postMessage({ ...request, id }, transfer);
      } catch (cause) {
        this.#pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  retain() {
    if (this.#disposed) {
      return false;
    }

    this.#leases += 1;

    if (this.#releaseTimer !== null) {
      clearTimeout(this.#releaseTimer);
      this.#releaseTimer = null;
    }

    return true;
  }

  release() {
    this.#leases = Math.max(0, this.#leases - 1);

    if (this.#leases === 0 && this.#releaseTimer === null) {
      this.#releaseTimer = setTimeout(() => {
        this.#releaseTimer = null;

        if (this.#leases === 0) {
          this.dispose();
        }
      }, 0);
    }
  }

  onDisposed(listener: (reason: string) => void) {
    this.#disposeListeners.add(listener);

    if (this.#disposed) {
      listener(this.#disposeReason);
    }

    return () => this.#disposeListeners.delete(listener);
  }

  async load(
    bytes: ArrayBuffer,
    configuration: {
      readonly dayCount: number;
      readonly binCount: number;
      readonly bucketMinimum: number;
      readonly bucketWidth: number;
      readonly cardinalities: readonly [number, number, number];
    },
  ): Promise<ExplorationWorkerLoadResult> {
    const result = await this.#request(
      { type: "load", bytes, ...configuration },
      [bytes],
    );

    return result as ExplorationWorkerLoadResult;
  }

  async query(input: {
    readonly startDay: number;
    readonly endDay: number;
    readonly filters: ExplorationFilters;
    readonly includeDensity: boolean;
  }): Promise<ExplorationWorkerQueryResult> {
    return (await this.#request({ type: "query", ...input })) as ExplorationWorkerQueryResult;
  }

  dispose(reason = "The exploration worker was disposed") {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#disposeReason = reason;

    if (this.#releaseTimer !== null) {
      clearTimeout(this.#releaseTimer);
      this.#releaseTimer = null;
    }

    this.#worker.terminate();
    const error = new Error(reason);

    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }

    this.#pending.clear();

    for (const listener of this.#disposeListeners) {
      listener(reason);
    }

    this.#disposeListeners.clear();

    if (activeClient === this) {
      activeClient = null;
    }
  }
}
