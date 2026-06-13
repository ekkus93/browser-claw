/** Browser-local GGUF models available to download via wllama from Hugging Face. */
export interface CatalogModel {
  id: string;
  name: string;
  repo: string;
  file: string;
  sizeLabel: string;
  /**
   * Approximate on-disk size in bytes. Machine-readable counterpart of
   * `sizeLabel`, used for the storage-quota preflight before a download so we
   * never start a download that can't fit (TODO Phase 8.2).
   */
  sizeBytes: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'smollm2-135m',
    name: 'SmolLM2-135M Instruct (Q4_K_M)',
    repo: 'bartowski/SmolLM2-135M-Instruct-GGUF',
    file: 'SmolLM2-135M-Instruct-Q4_K_M.gguf',
    sizeLabel: '105 MB',
    sizeBytes: Math.round(105 * MB),
  },
  {
    id: 'smollm2-1.7b',
    name: 'SmolLM2-1.7B Instruct (Q4_K_M)',
    repo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF',
    file: 'smollm2-1.7b-instruct-q4_k_m.gguf',
    sizeLabel: '1.1 GB',
    sizeBytes: Math.round(1.1 * GB),
  },
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5-0.5B Instruct (Q4_K_M)',
    repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    sizeLabel: '0.5 GB',
    sizeBytes: Math.round(0.5 * GB),
  },
];
