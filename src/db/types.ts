/**
 * Row types for the durable Dexie/IndexedDB stores. These are the persisted
 * shapes — distinct from transient Redux state and from runtime types.
 *
 * Security: `encrypted_secrets` stores CIPHERTEXT ONLY. No table here holds
 * decrypted secret material; that lives solely in the in-memory SecretVault.
 */

export interface AppSettingRow {
  key: string;
  value: unknown;
}

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'openai_compatible'
  | 'ollama'
  | 'llama_server'
  | 'wllama';

export interface ProviderProfileRow {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  model?: string;
  apiKeyMode: 'none' | 'session' | 'encrypted';
  /** References an encrypted_secrets row — never an inline key. */
  encryptedSecretId?: string;
}

export interface EncryptedSecretRow {
  id: string;
  label: string;
  storageMode: 'session' | 'encrypted';
  /** AES-GCM ciphertext, base64. Never plaintext. */
  ciphertext: string;
  /** Base64 IV/nonce. */
  iv: string;
}

export interface ConversationRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageRow {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

export interface MemoryRow {
  id: string;
  title: string;
  text: string;
  tags: string[];
  source: string;
  createdBy: string;
  createdAt: number;
  lastUsedAt?: number;
  pinned: boolean;
  sensitivity: 'normal' | 'sensitive';
  /** True for memories seeded as demo data (only in demo mode). */
  demo?: boolean;
  /** Provenance: the conversation/skill a runtime-written memory came from. */
  conversationId?: string;
  skillId?: string;
}

export interface TodoRow {
  id: string;
  title: string;
  status: 'open' | 'done' | 'cancelled';
  createdAt: number;
}

export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  definition: unknown;
}

export interface ScheduleRow {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  nextRunAt?: number;
}

export type SkillSource = 'bundled' | 'clawskill' | 'skill_md';

export interface SkillRow {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  installedAt: number;
}

export interface SkillFileRow {
  skillId: string;
  path: string;
  content: string;
}

export interface SkillStateRow {
  skillId: string;
  key: string;
  value: unknown;
}

export type AuditRiskLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AuditStatus =
  | 'success'
  | 'failure'
  | 'pending'
  | 'rejected'
  | 'cancelled';

export type AuditSource =
  | 'user'
  | 'runtime'
  | 'provider'
  | 'storage'
  | 'skill'
  | 'backup'
  | 'model'
  | 'system';

/**
 * Durable audit event. `at` (epoch ms) is canonical for ordering/range queries;
 * `timestamp` is an optional derived ISO string for export readability.
 * Correlation ids are optional. Decrypted secrets must never appear here — the
 * audit service redacts `details` before writing.
 */
export interface AuditEventRow {
  id: string;
  type: string;
  summary: string;
  risk: AuditRiskLevel;
  source: AuditSource;
  status: AuditStatus;
  at: number;
  timestamp?: string;
  conversationId?: string;
  providerId?: string;
  skillId?: string;
  toolName?: string;
  modelId?: string;
  effectId?: string;
  runId?: string;
  details?: unknown;
  /** Marks events seeded for demo/dev so they can be told apart from real ones. */
  demo?: boolean;
}

export interface RuntimeSnapshotRow {
  id: string;
  createdAt: number;
  /**
   * Snapshot schema version (see SNAPSHOT_SCHEMA_VERSION). A persisted snapshot
   * whose version does not match the running build is discarded on load rather
   * than restored — restoring across an incompatible shape would silently
   * corrupt runtime state. Optional so pre-versioning rows read back as
   * `undefined` and are treated as incompatible.
   */
  version?: number;
  snapshot: unknown;
}

export interface ModelCatalogRow {
  id: string;
  provider: string;
  label: string;
  repo?: string;
  file?: string;
  sizeBytes?: number;
  /** SPDX-ish license id discovered from Hugging Face metadata, if available. */
  license?: string;
}

export interface ModelCacheIndexRow {
  id: string;
  modelId: string;
  bytes: number;
  cachedAt: number;
}

/** Cached GGUF model bytes (added in schema v2) for browsers without OPFS. */
export interface ModelBlobRow {
  modelId: string;
  blob: Blob;
  cachedAt: number;
}

export interface BackupHistoryRow {
  id: string;
  createdAt: number;
  sizeBytes: number;
  manifestVersion: string;
}
