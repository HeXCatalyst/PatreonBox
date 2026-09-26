import { describe, expect, it, vi } from 'vitest';
import { createCommentBackfillQueue, runPostSyncTasks } from './syncTasks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('post sync with background comments', () => {
  it('finishes posts, starts downloads and runs another sync while comments remain pending', async () => {
    const comments = deferred<number>();
    const started = deferred<void>();
    const fetch = vi.fn().mockImplementationOnce(() => {
      started.resolve();
      return comments.promise;
    }).mockResolvedValue(2);
    const start = vi.fn();
    const finish = vi.fn();
    const queue = createCommentBackfillQueue({ fetch, start, finish });
    const firstIds = vi.fn().mockResolvedValue(['101']);
    const secondIds = vi.fn().mockResolvedValue(['202']);
    const scrape = vi.fn().mockResolvedValue(1);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn().mockResolvedValue(undefined);
    const onBackfillError = vi.fn();
    let firstJob!: Promise<unknown>;
    let secondJob!: Promise<unknown>;

    await runPostSyncTasks({ scrape, refresh, download, onBackfillError,
      backfill: async () => { firstJob = queue.enqueue(firstIds); await firstJob; },
    });
    await started.promise;
    await runPostSyncTasks({ scrape, refresh, onBackfillError,
      backfill: async () => { secondJob = queue.enqueue(secondIds); await secondJob; },
    });

    expect(scrape).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(secondIds).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();

    comments.resolve(3);
    await Promise.all([firstJob, secondJob]);
    expect(fetch.mock.calls).toEqual([[['101']], [['202']]]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(onBackfillError).not.toHaveBeenCalled();
  });

  it('reports a background error without failing completed posts or downloads', async () => {
    const comments = deferred<void>();
    const reported = deferred<unknown>();
    const download = vi.fn().mockResolvedValue(undefined);
    await runPostSyncTasks({
      scrape: async () => 1, refresh: async () => {},
      backfill: () => comments.promise,
      onBackfillError: error => reported.resolve(error), download,
    });
    const error = new Error('comment fetch failed');
    comments.reject(error);
    expect(await reported.promise).toBe(error);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('does not launch follow-up jobs when post scraping fails', async () => {
    const error = new Error('post fetch failed');
    const refresh = vi.fn();
    const backfill = vi.fn();
    const download = vi.fn();
    await expect(runPostSyncTasks({
      scrape: async () => { throw error; }, refresh, backfill, download,
      onBackfillError: vi.fn(),
    })).rejects.toBe(error);
    expect(refresh).not.toHaveBeenCalled();
    expect(backfill).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});

describe('comment backfill queue', () => {
  it('releases progress and continues queued work after a fetch failure', async () => {
    const error = new Error('fetch failed');
    const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(4);
    const start = vi.fn();
    const finish = vi.fn();
    const queue = createCommentBackfillQueue({ fetch, start, finish });
    const failed = queue.enqueue(async () => ['101']);
    const next = queue.enqueue(async () => ['202']);
    await expect(failed).rejects.toBe(error);
    await expect(next).resolves.toEqual({ posts: 1, saved: 4 });
    expect(start).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
  });

  it('handles failed lookups and empty jobs without leaving progress stuck', async () => {
    const error = new Error('database lookup failed');
    const fetch = vi.fn().mockResolvedValue(1);
    const start = vi.fn();
    const finish = vi.fn();
    const queue = createCommentBackfillQueue({ fetch, start, finish });
    const failed = queue.enqueue(async () => { throw error; });
    const empty = queue.enqueue(async () => []);
    const next = queue.enqueue(async () => ['303']);
    await expect(failed).rejects.toBe(error);
    await expect(empty).resolves.toEqual({ posts: 0, saved: 0 });
    await expect(next).resolves.toEqual({ posts: 1, saved: 1 });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(['303']);
    expect(start).toHaveBeenCalledExactlyOnceWith(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
