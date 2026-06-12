import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotScheduler } from './snapshotScheduler.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SnapshotScheduler', () => {
  it('coalesces many schedules into a single debounced save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SnapshotScheduler(save, 500);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not save when nothing was scheduled', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SnapshotScheduler(save, 500);
    await scheduler.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('flush persists immediately and cancels the pending timer', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SnapshotScheduler(save, 500);

    scheduler.schedule();
    await scheduler.flush();
    expect(save).toHaveBeenCalledOnce();

    // The earlier timer must not fire a second save.
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
  });

  it('surfaces save failures and retries on the next flush', async () => {
    const onError = vi.fn();
    const save = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValue(undefined);
    const scheduler = new SnapshotScheduler(save, 500, onError);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(onError).toHaveBeenCalledOnce();

    // Still pending after the failure — a flush retries and succeeds.
    await scheduler.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
