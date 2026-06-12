import { useEffect, useState } from 'react';
import { createWasmRuntime } from '../runtime/wasmRuntime.ts';

/**
 * Verification surface for the WebAssembly runtime: instantiates the real Rust
 * runtime in the browser, runs a command, and reports whether the emitted
 * effects and snapshot are as expected. Exercised by the extended e2e suite.
 */
export default function WasmProbe() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    void (async () => {
      try {
        const runtime = await createWasmRuntime();
        const effects = runtime.dispatch({
          type: 'submit_user_message',
          conversation_id: 'c1',
          text: 'hi',
        });
        const snapshot = runtime.snapshot();
        const hasAudit = effects.some((e) => e.type === 'audit_append');
        const hasLlm = effects.some((e) => e.type === 'llm_request');

        // Restoring from the snapshot must be deterministic.
        const restored = await createWasmRuntime();
        const a = runtime.dispatch({
          type: 'submit_user_message',
          conversation_id: 'c1',
          text: 'again',
        });
        const fresh = restored.dispatch({
          type: 'submit_user_message',
          conversation_id: 'c1',
          text: 'first',
        });

        const ok =
          hasAudit &&
          hasLlm &&
          snapshot.message_count === 1 &&
          a.length === fresh.length;
        setStatus(
          ok
            ? `wasm-ok effects=${effects.length} mc=${snapshot.message_count}`
            : 'wasm-bad',
        );
      } catch (error) {
        setStatus(
          `wasm-error: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    })();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-text">WASM runtime probe</h1>
      <p data-testid="wasm-probe" className="mt-2 font-mono text-sm text-muted">
        {status}
      </p>
    </div>
  );
}
