import { hfDownloadUrl, type HfReference } from './hfReference.ts';

/**
 * Best-effort discovery of a Hugging Face model's size and license (TODO 8.3).
 * Both lookups are independent and tolerant of failure — a blocked CORS
 * request, a 404, or a network error simply leaves that field undiscovered. If
 * neither can be found the caller is told so it can warn the user rather than
 * silently showing nothing.
 */

export interface HfModelMetadata {
  /** Exact file size in bytes (from the download's Content-Length). */
  sizeBytes?: number;
  /** License id from the model card, if published. */
  license?: string;
}

export type HfMetadataResult =
  | { ok: true; metadata: HfModelMetadata }
  | { ok: false; reason: string };

export async function fetchHfModelMetadata(
  reference: HfReference,
  fetchImpl: typeof fetch = fetch,
): Promise<HfMetadataResult> {
  const metadata: HfModelMetadata = {};

  // Size: a HEAD on the download exposes Content-Length (a CORS-safelisted
  // response header), so we learn the size without downloading the model.
  try {
    const head = await fetchImpl(hfDownloadUrl(reference), { method: 'HEAD' });
    if (head.ok) {
      const length = Number(head.headers.get('content-length'));
      if (Number.isFinite(length) && length > 0) metadata.sizeBytes = length;
    }
  } catch {
    /* best-effort: leave sizeBytes undiscovered */
  }

  // License: the model card metadata from the public models API.
  try {
    const res = await fetchImpl(
      `https://huggingface.co/api/models/${reference.repo}`,
    );
    if (res.ok) {
      const json = (await res.json()) as {
        license?: unknown;
        cardData?: { license?: unknown };
      };
      const license = json.cardData?.license ?? json.license;
      if (typeof license === 'string' && license.length > 0) {
        metadata.license = license;
      }
    }
  } catch {
    /* best-effort: leave license undiscovered */
  }

  if (metadata.sizeBytes === undefined && metadata.license === undefined) {
    return {
      ok: false,
      reason: 'Could not fetch model metadata from Hugging Face.',
    };
  }
  return { ok: true, metadata };
}
