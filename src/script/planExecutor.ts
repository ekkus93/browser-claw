/**
 * Plan DSL executor (Part C3). Runs a validated plan's steps sequentially,
 * resolving `*From` input references against earlier step outputs, bounding the
 * output size and the number of reads/writes, stopping on the first failure, and
 * honoring a timeout + cancellation. It never executes arbitrary code — only the
 * known ops in {@link executePlanOp}.
 */

import { executePlanOp, type PlanOpContext } from './planOps.ts';
import { validatePlan, type BrowserClawPlan } from './planSchema.ts';

export interface PlanLimits {
  maxOutputBytes: number;
  maxFileReads: number;
  maxFileWrites: number;
  maxWebReads: number;
  timeoutMs: number;
}

export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  maxOutputBytes: 1_000_000,
  maxFileReads: 200,
  maxFileWrites: 50,
  maxWebReads: 20,
  timeoutMs: 30_000,
};

export type PlanErrorKind =
  | 'validation_error'
  | 'step_failed'
  | 'output_limit_exceeded'
  | 'limit_exceeded'
  | 'timeout'
  | 'cancelled';

export interface PlanStepResult {
  id: string;
  op: string;
  ok: boolean;
  error?: string;
}

export interface PlanRunResult {
  ok: boolean;
  outputs: Record<string, unknown>;
  steps: PlanStepResult[];
  error?: string;
  errorKind?: PlanErrorKind;
}

export interface PlanRunOptions {
  limits?: Partial<PlanLimits>;
  signal?: AbortSignal;
  now?: () => number;
}

const READ_OPS = new Set([
  'fs.readText',
  'fs.readTextRange',
  'fs.readLines',
  'fs.list',
  'fs.search',
  'fs.grep',
  'memory.search',
]);
const WRITE_OPS = new Set([
  'fs.writeText',
  'fs.updateText',
  'fs.appendText',
  'fs.delete',
  'fs.move',
  'fs.copy',
  'memory.create',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Resolve a reference like `read0.markdown` or `s.results[0].url` against outputs. */
function resolveRef(outputs: Record<string, unknown>, ref: string): unknown {
  const tokens = ref.split(/[.[\]]/).filter((t) => t.length > 0);
  let current: unknown = outputs;
  for (const token of tokens) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/** Build a step's concrete args: literal fields + resolved `*From` references. */
function resolveStepArgs(
  step: Record<string, unknown>,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (key === 'id' || key === 'op') continue;
    if (key.endsWith('From') && typeof value === 'string') {
      args[key.slice(0, -'From'.length)] = resolveRef(outputs, value);
    } else {
      args[key] = value;
    }
  }
  return args;
}

function byteLength(value: unknown): number {
  if (typeof value === 'string') return new TextEncoder().encode(value).length;
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  } catch {
    return 0;
  }
}

/** Run a validated plan. Returns a structured result; never throws for a step error. */
export async function executePlan(
  ctx: PlanOpContext,
  plan: BrowserClawPlan | unknown,
  options: PlanRunOptions = {},
): Promise<PlanRunResult> {
  const limits = { ...DEFAULT_PLAN_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const outputs: Record<string, unknown> = {};
  const steps: PlanStepResult[] = [];

  const validation = validatePlan(plan);
  if (!validation.ok) {
    return {
      ok: false,
      outputs,
      steps,
      error: validation.errors.join('; '),
      errorKind: 'validation_error',
    };
  }

  const deadline = now() + limits.timeoutMs;
  let totalOutputBytes = 0;
  let fileReads = 0;
  let fileWrites = 0;
  let webReads = 0;

  for (const step of validation.plan.steps) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        outputs,
        steps,
        error: 'cancelled',
        errorKind: 'cancelled',
      };
    }
    if (now() > deadline) {
      return {
        ok: false,
        outputs,
        steps,
        error: 'plan timed out',
        errorKind: 'timeout',
      };
    }
    // Pre-flight per-category limits.
    if (READ_OPS.has(step.op)) fileReads += 1;
    if (WRITE_OPS.has(step.op)) fileWrites += 1;
    if (step.op.startsWith('web.')) webReads += 1;
    if (
      fileReads > limits.maxFileReads ||
      fileWrites > limits.maxFileWrites ||
      webReads > limits.maxWebReads
    ) {
      return {
        ok: false,
        outputs,
        steps,
        error: 'plan exceeded an operation limit',
        errorKind: 'limit_exceeded',
      };
    }

    try {
      const args = resolveStepArgs(step, outputs);
      const result = await executePlanOp(ctx, step.op, args);
      totalOutputBytes += byteLength(result);
      if (totalOutputBytes > limits.maxOutputBytes) {
        steps.push({
          id: step.id,
          op: step.op,
          ok: false,
          error: 'output too large',
        });
        return {
          ok: false,
          outputs,
          steps,
          error: 'plan output exceeded the size limit',
          errorKind: 'output_limit_exceeded',
        };
      }
      outputs[step.id] = result;
      steps.push({ id: step.id, op: step.op, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ id: step.id, op: step.op, ok: false, error: message });
      return {
        ok: false,
        outputs,
        steps,
        error: `step "${step.id}" failed: ${message}`,
        errorKind: 'step_failed',
      };
    }
  }

  return { ok: true, outputs, steps };
}
