import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db.ts';
import {
  createDexieModelBlobStore,
  getOrFetchModelBlob,
} from '../wllama/modelCache.ts';
import { MODEL_CATALOG } from '../wllama/catalog.ts';

/**
 * Verification surface for the IndexedDB model-blob cache (the no-OPFS fallback
 * for browser-local models). Downloads a small GGUF through the cache, then on
 * a reload serves it from IndexedDB without re-downloading. Independent of
 * wllama/OPFS, so it's deterministic in every browser. Extended suite only.
 */
export default function ModelCacheProbe() {
  const [status, setStatus] = useState('idle');
  const [pct, setPct] = useState(0);
  // StrictMode invokes effects twice in dev; run the probe only once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const model = MODEL_CATALOG.find((m) => m.id === 'smollm2-135m');
        if (!model) {
          setStatus('no-model');
          return;
        }
        const store = createDexieModelBlobStore(db);
        setStatus('fetching');
        const blob = await getOrFetchModelBlob(store, model, {
          onProgress: (loaded, total) => {
            if (total > 0) setPct(Math.round((loaded / total) * 100));
          },
        });
        const count = await db.model_blobs.count();
        setStatus(`done:size=${blob.size};count=${count}`);
      } catch (error) {
        setStatus(
          `error:${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    })();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-text">model cache probe</h1>
      <p data-testid="cache-progress" className="text-sm text-muted">
        {pct}%
      </p>
      <p
        data-testid="cache-probe"
        className="mt-2 whitespace-pre-wrap font-mono text-sm text-text"
      >
        {status}
      </p>
    </div>
  );
}
