export interface MutationQueue {
    enqueue<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * 串行写队列：确保所有并发写入与后续 refresh 按发起顺序依次执行，
 * 前一次任务失败不会阻塞后续任务。
 */
export function createMutationQueue(): MutationQueue {
    let tail: Promise<unknown> = Promise.resolve();
    return {
        enqueue<T>(task: () => Promise<T>): Promise<T> {
            const next = tail.then(task, task);
            tail = next.catch(() => {});
            return next;
        },
    };
}

export interface LatestTracker {
    next(): number;
    isLatest(seq: number): boolean;
}

/** 单调版本号追踪器：防止后返回的过期异步查询覆盖最新状态。 */
export function createLatestTracker(): LatestTracker {
    let current = 0;
    return {
        next() {
            current += 1;
            return current;
        },
        isLatest(seq: number) {
            return seq === current;
        },
    };
}
