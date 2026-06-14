/**
 * Validation for a user-provided Hugging Face GGUF reference (repo + file) and
 * the single place the model download URL is built. The app never proxies model
 * bytes through its own server — downloads go straight to huggingface.co — so
 * keeping the URL construction here makes that guarantee testable (TODO 8.3).
 */

export interface HfReference {
  /** A Hugging Face repo id, e.g. `owner/name`. */
  repo: string;
  /** A `.gguf` file path within the repo. */
  file: string;
}

export type HfReferenceResult =
  | { ok: true; reference: HfReference }
  | { ok: false; reason: string };

// One repo/path segment: letters, digits, and `._-`. No spaces, slashes,
// schemes, or `..` — those are rejected so a reference can't become a URL or
// escape the repo.
const SEGMENT = /^[A-Za-z0-9._-]+$/;

function looksLikeUrl(value: string): boolean {
  return /:/.test(value) || value.includes('\\') || value.includes('//');
}

/**
 * Validate a Hugging Face GGUF reference. Accepts only a bare repo id
 * (`owner/name`) and a `.gguf` file path within the repo — never a full URL,
 * an absolute path, or a path-traversal — so the resulting download always
 * targets the intended file on huggingface.co.
 */
export function validateHfReference(
  repoInput: string,
  fileInput: string,
): HfReferenceResult {
  const repo = repoInput.trim();
  const file = fileInput.trim();

  if (!repo) {
    return { ok: false, reason: 'Enter a Hugging Face repo (owner/name).' };
  }
  if (looksLikeUrl(repo)) {
    return { ok: false, reason: 'Use the repo id "owner/name", not a URL.' };
  }
  const repoSegments = repo.split('/');
  if (
    repoSegments.length !== 2 ||
    !repoSegments.every((s) => SEGMENT.test(s))
  ) {
    return { ok: false, reason: 'Repo must look like "owner/name".' };
  }

  if (!file) {
    return { ok: false, reason: 'Enter the GGUF file name.' };
  }
  if (!file.toLowerCase().endsWith('.gguf')) {
    return { ok: false, reason: 'File must be a .gguf model.' };
  }
  if (looksLikeUrl(file) || file.startsWith('/') || file.includes('..')) {
    return {
      ok: false,
      reason:
        'File must be a path within the repo (no URL, absolute, or "..").',
    };
  }
  if (!file.split('/').every((s) => SEGMENT.test(s))) {
    return { ok: false, reason: 'File path has invalid characters.' };
  }

  return { ok: true, reference: { repo, file } };
}

/**
 * The canonical Hugging Face download URL for a reference. Always
 * `https://huggingface.co/...` — model bytes are fetched directly from HF and
 * never proxied through the app server.
 */
export function hfDownloadUrl(reference: HfReference): string {
  return `https://huggingface.co/${reference.repo}/resolve/main/${reference.file}`;
}
