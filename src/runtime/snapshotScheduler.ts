/**
 * Coalesces runtime snapshot saves. The runtime can settle through many states
 * per turn; rather than write IndexedDB on every transition, callers `schedule()`
 * a save and the scheduler debounces them into a single write. Durable points
 * (idle/error/page hide/shutdown) call `flush()` to persist immediately.
 *
 * Save failures are never swallowed: `onError` is invoked and the pending flag
 * is kept so the next flush retries. See HARDENING_NOTES.md and replies1.md Q5.
 */
export class SnapshotScheduler {
  readonly #save: () => Promise<void>;
  readonly #delayMs: number;
  readonly #onError: ((error: unknown) => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending = false;
  #running = false;

  constructor(
    save: () => Promise<void>,
    delayMs = 500,
    onError?: (error: unknown) => void,
  ) {
    this.#save = save;
    this.#delayMs = delayMs;
    this.#onError = onError;
  }

  /** Request a save; coalesced into a single write after the debounce delay. */
  schedule(): void {
    this.#pending = true;
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        void this.#run();
      }, this.#delayMs);
    }
  }

  /** Persist now if anything is pending (idle/error/before-unload). */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#run();
  }

  async #run(): Promise<void> {
    this.#timer = undefined;
    if (!this.#pending || this.#running) return;
    this.#running = true;
    this.#pending = false;
    try {
      await this.#save();
    } catch (error) {
      // Keep it pending so a later flush retries, and surface the failure.
      this.#pending = true;
      this.#onError?.(error);
    } finally {
      this.#running = false;
    }
  }
}
