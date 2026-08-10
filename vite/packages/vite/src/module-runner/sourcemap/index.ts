import type { ModuleRunner } from '../runner'
import { interceptStackTrace } from './interceptor'

/**
 * 为 Runner 开启 sourcemap 堆栈支持，并返回恢复函数。
 *
 * `node` 模式直接启用 Node 原生支持；其余模式安装 `Error.prepareStackTrace`
 * 拦截器，从 Runner 的模块缓存或用户提供的读取函数中查找映射。
 */
export function enableSourceMapSupport(runner: ModuleRunner): () => void {
  if (runner.options.sourcemapInterceptor === 'node') {
    if (typeof process === 'undefined') {
      throw new TypeError(
        `Cannot use "sourcemapInterceptor: 'node'" because global "process" variable is not available.`,
      )
    }
    /* eslint-disable n/no-unsupported-features/node-builtins -- process.setSourceMapsEnabled and process.sourceMapsEnabled */
    if (typeof process.setSourceMapsEnabled !== 'function') {
      throw new TypeError(
        `Cannot use "sourcemapInterceptor: 'node'" because "process.setSourceMapsEnabled" function is not available. Please use Node >= 16.6.0.`,
      )
    }
    const isEnabledAlready = process.sourceMapsEnabled ?? false
    process.setSourceMapsEnabled(true)
    return () => !isEnabledAlready && process.setSourceMapsEnabled(false)
    /* eslint-enable n/no-unsupported-features/node-builtins */
  }
  return interceptStackTrace(
    runner,
    typeof runner.options.sourcemapInterceptor === 'object'
      ? runner.options.sourcemapInterceptor
      : undefined,
  )
}
