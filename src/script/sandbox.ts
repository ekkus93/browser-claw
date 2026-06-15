/**
 * Sandboxed dynamic-script runtime (Part D3, spec §4.4 / §4.7).
 *
 * Dynamic v0.2 scripts run inside a QuickJS interpreter compiled to WASM
 * (quickjs-emscripten), NOT in the BrowserClaw app context. There is no
 * `eval`/`new Function` in app code: the script's source is handed to a fresh
 * QuickJS VM that, by construction, has none of the host's globals — no
 * `window`, `document`, `localStorage`, `indexedDB`, OPFS handles, `fetch`,
 * `XMLHttpRequest`, `WebSocket`, `chrome.*`, cookies, or secrets. The only way
 * out of the VM is through the mediated host functions explicitly injected by
 * the caller (Part D4); nothing else crosses the boundary.
 *
 * Async host capabilities are bridged with QuickJS deferred promises and a host
 * driver loop (not asyncify), so a script can `await` host calls inside loops
 * without stalling. The runtime owns the VM lifecycle, value marshalling, an
 * interrupt-based timeout/cancellation, and host-function injection. It runs no
 * untrusted code in the app realm.
 */

import { getQuickJS } from 'quickjs-emscripten';
import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSWASMModule,
} from 'quickjs-emscripten';

/**
 * A mediated host capability. It receives the script's call arguments already
 * marshalled to plain JS values and returns a JSON-serializable result (or a
 * promise of one). Throwing rejects the corresponding promise inside the VM.
 */
export type HostFunction = (...args: unknown[]) => Promise<unknown> | unknown;

/** Namespaced host APIs exposed as sandbox globals, e.g. `{ fs: { readText } }`. */
export type SandboxHostApi = Record<string, Record<string, HostFunction>>;

export type SandboxErrorKind =
  | 'script_error'
  | 'timeout'
  | 'cancelled'
  | 'limit_exceeded'
  | 'internal_error';

export type SandboxResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; errorKind: SandboxErrorKind };

export interface SandboxRunOptions {
  /** Wall-clock timeout; the interpreter is interrupted when it elapses. */
  timeoutMs?: number;
  /** Cancels execution at the next interrupt check. */
  signal?: AbortSignal;
  /** Mediated host APIs injected as sandbox globals (Part D4). */
  host?: SandboxHostApi;
  /** Injected clock (defaults to Date.now) for deterministic timeout tests. */
  now?: () => number;
}

let modulePromise: Promise<QuickJSWASMModule> | undefined;

/** Lazily load (and cache) the QuickJS WASM module. */
async function getModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) modulePromise = getQuickJS();
  return modulePromise;
}

/** Recursively marshal a plain JS value INTO the VM. Caller disposes the result. */
function toHandle(vm: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === undefined) return vm.undefined;
  if (value === null) return vm.null;
  switch (typeof value) {
    case 'string':
      return vm.newString(value);
    case 'number':
      return vm.newNumber(value);
    case 'boolean':
      return value ? vm.true : vm.false;
    case 'object': {
      if (Array.isArray(value)) {
        const arr = vm.newArray();
        value.forEach((item, index) => {
          const child = toHandle(vm, item);
          vm.setProp(arr, index, child);
          child.dispose();
        });
        return arr;
      }
      const obj = vm.newObject();
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const child = toHandle(vm, item);
        vm.setProp(obj, key, child);
        child.dispose();
      }
      return obj;
    }
    default:
      // functions / symbols / bigint never cross the boundary.
      return vm.undefined;
  }
}

/** Install one namespaced host API object onto the VM global. */
function installHostNamespace(
  vm: QuickJSContext,
  namespace: string,
  fns: Record<string, HostFunction>,
): void {
  const nsHandle = vm.newObject();
  for (const [name, fn] of Object.entries(fns)) {
    const fnHandle = vm.newFunction(
      `${namespace}.${name}`,
      (...argHandles: QuickJSHandle[]) => {
        const args = argHandles.map((handle) => vm.dump(handle));
        const deferred = vm.newPromise();
        // Run the host capability off the VM call stack; a sync throw inside an
        // async fn becomes a rejection either way.
        Promise.resolve()
          .then(() => fn(...args))
          .then(
            (result) => {
              const handle = toHandle(vm, result);
              deferred.resolve(handle);
              handle.dispose();
            },
            (error: unknown) => {
              const message =
                error instanceof Error ? error.message : String(error);
              const errorHandle = vm.newError(message);
              deferred.reject(errorHandle);
              errorHandle.dispose();
            },
          );
        // Pump the VM's job queue once this promise settles.
        deferred.settled.then(() => vm.runtime.executePendingJobs());
        return deferred.handle;
      },
    );
    vm.setProp(nsHandle, name, fnHandle);
    fnHandle.dispose();
  }
  vm.setProp(vm.global, namespace, nsHandle);
  nsHandle.dispose();
}

/** Wrap the script so it can use top-level `await` and `return` a result. */
function wrapScript(code: string): string {
  return `(async () => {\n${code}\n})()`;
}

/**
 * Run an untrusted script inside an isolated QuickJS VM. Returns the script's
 * marshalled result, or a classified error. The VM and all handles are disposed
 * before returning, regardless of outcome.
 */
export async function runSandboxedScript(
  code: string,
  options: SandboxRunOptions = {},
  injectedModule?: QuickJSWASMModule,
): Promise<SandboxResult> {
  const module = injectedModule ?? (await getModule());
  const vm = module.newContext();
  const now = options.now ?? Date.now;
  const start = now();
  let interruptReason: 'timeout' | 'cancelled' | null = null;

  const overBudget = (): 'timeout' | 'cancelled' | null => {
    if (options.signal?.aborted) return 'cancelled';
    if (options.timeoutMs !== undefined && now() - start > options.timeoutMs) {
      return 'timeout';
    }
    return null;
  };

  try {
    vm.runtime.setInterruptHandler(() => {
      const reason = overBudget();
      if (reason) interruptReason = reason;
      return reason !== null;
    });

    if (options.host) {
      for (const [namespace, fns] of Object.entries(options.host)) {
        installHostNamespace(vm, namespace, fns);
      }
    }

    const evalResult = vm.evalCode(wrapScript(code));
    if (evalResult.error) {
      const message = describeError(vm, evalResult.error);
      evalResult.error.dispose();
      return failFromInterrupt(interruptReason, message);
    }

    // Drive the script's returned promise to settlement, pumping the VM job
    // queue and yielding to the host event loop so awaited host calls progress.
    const native = vm.resolvePromise(evalResult.value);
    evalResult.value.dispose();
    let settled: Awaited<typeof native> | undefined;
    void native.then((result) => {
      settled = result;
    });

    while (settled === undefined) {
      const reason = overBudget();
      if (reason) {
        interruptReason = reason;
        return failFromInterrupt(reason, 'interrupted');
      }
      const jobs = vm.runtime.executePendingJobs();
      if (jobs.error) jobs.error.dispose();
      await new Promise((resolve) => setTimeout(resolve));
    }

    if (settled.error) {
      const message = describeError(vm, settled.error);
      settled.error.dispose();
      return failFromInterrupt(interruptReason, message);
    }
    const value = settled.value ? vm.dump(settled.value) : undefined;
    settled.value?.dispose();
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failFromInterrupt(interruptReason, message);
  } finally {
    vm.dispose();
  }
}

function describeError(vm: QuickJSContext, handle: QuickJSHandle): string {
  const dumped = vm.dump(handle) as unknown;
  if (dumped && typeof dumped === 'object' && 'message' in dumped) {
    const { name, message } = dumped as { name?: string; message?: string };
    return name ? `${name}: ${message ?? ''}`.trim() : String(message);
  }
  return String(dumped);
}

function failFromInterrupt(
  reason: 'timeout' | 'cancelled' | null,
  message: string,
): SandboxResult {
  if (reason === 'timeout') {
    return { ok: false, error: 'script timed out', errorKind: 'timeout' };
  }
  if (reason === 'cancelled') {
    return { ok: false, error: 'script cancelled', errorKind: 'cancelled' };
  }
  return { ok: false, error: message, errorKind: 'script_error' };
}
