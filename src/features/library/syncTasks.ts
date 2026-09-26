interface CommentBackfillDependencies {
  fetch: (postIds: string[]) => Promise<number>;
  start: (total: number) => void;
  finish: () => void;
}

/** One owner for the bulk scraper and its progress banner. Look up missing
 * posts when a job starts, after the preceding job has updated the cache. */
export function createCommentBackfillQueue(deps: CommentBackfillDependencies) {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue(loadIds: () => Promise<string[]>) {
      const result = tail.then(async () => {
        const ids = await loadIds();
        if (ids.length === 0) return { posts: 0, saved: 0 };
        deps.start(ids.length);
        try {
          return { posts: ids.length, saved: await deps.fetch(ids) };
        } finally {
          deps.finish();
        }
      });
      // A rejected job still releases the queue; callers retain its error.
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

interface PostSyncTasks {
  scrape: () => Promise<unknown>;
  refresh: () => Promise<void>;
  backfill: () => Promise<void>;
  onBackfillError: (error: unknown) => void;
  download?: () => Promise<void>;
}

/** Completion here releases the post-sync controls. Comments have their own
 * queue and progress, and must never extend the lifetime of a post sync. */
export async function runPostSyncTasks(tasks: PostSyncTasks): Promise<void> {
  await tasks.scrape();
  await tasks.refresh();
  void Promise.resolve().then(tasks.backfill).catch(tasks.onBackfillError);
  await tasks.download?.();
}
