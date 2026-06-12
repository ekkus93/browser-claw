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

export type AuditRiskLevel = 'info' | 'low' | 'medium' | 'high';

export interface AuditEventRow {
  id: string;
  type: string;
  summary: string;
  risk: AuditRiskLevel;
  at: number;
  details?: unknown;
}

export interface RuntimeSnapshotRow {
  id: string;
  createdAt: number;
  snapshot: unknown;
}

export interface ModelCatalogRow {
  id: string;
  provider: string;
  label: string;
  repo?: string;
  file?: string;
  sizeBytes?: number;
}

export interface ModelCacheIndexRow {
  id: string;
  modelId: string;
  bytes: number;
  cachedAt: number;
}

export interface BackupHistoryRow {
  id: string;
  createdAt: number;
  sizeBytes: number;
  manifestVersion: string;
}
