import isModuleSyncConditionEnabled from '#module-sync-enabled'
import { DEFAULT_EXTENSIONS } from './constants'
import { tryNodeResolve } from './plugins/resolve'
import { nodeLikeBuiltins } from './utils'

/** 通过 Vite 的 Node 语义解析便捷入口可配置的最小上下文。 */
export interface NodeResolveWithViteOptions {
  /** 裸包解析的项目根/回退 basedir。 */
  root: string
  /** 按 CommonJS require 条件而非 ESM import 条件解析 exports。 */
  isRequire?: boolean
}

/**
 * 用 Vite 算法按 Node.js 运行时语义解析 id。
 *
 * 该便捷入口固定为生产构建、Node builtin、无 browser/mainFields 偏好，并关闭依赖优化、可选
 * peer 特判和 package cache，供 Vite 自身或外部消费者获得可直接执行的文件路径。
 */
export function nodeResolveWithVite(
  id: string,
  importer: string | undefined,
  options: NodeResolveWithViteOptions,
): string | undefined {
  return tryNodeResolve(id, importer, {
    root: options.root,
    isBuild: true,
    isProduction: true,
    preferRelative: false,
    tryIndex: true,
    mainFields: [],
    conditions: [
      'node',
      ...(isModuleSyncConditionEnabled ? ['module-sync'] : []),
    ],
    externalConditions: [],
    external: [],
    noExternal: [],
    dedupe: [],
    extensions: DEFAULT_EXTENSIONS,
    preserveSymlinks: false,
    tsconfigPaths: false,
    // 当前调用者没有重复解析收益，主动关闭 package cache，避免额外生命周期状态。
    packageCache: undefined,
    isRequire: options.isRequire,
    builtins: nodeLikeBuiltins,
    disableOptionalPeerDepHandling: true,
  })?.id
}
