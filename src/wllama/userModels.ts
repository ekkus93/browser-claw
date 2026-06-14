import type { BrowserClawDB } from '../db/db.ts';
import type { ModelCatalogRow } from '../db/types.ts';
import type { CatalogModel } from './catalog.ts';
import { validateHfReference } from './hfReference.ts';

/**
 * User-added Hugging Face models, persisted in the `model_catalog` table and
 * surfaced in the Browser-Local Models table alongside the built-in catalog.
 * They flow through the same download/load/delete path as built-ins (TODO 8.3).
 */

const USER_MODEL_PROVIDER = 'wllama';
/** User-model ids are namespaced so the UI can tell them from built-ins. */
const USER_MODEL_PREFIX = 'hf:';

export function isUserModelId(id: string): boolean {
  return id.startsWith(USER_MODEL_PREFIX);
}

function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return 'Unknown size';
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? `${gb.toFixed(1)} GB`
    : `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Map a persisted catalog row to the CatalogModel shape the table/engine use. */
export function toCatalogModel(row: ModelCatalogRow): CatalogModel {
  return {
    id: row.id,
    name: row.label,
    repo: row.repo ?? '',
    file: row.file ?? '',
    sizeLabel: formatSize(row.sizeBytes),
    // Unknown until metadata is fetched; 0 makes the quota preflight skip.
    sizeBytes: row.sizeBytes ?? 0,
  };
}

export async function listUserModels(
  db: BrowserClawDB,
): Promise<CatalogModel[]> {
  const rows = await db.model_catalog
    .where('provider')
    .equals(USER_MODEL_PROVIDER)
    .toArray();
  return rows.map(toCatalogModel);
}

export type AddUserModelResult =
  | { ok: true; model: CatalogModel }
  | { ok: false; reason: string };

/**
 * Validate and persist a user-provided HF model reference. Returns the rejection
 * reason on an invalid reference so the form can show it; never persists an
 * invalid reference.
 */
export async function addUserModel(
  db: BrowserClawDB,
  repoInput: string,
  fileInput: string,
): Promise<AddUserModelResult> {
  const validation = validateHfReference(repoInput, fileInput);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const { repo, file } = validation.reference;
  const row: ModelCatalogRow = {
    id: `${USER_MODEL_PREFIX}${repo}/${file}`,
    provider: USER_MODEL_PROVIDER,
    label: `${repo} · ${file}`,
    repo,
    file,
  };
  await db.model_catalog.put(row);
  return { ok: true, model: toCatalogModel(row) };
}

export async function removeUserModel(
  db: BrowserClawDB,
  id: string,
): Promise<void> {
  await db.model_catalog.delete(id);
}
