import { afterAll } from 'vitest'
import { startDefaultServe } from '~utils'

/** 保存默认启动器的预期异常；测试读取并清除，未被消费的异常由 afterAll 抛出。 */
export let serveError: Error | undefined

/** 启动默认服务并捕获错误，使失败构建也能进入断言阶段；异常存入 serveError。 */
export async function serve() {
  try {
    await startDefaultServe()
  } catch (e) {
    serveError = e
  }
}

/** 消费已经断言的启动错误，避免 teardown 重抛预期失败。 */
export function clearServeError() {
  serveError = undefined
}

afterAll(() => {
  if (serveError) {
    throw serveError
  }
})
