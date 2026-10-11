import { dirname } from 'node:path'
import type * as esbuild from 'esbuild'
import type {
  ImportKind,
  LoadResult,
  PartialResolvedId,
  PluginContext,
  ResolveIdResult,
  Plugin as RolldownPlugin,
  RolldownPluginOption,
} from 'rolldown'

/** esbuild 回调允许同步值或异步 Promise。 */
type MaybePromise<T> = T | Promise<T>
/** esbuild onResolve 回调的统一可空返回协议。 */
type EsbuildOnResolveCallback = (
  args: esbuild.OnResolveArgs,
) => MaybePromise<esbuild.OnResolveResult | null | undefined>
/** esbuild onLoad 回调的统一可空返回协议。 */
type EsbuildOnLoadCallback = (
  args: esbuild.OnLoadArgs,
) => MaybePromise<esbuild.OnLoadResult | null | undefined>
/** 转换后的单个 onResolve 处理器，按注册顺序参与 Rolldown resolveId。 */
type ResolveIdHandler = (
  this: PluginContext,
  id: string,
  importer: string | undefined,
  opts: {
    /** 当前 import 的语法类别，用于映射 esbuild ResolveKind。 */
    kind: ImportKind
  },
) => MaybePromise<
  | (PartialResolvedId & {
      /** 自定义 esbuild namespace，会编码进 Rolldown ID。 */
      namespace?: string
    })
  | Exclude<ResolveIdResult, PartialResolvedId>
>
/** 转换后的单个 onLoad 处理器，按注册顺序参与 Rolldown load。 */
type LoadHandler = (this: PluginContext, id: string) => MaybePromise<LoadResult>

/**
 * 把 optimizeDeps.esbuildOptions.plugins 的常用 setup/onStart/onResolve/onLoad/onEnd/onDispose 子集
 * 适配为 Rolldown plugin。未实现的 PluginBuild 属性通过 Proxy 明确抛错，避免静默产生错误语义。
 * 生命周期回调在此直接调用，不等待其返回的 Promise；resolve/load 回调则会 await，
 * 接受 watchFiles，遇到 warnings、watchDirs 或缺少所需结果字段时明确失败。
 */
export function convertEsbuildPluginToRolldownPlugin(
  esbuildPlugin: esbuild.Plugin,
): RolldownPlugin {
  const onStartCallbacks: Array<() => void> = []
  const onEndCallbacks: Array<(buildResult: esbuild.BuildResult) => void> = []
  const onDisposeCallbacks: Array<() => void> = []
  let resolveIdHandlers: ResolveIdHandler[]
  let loadHandlers: LoadHandler[]

  let isSetupDone = false
  /** 构造受限 PluginBuild、收集 esbuild 回调，并转换为 Rolldown handler。 */
  const setup = async (
    plugins: RolldownPluginOption[],
    platform: 'browser' | 'node' | 'neutral',
  ) => {
    const onResolveCallbacks: Array<
      [options: esbuild.OnResolveOptions, callback: EsbuildOnResolveCallback]
    > = []
    const onLoadCallbacks: Array<
      [options: esbuild.OnLoadOptions, callback: EsbuildOnLoadCallback]
    > = []

    const pluginBuild: esbuild.PluginBuild = {
      initialOptions: new Proxy(
        {
          platform,
          plugins:
            plugins?.flatMap((p) =>
              p && 'name' in p
                ? [
                    {
                      name: p.name,
                      /** 只向 esbuild 插件暴露同链插件名，不重复运行其 setup。 */
                      // eslint-disable-next-line @typescript-eslint/no-empty-function
                      setup() {},
                    },
                  ]
                : [],
            ) ?? [],
        },
        {
          /** 仅返回兼容层明确实现的 initialOptions 字段。 */
          get(target, p, _receiver) {
            if (p in target) return (target as any)[p]
            throw new Error('Not implemented')
          },
        },
      ) as esbuild.BuildOptions,
      /** PluginBuild.resolve 尚无可靠 Rolldown 等价语义，显式拒绝。 */
      resolve() {
        throw new Error('Not implemented')
      },
      /** 登记构建开始回调，稍后由 Rolldown buildStart 调用。 */
      onStart(callback) {
        onStartCallbacks.push(callback)
      },
      /** 登记构建结束回调，稍后由 generateBundle 调用。 */
      onEnd(callback) {
        onEndCallbacks.push(callback)
      },
      /** 保存 onResolve 过滤条件与回调，setup 后转换为 resolveId handler。 */
      onResolve(options, callback) {
        onResolveCallbacks.push([options, callback])
      },
      /** 保存 onLoad 过滤条件与回调，setup 后转换为 load handler。 */
      onLoad(options, callback) {
        onLoadCallbacks.push([options, callback])
      },
      /** 保存资源清理回调，在 bundle/watcher 关闭时执行。 */
      onDispose(callback) {
        onDisposeCallbacks.push(callback)
      },
      /** 兼容层不暴露真实 esbuild 模块，读取即显式失败。 */
      get esbuild(): esbuild.PluginBuild['esbuild'] {
        throw new Error('Not implemented')
      },
      /** 兼容层不允许替换 esbuild 模块。 */
      set esbuild(_: unknown) {
        throw new Error('Not implemented')
      },
    }

    await esbuildPlugin.setup(pluginBuild)

    resolveIdHandlers = onResolveCallbacks.map(([options, callback]) =>
      createResolveIdHandler(options, callback),
    )
    loadHandlers = onLoadCallbacks.map(([options, callback]) =>
      createLoadHandler(options, callback),
    )
    isSetupDone = true
  }

  const usedNamespaces = new Set<string>()
  return {
    name: esbuildPlugin.name,
    /** 在 Rolldown options 阶段执行 esbuild setup 并收集回调；此 hook 本身没有重复调用保护。 */
    async options(inputOptions) {
      await setup(
        inputOptions.plugins as RolldownPluginOption[],
        inputOptions.platform ?? 'node',
      )
    },
    /** 确保 setup 完成后按注册顺序执行全部 onStart 回调。 */
    async buildStart(inputOptions) {
      // scanner 不调用 options hook，buildStart 需兜底完成 setup。
      if (!isSetupDone) {
        // buildStart 拿不到完整 plugins，用占位插件让 esbuild 插件识别这是 dep scan。
        await setup(
          [{ name: 'vite:dep-scan' }],
          inputOptions.platform ?? 'node',
        )
      }

      for (const cb of onStartCallbacks) {
        cb()
      }
    },
    /** 构造兼容 BuildResult 并执行全部 onEnd 回调。 */
    generateBundle(_outputOpts, _bundle, isWrite) {
      const buildResult = new Proxy(
        {
          metafile: undefined,
          mangleCache: undefined,
          ...(isWrite ? { outputFiles: undefined } : {}),
        } as esbuild.BuildResult,
        {
          /** 只允许读取兼容层承诺的 BuildResult 字段。 */
          get(_target, prop) {
            if (prop in _target || typeof prop === 'symbol') {
              return (_target as any)[prop]
            }
            throw new Error('Not implemented property: ' + prop)
          },
        },
      )
      for (const cb of onEndCallbacks) {
        cb(buildResult)
      }
    },
    /** 依次运行转换后的 onResolve，并处理自定义 namespace 回退解析。 */
    async resolveId(id, importer, opts) {
      for (const handler of resolveIdHandlers) {
        const result = await handler.call(this, id, importer, opts)
        if (result) {
          if (typeof result === 'object' && result.namespace) {
            usedNamespaces.add(result.namespace)
          }
          return result
        }
      }
      if (usedNamespaces.size) {
        const [importerWithoutNamespace, namespaceFromImporter] =
          idToPathAndNamespace(importer)
        if (usedNamespaces.has(namespaceFromImporter)) {
          return await this.resolve(id, importerWithoutNamespace, opts)
        }
      }
    },
    /** 依次运行转换后的 onLoad，首个非空结果终止后续 handler。 */
    async load(id) {
      for (const handler of loadHandlers) {
        const result = await handler.call(this, id)
        if (result) {
          return result
        }
      }
    },
    /** 非 watch 构建完成时执行 esbuild onDispose 回调。 */
    closeBundle() {
      if (!this.meta.watchMode) {
        for (const cb of onDisposeCallbacks) {
          cb()
        }
      }
    },
    /** watch 生命周期关闭时执行 esbuild onDispose 回调。 */
    closeWatcher() {
      for (const cb of onDisposeCallbacks) {
        cb()
      }
    },
  }
}

/** 把 esbuild onResolve filter/namespace/args/result/watchFiles 映射为 Rolldown resolveId。 */
function createResolveIdHandler(
  options: esbuild.OnResolveOptions,
  callback: EsbuildOnResolveCallback,
): ResolveIdHandler {
  return async function (id, importer, opts) {
    const [importerWithoutNamespace, importerNamespace] =
      idToPathAndNamespace(importer)
    if (
      options.namespace !== undefined &&
      options.namespace !== importerNamespace
    ) {
      return
    }
    if (options.filter !== undefined && !options.filter.test(id)) {
      return
    }

    const result = await callback({
      path: id,
      importer: importerWithoutNamespace ?? '',
      namespace: importerNamespace,
      resolveDir: dirname(importerWithoutNamespace ?? ''),
      kind:
        importerWithoutNamespace === undefined
          ? 'entry-point'
          : opts.kind === 'new-url' || opts.kind === 'hot-accept'
            ? 'dynamic-import'
            : opts.kind,
      pluginData: {},
      with: {},
    })
    if (!result) return
    if (result.errors && result.errors.length > 0) {
      throw new AggregateError(result.errors)
    }
    if (
      (result.warnings && result.warnings.length > 0) ||
      (result.watchDirs && result.watchDirs.length > 0) ||
      !result.path
    ) {
      throw new Error('not implemented')
    }
    for (const file of result.watchFiles ?? []) {
      this.addWatchFile(file)
    }

    return {
      id: result.namespace ? `${result.namespace}:${result.path}` : result.path,
      external: result.external,
      moduleSideEffects: result.sideEffects,
      namespace: result.namespace,
    }
  }
}

/** 把 esbuild onLoad namespace/filter 与字符串/Uint8Array contents 映射为 Rolldown load。 */
function createLoadHandler(
  options: esbuild.OnLoadOptions,
  callback: EsbuildOnLoadCallback,
): LoadHandler {
  const textDecoder = new TextDecoder()
  return async function (id) {
    const [idWithoutNamespace, idNamespace] = idToPathAndNamespace(id)
    if (
      options.namespace !== undefined &&
      options.namespace !== 'file' &&
      options.namespace !== idNamespace
    ) {
      return
    }
    if (options.filter !== undefined && !options.filter.test(id)) {
      return
    }

    const result = await callback.call(this, {
      path: idWithoutNamespace,
      namespace: idNamespace,
      suffix: '',
      pluginData: {},
      with: {},
    })
    if (!result) return
    if (result.errors && result.errors.length > 0) {
      throw new AggregateError(result.errors)
    }
    if (
      (result.warnings && result.warnings.length > 0) ||
      (result.watchDirs && result.watchDirs.length > 0) ||
      result.contents == null
    ) {
      throw new Error('not implemented')
    }
    for (const file of result.watchFiles ?? []) {
      this.addWatchFile(file)
    }

    return {
      code:
        typeof result.contents === 'string'
          ? result.contents
          : textDecoder.decode(result.contents),
      moduleType: result.loader,
    }
  }
}

/** 把必选 Rolldown ID 拆成 esbuild 路径与 namespace。 */
function idToPathAndNamespace(id: string): [path: string, namespace: string]
/** 把可选 importer 拆成 esbuild 路径与 namespace。 */
function idToPathAndNamespace(
  id: string | undefined,
): [path: string | undefined, namespace: string]
/** 默认使用 file namespace；自定义 namespace 取 ID 首个冒号之前的前缀。 */
function idToPathAndNamespace(
  id: string | undefined,
): [path: string | undefined, namespace: string] {
  // esbuild 默认 namespace 为 file；自定义 namespace 用首个 `:` 编码进 Rolldown ID。
  if (id === undefined) return [undefined, 'file']

  const namespaceIndex = id.indexOf(':')
  if (namespaceIndex >= 0) {
    return [id.slice(namespaceIndex + 1), id.slice(0, namespaceIndex)]
  } else {
    return [id, 'file']
  }
}
