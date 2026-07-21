/**
 * Kolejka z ograniczoną współbieżnością (upload galerii: max 3).
 */

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, n));
  const results = new Array<R>(n);
  let next = 0;

  const run = async () => {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      results[i] = await worker(items[i]!, i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

type QueueWaiter<T> = {
  resolve: (v: T | null) => void;
};

/** Prosta async-kolejka: producent push, konsumenci take (null = koniec). */
export function createAsyncQueue<T>() {
  const items: T[] = [];
  const waiters: QueueWaiter<T>[] = [];
  let closed = false;

  return {
    push(item: T) {
      const w = waiters.shift();
      if (w) w.resolve(item);
      else items.push(item);
    },
    close() {
      closed = true;
      while (waiters.length) waiters.shift()!.resolve(null);
    },
    take(): Promise<T | null> {
      if (items.length) return Promise.resolve(items.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise<T | null>((resolve) => {
        waiters.push({ resolve });
      });
    },
  };
}

/**
 * Pipeline: przygotuj sekwencyjnie (1), wysyłaj z limitem współbieżności.
 * Kolejne zdjęcie kompresuje się podczas uploadu poprzednich.
 */
export async function prepareThenUploadPool<TFile, TPrepared>(
  files: readonly TFile[],
  opts: {
    uploadConcurrency: number;
    prepare: (file: TFile, index: number) => Promise<TPrepared>;
    upload: (prepared: TPrepared, index: number) => Promise<void>;
  },
): Promise<void> {
  if (files.length === 0) return;

  const queue = createAsyncQueue<{ index: number; prepared: TPrepared }>();
  const uploadConc = Math.max(1, Math.min(opts.uploadConcurrency, files.length));

  const producer = (async () => {
    for (let i = 0; i < files.length; i++) {
      const prepared = await opts.prepare(files[i]!, i);
      queue.push({ index: i, prepared });
    }
    queue.close();
  })();

  const consumers = Array.from({ length: uploadConc }, async () => {
    for (;;) {
      const job = await queue.take();
      if (!job) return;
      await opts.upload(job.prepared, job.index);
    }
  });

  await Promise.all([producer, ...consumers]);
}
