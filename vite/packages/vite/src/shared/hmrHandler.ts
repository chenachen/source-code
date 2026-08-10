import type { HotPayload } from '#types/hmrPayload'

/**
 * 把 HMR payload 处理器包装成严格串行队列。一次更新的 invalidate/回调可能同步触发下一次更新；若
 * 并行执行，两轮模块状态和 data/dispose 生命周期会交错。
 */
export function createHMRHandler(
  handler: (payload: HotPayload) => Promise<void>,
): (payload: HotPayload) => Promise<void> {
  const queue = new Queue()
  return (payload) => queue.enqueue(() => handler(payload))
}

/** 单消费者 Promise 队列：单项失败只拒绝自己的调用，不阻断后续 payload。 */
class Queue {
  /** 尚未启动的任务及各自 Promise 的完成通道。 */
  private queue: {
    /** 队首执行时才调用的异步任务。 */
    promise: () => Promise<void>
    /** 把任务成功传回对应 enqueue 调用。 */
    resolve: (value?: unknown) => void
    /** 把任务失败传回对应 enqueue 调用。 */
    reject: (err?: unknown) => void
  }[] = []
  /** 当前是否已有队首任务在执行。 */
  private pending = false

  /** 入队任务并返回仅代表该任务结果的 Promise。 */
  enqueue(promise: () => Promise<void>): Promise<void> {
    return new Promise<any>((resolve, reject) => {
      this.queue.push({
        promise,
        resolve,
        reject,
      })
      this.dequeue()
    })
  }

  /** 若队列空闲则启动下一项；返回是否成功启动任务。 */
  dequeue(): boolean {
    if (this.pending) {
      return false
    }
    const item = this.queue.shift()
    if (!item) {
      return false
    }
    this.pending = true
    item
      .promise()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.pending = false
        this.dequeue()
      })
    return true
  }
}
