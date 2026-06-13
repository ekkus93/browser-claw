import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import {
  modelDownloadUpdated,
  modelDownloadRemoved,
  activeModelSet,
} from '../store/slices/modelsSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { AuditRiskLevel, AuditStatus } from '../db/types.ts';
import type { CatalogModel } from './catalog.ts';
import type { WllamaEngine } from './engine.ts';
import {
  estimateStorage,
  type StorageUsage,
} from '../services/storageService.ts';

/**
 * Thrown by the download preflight when the model wouldn't fit in the remaining
 * storage quota. The app fails closed: we never start a multi-hundred-MB
 * download that can't complete (TODO Phase 8.2).
 */
export class InsufficientStorageError extends Error {
  constructor(model: CatalogModel) {
    super(
      `Not enough storage to download ${model.name} (${model.sizeLabel}). ` +
        'Free up space or clear unused model caches, then try again.',
    );
    this.name = 'InsufficientStorageError';
  }
}

/**
 * Drives the wllama engine and reflects download/load/delete progress into the
 * models slice (which the Models screen renders).
 *
 * Every model operation is a meaningful action, so each one appends a durable
 * audit event (source `model`) on success and failure. Only the model id/name
 * are recorded — never download URLs with credentials or model bytes. See
 * HARDENING_NOTES.md / TODO Phase 3.3 (model download/load/delete) and Phase 8.
 */
export function createModelManager(
  db: BrowserClawDB,
  dispatch: AppDispatch,
  engine: WllamaEngine,
  // Injectable so the quota preflight is unit-testable without a real browser;
  // defaults to the live navigator.storage estimate.
  estimate: () => Promise<StorageUsage> = estimateStorage,
) {
  function audit(
    type: string,
    summary: string,
    status: AuditStatus,
    risk: AuditRiskLevel,
    modelId: string,
  ): void {
    void recordAudit(db, dispatch, {
      type,
      summary,
      source: 'model',
      status,
      risk,
      modelId,
    });
  }

  return {
    async download(model: CatalogModel): Promise<void> {
      // Quota preflight: refuse a download that can't fit in the remaining
      // quota instead of starting it and surprising the user with a failure
      // partway through. A zero quota means the estimate is unavailable (e.g.
      // jsdom / privacy mode), so we can't assess it — proceed and let the real
      // download surface any error.
      const { usedBytes, quotaBytes } = await estimate();
      if (quotaBytes > 0 && usedBytes + model.sizeBytes > quotaBytes) {
        dispatch(
          modelDownloadUpdated({
            modelId: model.id,
            status: 'error',
            progress: 0,
          }),
        );
        audit(
          'model.download_blocked',
          `Blocked download of ${model.name}: not enough storage quota`,
          'failure',
          'low',
          model.id,
        );
        throw new InsufficientStorageError(model);
      }

      dispatch(
        modelDownloadUpdated({
          modelId: model.id,
          status: 'downloading',
          progress: 0,
        }),
      );
      try {
        await engine.download(model, (loaded, total) => {
          const progress =
            total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          dispatch(
            modelDownloadUpdated({
              modelId: model.id,
              status: 'downloading',
              progress,
            }),
          );
        });
        dispatch(
          modelDownloadUpdated({
            modelId: model.id,
            status: 'ready',
            progress: 100,
          }),
        );
        audit(
          'model.download_succeeded',
          `Downloaded local model ${model.name}`,
          'success',
          'info',
          model.id,
        );
      } catch (error) {
        dispatch(
          modelDownloadUpdated({
            modelId: model.id,
            status: 'error',
            progress: 0,
          }),
        );
        audit(
          'model.download_failed',
          `Download failed for local model ${model.name}`,
          'failure',
          'low',
          model.id,
        );
        throw error;
      }
    },

    async load(model: CatalogModel): Promise<void> {
      try {
        await engine.load(model);
      } catch (error) {
        audit(
          'model.load_failed',
          `Load failed for local model ${model.name}`,
          'failure',
          'low',
          model.id,
        );
        throw error;
      }
      dispatch(activeModelSet({ id: model.id, label: model.name }));
      audit(
        'model.loaded',
        `Loaded local model ${model.name}`,
        'success',
        'info',
        model.id,
      );
    },

    async remove(model: CatalogModel): Promise<void> {
      try {
        await engine.deleteCache(model.id);
      } catch (error) {
        audit(
          'model.delete_failed',
          `Delete failed for local model ${model.name}`,
          'failure',
          'low',
          model.id,
        );
        throw error;
      }
      dispatch(modelDownloadRemoved(model.id));
      audit(
        'model.deleted',
        `Deleted local model ${model.name}`,
        'success',
        'low',
        model.id,
      );
    },
  };
}

export type ModelManager = ReturnType<typeof createModelManager>;
