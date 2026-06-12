import wasmUrl from './wasm/claw_wasm_bg.wasm?url';
import type { ClawRuntimePort, RuntimeSnapshot } from './referenceRuntime.ts';
import type { Command, Effect } from './effectTypes.ts';

/**
 * Loads the real Rust runtime compiled to WebAssembly (built with wasm-pack
 * into ./wasm) and adapts it to the same ClawRuntimePort the TS reference
 * runtime implements — so it's a drop-in replacement. The wasm glue + binary
 * are loaded lazily, so they never enter the main bundle.
 */
export async function createWasmRuntime(
  snapshot?: RuntimeSnapshot,
): Promise<ClawRuntimePort> {
  const wasm = await import('./wasm/claw_wasm.js');
  await wasm.default({ module_or_path: wasmUrl });
  const runtime = snapshot
    ? wasm.ClawRuntime.fromSnapshot(JSON.stringify(snapshot))
    : new wasm.ClawRuntime();

  return {
    dispatch(command: Command): Effect[] {
      return JSON.parse(runtime.dispatch(JSON.stringify(command))) as Effect[];
    },
    snapshot(): RuntimeSnapshot {
      return JSON.parse(runtime.snapshot()) as RuntimeSnapshot;
    },
  };
}
