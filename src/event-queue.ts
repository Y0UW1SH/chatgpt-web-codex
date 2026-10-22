export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private readonly maxBuffered = 10_000) {}

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    if (this.buffered.length >= this.maxBuffered) throw new Error("Adapter event backlog exceeded");
    this.buffered.push(value);
  }

  close(finalValue?: T): void {
    if (this.closed) return;
    // Reserve one terminal value even after normal backlog capacity is exhausted.
    // Otherwise a producer cannot report why it stopped to the consumer.
    if (arguments.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) waiter({ value: finalValue as T, done: false });
      else this.buffered.push(finalValue as T);
    }
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!({ value: undefined, done: true });
  }

  async collect(): Promise<T[]> {
    const values: T[] = [];
    for await (const value of this) values.push(value);
    return values;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.buffered.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise(resolve => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
