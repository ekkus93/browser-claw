import { useEffect, useRef, useState } from 'react';
import { isWllamaSupported, getWllamaEngine } from '../wllama/engine.ts';
import { MODEL_CATALOG } from '../wllama/catalog.ts';
import { db } from '../db/db.ts';
import { setWllamaCdnConsent } from '../settings/appSettings.ts';

/**
 * Verification surface for the real wllama engine: downloads a small GGUF from
 * Hugging Face, loads it (WASM, single-threaded), and runs a real completion.
 * Exercised only by the extended e2e suite (heavy, network-dependent).
 */
export default function WllamaProbe() {
  const [status, setStatus] = useState('idle');
  const [pct, setPct] = useState(0);
  // StrictMode invokes effects twice in dev; load the model only once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (!isWllamaSupported()) {
          setStatus('unsupported');
          return;
        }
        const model = MODEL_CATALOG.find((m) => m.id === 'smollm2-135m');
        if (!model) {
          setStatus('no-model');
          return;
        }
        // This probe is an authorized verification surface: grant CDN consent
        // so the fail-closed gate (Phase 8.1) lets the real runtime load.
        await setWllamaCdnConsent(db, true);
        const engine = getWllamaEngine();
        setStatus('downloading');
        await engine.download(model, (loaded, total) => {
          if (total > 0) setPct(Math.round((loaded / total) * 100));
        });
        setStatus('inferring');
        const text = await engine.complete([
          { role: 'user', content: 'Reply with exactly the word: ok' },
        ]);
        setStatus(`done:${text.trim().slice(0, 60)}`);
      } catch (error) {
        setStatus(
          `error:${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    })();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-text">wllama probe</h1>
      <p data-testid="wllama-progress" className="text-sm text-muted">
        {pct}%
      </p>
      <p
        data-testid="wllama-probe"
        className="mt-2 whitespace-pre-wrap font-mono text-sm text-text"
      >
        {status}
      </p>
    </div>
  );
}
