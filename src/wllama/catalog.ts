/** Browser-local GGUF models available to download via wllama from Hugging Face. */
export interface CatalogModel {
  id: string;
  name: string;
  repo: string;
  file: string;
  sizeLabel: string;
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'smollm2-1.7b',
    name: 'SmolLM2-1.7B Instruct (Q4_K_M)',
    repo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF',
    file: 'smollm2-1.7b-instruct-q4_k_m.gguf',
    sizeLabel: '1.1 GB',
  },
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5-0.5B Instruct (Q4_K_M)',
    repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    sizeLabel: '0.5 GB',
  },
];
