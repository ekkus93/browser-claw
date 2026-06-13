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
