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
 * 该便捷入口固定生产条件、无 browser/mainFields 偏好，并关闭依赖优化、可选 peer 特判和
 * package cache。只返回包入口路径；builtin 通常无包入口而返回 undefined，TS 扩展名回退
 * 仍遵循 Vite 规则，后续加载由调用方决定。
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
    // 该入口不持有跨调用 package cache；每次解析读取当时的 package.json。
    packageCache: undefined,
    isRequire: options.isRequire,
    builtins: nodeLikeBuiltins,
    disableOptionalPeerDepHandling: true,
  })?.id
}
