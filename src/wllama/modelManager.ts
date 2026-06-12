import type { AppDispatch } from '../store/store.ts';
import {
  modelDownloadUpdated,
  modelDownloadRemoved,
  activeModelSet,
} from '../store/slices/modelsSlice.ts';
import type { CatalogModel } from './catalog.ts';
import type { WllamaEngine } from './engine.ts';

/**
 * Drives the wllama engine and reflects download/load/delete progress into the
 * models slice (which the Models screen renders).
 */
export function createModelManager(
  dispatch: AppDispatch,
  engine: WllamaEngine,
) {
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
      } catch (error) {
        dispatch(
          modelDownloadUpdated({
            modelId: model.id,
            status: 'error',
            progress: 0,
          }),
        );
        throw error;
      }
    },

    async load(model: CatalogModel): Promise<void> {
      await engine.load(model);
      dispatch(activeModelSet({ id: model.id, label: model.name }));
    },

    async remove(model: CatalogModel): Promise<void> {
      await engine.deleteCache(model.id);
      dispatch(modelDownloadRemoved(model.id));
    },
  };
}

export type ModelManager = ReturnType<typeof createModelManager>;
