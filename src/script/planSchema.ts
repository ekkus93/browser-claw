/**
 * Script Runtime v0.1 — the structured Plan DSL schema + validator (Part C1).
 *
 * A plan is a validated, declarative list of known operations (fs/web/memory/
 * tool). It does NOT execute arbitrary code. Validation fails closed: an unknown
 * op, a duplicate/forward step reference, an unsafe path/URL, or limits exceeded
 * all reject the whole plan before anything runs.
 */

import { isValidWorkspacePath } from '../workspace/path.ts';
import { classifyFetchUrl } from '../net/urlSafety.ts';

export const PLAN_TYPE = 'browserclaw_plan';
export const PLAN_VERSION = 1;

/** Maximum steps in a single plan (C1). */
export const MAX_PLAN_STEPS = 50;
/** Per-op output ceilings the validator enforces (C1 / §3.4). */
export const MAX_WEB_RESULTS = 25;
export const MAX_PAGE_CHARS = 200_000;
export const MAX_WEB_PAGES = 10;

/** Operations the v0.1 plan runtime knows (spec §3.3). */
export const KNOWN_OPS = [
  'fs.readText',
  'fs.readTextRange',
  'fs.readLines',
  'fs.writeText',
  'fs.updateText',
  'fs.appendText',
  'fs.delete',
  'fs.move',
  'fs.copy',
  'fs.list',
  'fs.search',
  'fs.grep',
  'web.search',
  'web.readPage',
  'web.readPages',
  'memory.create',
  'memory.search',
  'tool.call',
] as const;

export type PlanOp = (typeof KNOWN_OPS)[number];

export interface PlanStep {
  id: string;
  op: PlanOp;
  [field: string]: unknown;
}

export interface BrowserClawPlan {
  type: typeof PLAN_TYPE;
  version: number;
  title: string;
  reason: string;
  steps: PlanStep[];
}

export type PlanValidation =
  | { ok: true; plan: BrowserClawPlan }
  | { ok: false; errors: string[] };

const KNOWN_OP_SET = new Set<string>(KNOWN_OPS);

/** Literal path fields that must be safe workspace paths, per op. */
const PATH_FIELDS = ['path', 'from', 'to'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The leading step id of an input reference like `read0.markdown` or `s.results[0].url`. */
function refStepId(ref: string): string {
  return ref.split(/[.[]/)[0] ?? '';
}

/**
 * Validate an untrusted value as a {@link BrowserClawPlan}. Returns the typed
 * plan when valid, or the full list of reasons it was rejected.
 */
export function validatePlan(input: unknown): PlanValidation {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['plan is not an object'] };

  if (input.type !== PLAN_TYPE) errors.push(`type must be "${PLAN_TYPE}"`);
  if (input.version !== PLAN_VERSION) {
    errors.push(`version must be ${PLAN_VERSION}`);
  }
  if (typeof input.title !== 'string' || input.title.length === 0) {
    errors.push('title is required');
  }
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    errors.push('reason is required');
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push('steps must be a non-empty array');
    return { ok: false, errors };
  }
  if (input.steps.length > MAX_PLAN_STEPS) {
    errors.push(`too many steps (${input.steps.length} > ${MAX_PLAN_STEPS})`);
  }

  const seenIds = new Set<string>();
  input.steps.forEach((rawStep, index) => {
    const where = `step ${index}`;
    if (!isObject(rawStep)) {
      errors.push(`${where} is not an object`);
      return;
    }
    const id = rawStep.id;
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`${where} is missing an id`);
    } else if (seenIds.has(id)) {
      errors.push(`duplicate step id "${id}"`);
    }
    const op = rawStep.op;
    if (typeof op !== 'string' || !KNOWN_OP_SET.has(op)) {
      errors.push(`${where} has an unknown op "${String(op)}"`);
    }

    // Literal path fields must be safe workspace paths.
    for (const field of PATH_FIELDS) {
      const value = rawStep[field];
      if (typeof value === 'string' && !isValidWorkspacePath(value)) {
        errors.push(`${where} field "${field}" is not a safe workspace path`);
      }
    }
    // A literal url (when not taken from a prior step) must pass URL safety.
    if (typeof rawStep.url === 'string' && !classifyFetchUrl(rawStep.url).ok) {
      errors.push(`${where} field "url" is not an allowed URL`);
    }

    // Input references (`*From`) must point at an EARLIER step.
    for (const [key, value] of Object.entries(rawStep)) {
      if (!key.endsWith('From') || typeof value !== 'string') continue;
      const target = refStepId(value);
      if (!seenIds.has(target)) {
        errors.push(
          `${where} field "${key}" references unknown or later step "${target}"`,
        );
      }
    }

    // Output-size ceilings.
    if (
      typeof rawStep.maxResults === 'number' &&
      rawStep.maxResults > MAX_WEB_RESULTS
    ) {
      errors.push(`${where} maxResults exceeds ${MAX_WEB_RESULTS}`);
    }
    if (
      typeof rawStep.maxChars === 'number' &&
      rawStep.maxChars > MAX_PAGE_CHARS
    ) {
      errors.push(`${where} maxChars exceeds ${MAX_PAGE_CHARS}`);
    }
    if (
      typeof rawStep.maxPages === 'number' &&
      rawStep.maxPages > MAX_WEB_PAGES
    ) {
      errors.push(`${where} maxPages exceeds ${MAX_WEB_PAGES}`);
    }

    if (typeof id === 'string') seenIds.add(id);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan: input as unknown as BrowserClawPlan };
}

/** The distinct capabilities a plan requires (for the approval card / scope). */
export function planCapabilities(plan: BrowserClawPlan): string[] {
  const caps = new Set<string>();
  for (const step of plan.steps) {
    if (step.op.startsWith('fs.')) {
      const write = /writeText|updateText|appendText|delete|move|copy/.test(
        step.op,
      );
      caps.add(write ? 'workspace.write' : 'workspace.read');
    } else if (step.op === 'web.search') caps.add('web.search');
    else if (step.op.startsWith('web.read')) caps.add('web.readPage');
    else if (step.op === 'memory.create') caps.add('memory.write');
    else if (step.op === 'memory.search') caps.add('memory.read');
    else if (step.op === 'tool.call') caps.add('skill.tool');
  }
  return [...caps].sort();
}
