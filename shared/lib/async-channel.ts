interface Waiter<T> {
  resolve: (result: IteratorResult<T>) => void;
}

export class AsyncChannel<T> {
  #queue: T[] = [];
  #waiters: Waiter<T>[] = [];
  #closed = false;

  get isClosed(): boolean {
    return this.#closed;
  }

  push(value: T): void {
    if (this.#closed) return;
    if (this.#waiters.length > 0) {
      this.#waiters.shift()!.resolve({ value, done: false });
    } else {
      this.#queue.push(value);
    }
  }

  close(): void {
    this.#closed = true;
    for (const w of this.#waiters) w.resolve({ value: undefined as unknown as T, done: true });
    this.#waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.#queue.length > 0) {
          return Promise.resolve({ value: this.#queue.shift()!, done: false });
        }
        if (this.#closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((resolve) => this.#waiters.push({ resolve }));
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      },
    };
  }
}
