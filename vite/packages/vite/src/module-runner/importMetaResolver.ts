import type { ResolveFnOutput, ResolveHookContext } from 'node:module'

/** 按显式 importer 解析 specifier 的同步 import.meta.resolve 适配器。 */
export type ImportMetaResolver = (specifier: string, importer: string) => string

/** loader hook 私有协议前缀，避免把封装请求误作用户模块。 */
const customizationHookNamespace = 'vite-module-runner:import-meta-resolve/v1/'
/** 注册给旧版 Node `module.register()` 的 data URL loader 源码。 */
const customizationHooksModule = /* js */ `

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(${JSON.stringify(customizationHookNamespace)})) {
    const data = specifier.slice(${JSON.stringify(customizationHookNamespace)}.length)
    const [parsedSpecifier, parsedImporter] = JSON.parse(data)
    specifier = parsedSpecifier
    context.parentURL = parsedImporter
  }
  return nextResolve(specifier, context)
}

`
/**
 * Node resolve hook：从 Vite 的私有命名空间中还原真实 specifier 与 parentURL，
 * 再把解析交还给 Node。这样可以为任意 importer 模拟 `import.meta.resolve()`。
 */
function customizationHookResolve(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (
    specifier: string,
    context: ResolveHookContext,
  ) => ResolveFnOutput,
): ResolveFnOutput {
  if (specifier.startsWith(customizationHookNamespace)) {
    const data = specifier.slice(customizationHookNamespace.length)
    const [parsedSpecifier, parsedImporter] = JSON.parse(data)
    specifier = parsedSpecifier
    context.parentURL = parsedImporter
  }
  return nextResolve(specifier, context)
}

/** 进程级 hook 的注册标记；防止每个 Runner 都追加 hook，造成解析链不断增长。 */
let isHookRegistered = false

/**
 * 创建支持自定义 importer 的 `import.meta.resolve`。
 *
 * 优先使用同步且开销更低的 `module.registerHooks()`；旧版 Node 则通过 data URL
 * 注册异步 hook。运行时不支持 hook、内建模块被 mock，或旧版网络导入限制生效时，
 * 返回 `undefined`。createNodeImportMeta 此时采用默认的“不支持 resolve”实现。
 */
export function createImportMetaResolver(): ImportMetaResolver | undefined {
  if (isHookRegistered) {
    return importMetaResolveWithCustomHook
  }

  let module: typeof import('node:module') | undefined
  try {
    module =
      typeof process !== 'undefined'
        ? process.getBuiltinModule('node:module').Module
        : undefined
  } catch {
    return
  }
  // `node:module` 被测试或宿主 mock 时，`module.Module` 可能不存在。
  if (!module) {
    return
  }

  // 优先用性能更好的同步 registerHooks。
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- 已在运行时检查是否存在
  if (module.registerHooks) {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- 上方已检查是否存在
    module.registerHooks({ resolve: customizationHookResolve })
    isHookRegistered = true
    return importMetaResolveWithCustomHook
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- 已在运行时检查是否存在
  if (!module.register) {
    return
  }

  try {
    const hookModuleContent = `data:text/javascript,${encodeURI(customizationHooksModule)}`
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- 上方已检查是否存在
    module.register(hookModuleContent)
  } catch (e) {
    // Node 22 以前开启 `--experimental-network-imports` 时，data URL hook 可能被拒绝。
    if ('code' in e && e.code === 'ERR_NETWORK_IMPORT_DISALLOWED') {
      return
    }
    throw e
  }

  isHookRegistered = true
  return importMetaResolveWithCustomHook
}

/** 把 specifier 与 importer 编码进私有命名空间，交由进程级 resolve hook 还原。 */
function importMetaResolveWithCustomHook(
  specifier: string,
  importer: string,
): string {
  return import.meta.resolve(
    `${customizationHookNamespace}${JSON.stringify([specifier, importer])}`,
  )
}

/** 可嵌入 Node Runner 的解析器源码；计算属性避免 define 替换 import.meta.resolve。 */
export const importMetaResolveWithCustomHookString: string = /* js */ `

  (() => {
    const resolve = 'resolve'
    return (specifier, importer) =>
      import.meta[resolve](
        \`${customizationHookNamespace}\${JSON.stringify([specifier, importer])}\`,
      )
  })()

`
