import path from 'node:path'
import type { InternalResolveOptions } from './plugins/resolve'
import { tryNodeResolve } from './plugins/resolve'
import {
  bareImportRE,
  createDebugger,
  createFilter,
  getNpmPackageName,
  isBuiltin,
  isInNodeModules,
} from './utils'
import type { Environment } from './environment'
import type { PartialEnvironment } from './baseEnvironment'

/** `DEBUG=vite:external` 启用的 external 判定诊断日志。 */
const debug = createDebugger('vite:external')

/** 每个 Environment 独立缓存的最终 external 判定函数。 */
const isExternalCache = new WeakMap<
  Environment,
  (id: string, importer?: string) => boolean
>()

/**
 * 判断 id 在当前 Environment 中是否应保留为运行时外部 import。
 * 判定器按 Environment 实例缓存，避免 client/server 的 builtin、conditions、external 配置串线。
 */
export function shouldExternalize(
  environment: Environment,
  id: string,
  importer: string | undefined,
): boolean {
  let isExternal = isExternalCache.get(environment)
  if (!isExternal) {
    isExternal = createIsExternal(environment)
    isExternalCache.set(environment, isExternal)
  }
  return isExternal(id, importer)
}

/**
 * 把 `resolve.external`、`resolve.noExternal` 与真实 Node 解析结果合成为 external 判定器。
 * 默认路径只接受可解析的裸包 JS；链接包需显式 external。精确 external 与布尔 noExternal
 * 分支直接返回，不经过默认路径的解析/文件类型检查。
 */
export function createIsConfiguredAsExternal(
  environment: PartialEnvironment,
): (id: string, importer?: string) => boolean {
  const { config } = environment
  const { root, resolve } = config
  const { external, noExternal } = resolve
  const noExternalFilter =
    typeof noExternal !== 'boolean' &&
    !(Array.isArray(noExternal) && noExternal.length === 0) &&
    createFilter(undefined, noExternal, { resolve: false })

  const targetConditions = resolve.externalConditions

  const resolveOptions: InternalResolveOptions = {
    ...resolve,
    root,
    isProduction: false,
    isBuild: true,
    conditions: targetConditions,
  }

  /** 解析 id 并检查其文件类型/链接位置是否具备外部化条件。 */
  const isExternalizable = (
    id: string,
    importer: string | undefined,
    configuredAsExternal: boolean,
  ): boolean => {
    if (!bareImportRE.test(id) || id.includes('\0')) {
      return false
    }
    try {
      const resolved = tryNodeResolve(
        id,
        // build 不传 importer：若依赖只在嵌套 node_modules 可解析、从 root 不可解析，生成的
        // 外部产物同样无法在运行时解析，不能错误外部化。
        config.command === 'build' ? undefined : importer,
        resolveOptions,
        undefined,
        false,
      )
      if (!resolved) {
        return false
      }
      // workspace/link 包默认视为源码参与转换；只有显式 external 才允许保留运行时 import。
      if (!configuredAsExternal && !isInNodeModules(resolved.id)) {
        return false
      }
      return canExternalizeFile(resolved.id)
    } catch {
      debug?.(
        `Failed to node resolve "${id}". Skipping externalizing it by default.`,
      )
      // 可能是稍后由用户插件解析的虚拟/自定义 import，Node 解析失败不能提前外部化。
      return false
    }
  }

  // 优先级：精确 id external → 包名 external → noExternal 布尔/过滤器 → 默认可外部化判断。
  return (id: string, importer?: string) => {
    if (
      // 精确命中原始 id 直接外部化，不再检查是否存在、是否链接包或是否 JS 文件。
      external !== true &&
      external.includes(id)
    ) {
      return true
    }
    const pkgName = getNpmPackageName(id)
    if (!pkgName) {
      return isExternalizable(id, importer, false)
    }
    if (
      // 包名 external 覆盖该包所有可外部化 deep import。
      external !== true &&
      external.includes(pkgName)
    ) {
      return isExternalizable(id, importer, true)
    }
    if (typeof noExternal === 'boolean') {
      return !noExternal
    }
    if (noExternalFilter && !noExternalFilter(pkgName)) {
      return false
    }
    // external:true 明确允许链接包也按默认策略外部化。
    return isExternalizable(id, importer, external === true)
  }
}

/** 在配置判定外加入 builtin/相对路径规则，并按原始 id 缓存最终结果。 */
function createIsExternal(
  environment: Environment,
): (id: string, importer?: string) => boolean {
  const processedIds = new Map<string, boolean>()

  const isConfiguredAsExternal = createIsConfiguredAsExternal(environment)

  return (id: string, importer?: string) => {
    if (processedIds.has(id)) {
      return processedIds.get(id)!
    }
    let isExternal = false
    if (id[0] !== '.' && !path.isAbsolute(id)) {
      isExternal =
        isBuiltin(environment.config.resolve.builtins, id) ||
        isConfiguredAsExternal(id, importer)
    }
    processedIds.set(id, isExternal)
    return isExternal
  }
}

/** 只有无扩展名或 JS/CJS/ESM 文件可保留为运行时 import；CSS/JSON 等仍需 Vite 处理。 */
export function canExternalizeFile(filePath: string): boolean {
  const ext = path.extname(filePath)
  // 非 JS 资源需要插件转换，不能交给原生 Node import。
  return !ext || ext === '.js' || ext === '.mjs' || ext === '.cjs'
}
