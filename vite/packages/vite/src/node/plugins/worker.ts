import path from 'node:path'
import MagicString from 'magic-string'
import type { PluginContext, RolldownOutput, RollupError } from 'rolldown'
import colors from 'picocolors'
import { type ImportSpecifier, init, parse } from 'es-module-lexer'
import { viteWebWorkerPostPlugin as nativeWebWorkerPostPlugin } from 'rolldown/experimental'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import { ENV_ENTRY, ENV_PUBLIC_PATH } from '../constants'
import {
  encodeURIPath,
  getHash,
  injectQuery,
  normalizePath,
  prettifyUrl,
  urlRE,
} from '../utils'
import {
  BuildEnvironment,
  ChunkMetadataMap,
  createToImportMetaURLBasedRelativeRuntime,
  injectEnvironmentToHooks,
  onRollupLog,
  toOutputFilePathInJS,
} from '../build'
import { cleanUrl } from '../../shared/utils'
import type { Logger } from '../logger'
import { fileToUrl, toOutputFilePathInJSForBundledDev } from './asset'

/** 描述一个 worker 入口产物及其关联资源和内容哈希。 */
type WorkerBundle = {
  /** worker 入口在子构建中的输出文件名。 */
  entryFilename: string
  /** worker 入口 chunk 的最终代码。 */
  entryCode: string
  /** 先写入主构建、再由 `renderChunk` 替换成真实 URL 的占位符。 */
  entryUrlPlaceholder: string
  /** 该 worker 子构建引用的其他 chunk 与资源，用于失效时回收缓存。 */
  referencedAssets: Set<string>
  /** 子构建观察到的全部文件，用于把主构建的 watch 事件传给 worker 缓存。 */
  watchedFiles: string[]
}

/** 保存 worker 子构建发射资源的文件名、原始名与内容。 */
type WorkerBundleAsset = {
  /** 产物中的最终文件名。 */
  fileName: string
  /** @deprecated */
  originalFileName: string | null
  /** 该产物关联的全部原始源文件名。 */
  originalFileNames: string[]
  /** 资源的文本或二进制源内容。 */
  source: string | Uint8Array
}

/**
 * 保存一次主构建下所有 worker 子构建的结果。
 *
 * 同一 worker 可能被多个入口引用；缓存既避免重复打包，也让主构建能够统一
 * 发射 worker 的入口、拆分 chunk 和资源。文件变化时先标记受影响的 bundle，
 * 下一次真正访问该 worker 时再删除旧结果并重新构建。
 */
class WorkerOutputCache {
  /**
   * 按输入 id 保存 worker bundle，使同一个 worker 文件只打包一次。
   */
  private bundles = new Map</* inputId */ string, WorkerBundle>()
  /** 所有 worker bundle 产生、等待主构建发射的资源。 */
  private assets = new Map<string, WorkerBundleAsset>()
  /** 从 worker 入口文件名映射到占位哈希。 */
  private fileNameHash = new Map<
    /* hash */ string,
    /* entryFilename */ string
  >()
  /** 因源文件变化而等待移除的 worker bundle 集合。 */
  private invalidatedBundles = new Set</* inputId */ string>()

  /** 保存 worker 入口子构建及哈希索引，并登记它发射的关联资源。 */
  saveWorkerBundle(
    file: string,
    watchedFiles: string[],
    outputEntryFilename: string,
    outputEntryCode: string,
    outputAssets: WorkerBundleAsset[],
    logger: Logger,
  ): WorkerBundle {
    for (const asset of outputAssets) {
      this.saveAsset(asset, logger)
    }
    const bundle: WorkerBundle = {
      entryFilename: outputEntryFilename,
      entryCode: outputEntryCode,
      entryUrlPlaceholder:
        this.generateEntryUrlPlaceholder(outputEntryFilename),
      referencedAssets: new Set(outputAssets.map((asset) => asset.fileName)),
      watchedFiles,
    }
    this.bundles.set(file, bundle)
    return bundle
  }

  /** 按文件名保存 worker 资源；内容冲突时保留先到值并报告警告。 */
  saveAsset(asset: WorkerBundleAsset, logger: Logger) {
    const duplicateAsset = this.assets.get(asset.fileName)
    if (duplicateAsset) {
      if (!isSameContent(duplicateAsset.source, asset.source)) {
        logger.warn(
          `\n` +
            colors.yellow(
              `The emitted file ${JSON.stringify(asset.fileName)} overwrites a previously emitted file of the same name.`,
            ),
        )
      }
    }
    this.assets.set(asset.fileName, asset)
  }

  /** 把引用变化文件的 worker bundle 标为失效，等待下次访问清理。 */
  invalidateAffectedBundles(file: string) {
    for (const [bundleInputFile, bundle] of this.bundles.entries()) {
      if (bundle.watchedFiles.includes(file)) {
        this.invalidatedBundles.add(bundleInputFile)
      }
    }
  }

  /** 仅在 bundle 已标记失效时移除其入口、哈希与资源引用。 */
  removeBundleIfInvalidated(file: string) {
    if (this.invalidatedBundles.has(file)) {
      this.invalidatedBundles.delete(file)
      this.removeBundle(file)
    }
  }

  /** 删除一个 worker bundle 及其派生索引，并清理不再被引用的资源。 */
  private removeBundle(file: string) {
    const bundle = this.bundles.get(file)
    if (!bundle) return

    this.bundles.delete(file)
    this.fileNameHash.delete(getHash(bundle.entryFilename))

    this.assets.delete(bundle.entryFilename)

    const keptBundles = [...this.bundles.values()]
    // 只删除该 bundle 独占的资源；其他 worker 仍引用的公共 chunk 必须保留。
    for (const asset of bundle.referencedAssets) {
      if (keptBundles.every((b) => !b.referencedAssets.has(asset))) {
        this.assets.delete(asset)
      }
    }
  }

  /** 取得仍有效的 worker bundle；若已失效则先完成清理。 */
  getWorkerBundle(file: string) {
    return this.bundles.get(file)
  }

  /** 返回当前缓存中仍被 worker bundle 引用的资源列表。 */
  getAssets() {
    return this.assets.values()
  }

  /** 从 worker URL 占位哈希反查入口文件名。 */
  getEntryFilenameFromHash(hash: string) {
    return this.fileNameHash.get(hash)
  }

  /** 为 worker 入口生成稳定占位符，并建立哈希到文件名的反向索引。 */
  private generateEntryUrlPlaceholder(entryFilename: string): string {
    const hash = getHash(entryFilename)
    if (!this.fileNameHash.has(hash)) {
      this.fileNameHash.set(hash, entryFilename)
    }
    return `__VITE_WORKER_ASSET__${hash}__`
  }
}

/** 区分 classic、module 与显式忽略转换的 Worker 类型。 */
export type WorkerType = 'classic' | 'module' | 'ignore'

/** 识别源码中的 Worker 与 SharedWorker 构造器。 */
export const workerOrSharedWorkerRE: RegExp =
  /(?:\?|&)(worker|sharedworker)(?:&|$)/
/** 从内部 worker 文件请求中提取 worker 类型。 */
const workerFileRE = /(?:\?|&)worker_file&type=(\w+)(?:&|$)/
/** 识别要求把 worker bundle 内联为 data URL 的查询参数。 */
const inlineRE = /[?&]inline\b/

/** 标记内部 worker 文件请求的稳定查询参数。 */
export const WORKER_FILE_ID = 'worker_file'
/** 按配置保存 worker 子构建缓存，隔离不同项目的产物状态。 */
const workerOutputCaches = new WeakMap<ResolvedConfig, WorkerOutputCache>()

/**
 * 把 worker 入口作为独立的客户端子构建打包，并缓存其入口与关联资源。
 *
 * `bundleChain` 记录嵌套 worker 的入口链，从而在递归构建前报告循环引用；
 * 子构建自己的插件、target、格式和 sourcemap 均来自 `config.worker`。
 */
async function bundleWorkerEntry(
  config: ResolvedConfig,
  id: string,
): Promise<WorkerBundle> {
  const input = cleanUrl(id)

  const workerOutput = workerOutputCaches.get(config.mainConfig || config)!
  workerOutput.removeBundleIfInvalidated(input)

  const bundleInfo = workerOutput.getWorkerBundle(input)
  if (bundleInfo) {
    return bundleInfo
  }

  const newBundleChain = [...config.bundleChain, input]
  if (config.bundleChain.includes(input)) {
    throw new Error(
      'Circular worker imports detected. Vite does not support it. ' +
        `Import chain: ${newBundleChain.map((id) => prettifyUrl(id, config.root)).join(' -> ')}`,
    )
  }

  // worker 自身可以继续 import 依赖，因此必须把文件当作入口执行完整打包。
  const { rolldown } = await import('rolldown')
  const { plugins, rolldownOptions, format } = config.worker
  const workerConfig = await plugins(newBundleChain)
  // TODO：评估环境名是否应改为 worker；当前仍沿用 client 以保持插件兼容。
  const workerEnvironment = new BuildEnvironment('client', workerConfig)
  await workerEnvironment.init()

  const chunkMetadataMap = new ChunkMetadataMap()
  const workerBuildTarget = workerEnvironment.config.build.target
  const bundle = await rolldown({
    ...rolldownOptions,
    input,
    plugins: workerEnvironment.plugins.map((p) =>
      injectEnvironmentToHooks(workerEnvironment, chunkMetadataMap, p),
    ),
    /** 过滤 worker 子构建日志，并把其余诊断按主构建日志策略转发。 */
    onLog(level, log) {
      onRollupLog(level, log, workerEnvironment)
    },
    transform: {
      target: workerBuildTarget === false ? undefined : workerBuildTarget,
      ...rolldownOptions.transform,
      define: {
        ...rolldownOptions.transform?.define,
        // `define` 插件已经处理该值，禁用 Rolldown 内建的重复替换。
        'process.env.NODE_ENV': 'process.env.NODE_ENV',
      },
    },
    // TODO: Rolldown 的 CSS 支持接入 worker 子构建后移除此兼容层。
    moduleTypes: {
      '.css': 'js',
      ...rolldownOptions.moduleTypes,
    },
    preserveEntrySignatures: false,
    experimental: {
      ...rolldownOptions.experimental,
      viteMode: true,
    },
  })
  let result: RolldownOutput
  let watchedFiles: string[] | undefined
  try {
    const workerOutputConfig = config.worker.rolldownOptions.output
    const workerConfig = workerOutputConfig
      ? Array.isArray(workerOutputConfig)
        ? workerOutputConfig[0] || {}
        : workerOutputConfig
      : {}
    result = await bundle.generate({
      entryFileNames: path.posix.join(
        config.build.assetsDir,
        '[name]-[hash].js',
      ),
      chunkFileNames: path.posix.join(
        config.build.assetsDir,
        '[name]-[hash].js',
      ),
      assetFileNames: path.posix.join(
        config.build.assetsDir,
        '[name]-[hash].[ext]',
      ),
      minify:
        workerEnvironment.config.build.minify === 'oxc'
          ? true
          : workerEnvironment.config.build.minify === false
            ? 'dce-only'
            : undefined,
      ...workerConfig,
      format,
      sourcemap: workerEnvironment.config.build.sourcemap,
    })
    watchedFiles = (await bundle.watchFiles).map((f) => normalizePath(f))
  } catch (e) {
    // 错误对用户暴露的是 Vite 配置名，因此把 `output.format` 改写为 `worker.format`。
    if (
      e instanceof Error &&
      e.name === 'RollupError' &&
      (e as RollupError).code === 'INVALID_OPTION' &&
      e.message.includes('"output.format"')
    ) {
      e.message = e.message.replace('output.format', 'worker.format')
    }
    throw e
  } finally {
    await bundle.close()
  }

  const {
    output: [outputChunk, ...outputChunks],
  } = result
  const assets = outputChunks.map((outputChunk) =>
    outputChunk.type === 'asset'
      ? outputChunk
      : {
          fileName: outputChunk.fileName,
          originalFileName: null,
          originalFileNames: [],
          source: outputChunk.code,
        },
  )
  if (
    (config.build.sourcemap === 'hidden' || config.build.sourcemap === true) &&
    outputChunk.map
  ) {
    assets.push({
      fileName: outputChunk.fileName + '.map',
      originalFileName: null,
      originalFileNames: [],
      source: outputChunk.map.toString(),
    })
  }

  const newBundleInfo = workerOutputCaches
    .get(config.mainConfig || config)!
    .saveWorkerBundle(
      input,
      watchedFiles,
      outputChunk.fileName,
      outputChunk.code,
      assets,
      config.logger,
    )
  return newBundleInfo
}

/** 匹配主构建代码中的 worker 资源占位符。 */
export const workerAssetUrlRE: RegExp = /__VITE_WORKER_ASSET__([a-z\d]{8})__/g

/** 打包 worker 入口，并把入口文件本身也登记为待发射资源。 */
export async function workerFileToUrl(
  config: ResolvedConfig,
  id: string,
): Promise<WorkerBundle> {
  const workerOutput = workerOutputCaches.get(config.mainConfig || config)!
  const bundle = await bundleWorkerEntry(config, id)
  workerOutput.saveAsset(
    {
      fileName: bundle.entryFilename,
      originalFileName: null,
      originalFileNames: [],
      source: bundle.entryCode,
    },
    config.logger,
  )
  return bundle
}

/**
 * 在 `load` / `transform` 阶段发射已打包的 worker 文件。
 *
 * 它们通常由 `generateBundle` 写入输出，但 bundled-dev 的 HMR 补丁不会经过
 * 该钩子；若不在此补发，更新后的 worker URL 会指向一个从未生成的文件。
 */
export function emitWorkerAssetsForBundledDev(
  pluginContext: {
    /** 主构建用于接收 worker 子构建资源的发射函数。 */
    emitFile: PluginContext['emitFile']
  },
  config: ResolvedConfig,
): void {
  if (config.isWorker) return

  const workerOutput = workerOutputCaches.get(config.mainConfig || config)!
  for (const asset of workerOutput.getAssets()) {
    pluginContext.emitFile({
      type: 'asset',
      fileName: asset.fileName,
      source: asset.source,
    })
  }
}

/**
 * 在 worker 变换末尾修复 IIFE 中不可用的 `import.meta`。
 *
 * `import.meta.url` 可直接映射到 `self.location.href`；其他属性则通过注入的
 * `_vite_importMeta` 对象保留合法语法。正式子构建交给 Rolldown 原生插件，
 * 非 bundled 环境仍由这里完成相同语义。
 */
export function webWorkerPostPlugin(_config: ResolvedConfig): Plugin {
  return {
    name: 'vite:worker-post',
    /** worker 后处理仅进入 bundled 环境，以便改写子构建产物占位符。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        if (environment.config.worker.format === 'iife') {
          return nativeWebWorkerPostPlugin()
        }
        return false
      }
      return true
    },
    transform: {
      filter: {
        code: 'import.meta',
      },
      order: 'post',
      /** 替换 worker chunk 中的资源 URL，并按输出格式补入运行时环境垫片。 */
      async handler(code, id) {
        // IIFE worker 中没有 `import.meta`，必须在输出前改写。
        if (this.environment.config.worker.format === 'iife') {
          await init

          let imports: readonly ImportSpecifier[]
          try {
            imports = parse(code)[0]
          } catch {
            // 解析失败交给后续阶段报告原始语法错误，此处不额外干预。
            return
          }

          let injectedImportMeta = false
          let s: MagicString | undefined
          for (const { s: start, e: end, d: dynamicIndex } of imports) {
            // `es-module-lexer` 用 `d === -2` 标识 `import.meta`。
            if (dynamicIndex === -2) {
              const prop = code.slice(end, end + 4)
              if (prop === '.url') {
                s ||= new MagicString(code)
                s.overwrite(start, end + 4, 'self.location.href')
              } else {
                s ||= new MagicString(code)
                if (!injectedImportMeta) {
                  s.prepend(
                    'const _vite_importMeta = { url: self.location.href };\n',
                  )
                  injectedImportMeta = true
                }
                s.overwrite(start, end, '_vite_importMeta')
              }
            }
          }

          if (!s) return

          return {
            code: s.toString(),
            map: s.generateMap({ hires: 'boundary', source: id }),
          }
        }
      },
    },
  }
}

/**
 * 把 `?worker` / `?sharedworker` 导入转换成构造器包装模块，并管理 worker 子构建。
 *
 * 开发模式只生成带 `worker_file&type=...` 的 URL，由 transform 阶段注入运行时；
 * 构建模式则独立打包 worker，用占位符跨越主构建，最后在 `renderChunk` 中按
 * 当前输出格式换成最终公共路径或相对路径。
 */
export function webWorkerPlugin(config: ResolvedConfig): Plugin {
  const isBuild = config.command === 'build'
  const isWorker = config.isWorker

  workerOutputCaches.set(config, new WorkerOutputCache())
  const emittedAssets = new Set<string>()

  return {
    name: 'vite:worker',

    /** 为当前构建创建新的 worker 输出缓存，隔离监听模式的前后两轮产物。 */
    buildStart() {
      if (isWorker) return
      emittedAssets.clear()
    },

    load: {
      filter: { id: workerOrSharedWorkerRE },
      /** 加载 worker 子构建或内联结果，并生成主模块可导出的构造 URL。 */
      async handler(id) {
        const workerMatch = workerOrSharedWorkerRE.exec(id)
        if (!workerMatch) return

        const { format } = config.worker
        const workerConstructor =
          workerMatch[1] === 'sharedworker' ? 'SharedWorker' : 'Worker'
        const isBundled = this.environment.config.isBundled
        const workerType = isBundled
          ? format === 'es'
            ? 'module'
            : 'classic'
          : 'module'
        const workerTypeOption = `{
          ${workerType === 'module' ? `type: "module",` : ''}
          name: options?.name
        }`

        let urlCode: string
        if (isBundled) {
          if (isWorker && config.bundleChain.at(-1) === cleanUrl(id)) {
            urlCode = 'self.location.href'
          } else if (inlineRE.test(id)) {
            const result = await bundleWorkerEntry(config, id)
            for (const file of result.watchedFiles) {
              this.addWatchFile(file)
            }

            const jsContent = `const jsContent = ${JSON.stringify(result.entryCode)};`

            const code =
              // SharedWorker 使用 blob URL 时，每次 URL 都不同，会破坏同 URL 复用实例的语义。
              workerConstructor === 'Worker'
                ? `${jsContent}
            const blob = typeof self !== "undefined" && self.Blob && new Blob([${
              // WebKit 要求先完成 worker 构造再回收 object URL。
              workerType === 'classic'
                ? `'(self.URL || self.webkitURL).revokeObjectURL(self.location.href);',`
                : // module Worker 中始终可直接使用 URL 全局量。
                  `'URL.revokeObjectURL(import.meta.url);',`
            }jsContent], { type: "text/javascript;charset=utf-8" });
            export default function WorkerWrapper(options) {
              let objURL;
              try {
                objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
                if (!objURL) throw ''
                const worker = new ${workerConstructor}(objURL, ${workerTypeOption});
                worker.addEventListener("error", () => {
                  (self.URL || self.webkitURL).revokeObjectURL(objURL);
                });
                return worker;
              } catch(e) {
                return new ${workerConstructor}(
                  'data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent),
                  ${workerTypeOption}
                );
              }
            }`
                : `${jsContent}
            export default function WorkerWrapper(options) {
              return new ${workerConstructor}(
                'data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent),
                ${workerTypeOption}
              );
            }
            `

            return {
              code,
              // 返回空 sourcemap，避免 Rolldown 对缺少映射发出警告。
              map: { mappings: '' },
            }
          } else {
            const result = await workerFileToUrl(config, id)
            let url: string
            if (
              this.environment.config.command === 'serve' &&
              this.environment.config.isBundled
            ) {
              emitWorkerAssetsForBundledDev(this, config)
              url = toOutputFilePathInJSForBundledDev(
                this.environment,
                result.entryFilename,
              )
            } else {
              url = result.entryUrlPlaceholder
            }
            urlCode = JSON.stringify(url)
            for (const file of result.watchedFiles) {
              this.addWatchFile(file)
            }
          }
        } else {
          let url = await fileToUrl(this, cleanUrl(id))
          url = injectQuery(url, `${WORKER_FILE_ID}&type=${workerType}`)
          urlCode = JSON.stringify(url)
        }

        if (urlRE.test(id)) {
          return {
            code: `export default ${urlCode}`,
            map: { mappings: '' }, // 空 sourcemap 用于抑制 Rolldown 警告。
          }
        }

        return {
          code: `export default function WorkerWrapper(options) {
            return new ${workerConstructor}(
              ${urlCode},
              ${workerTypeOption}
            );
          }`,
          map: { mappings: '' }, // 空 sourcemap 用于抑制 Rolldown 警告。
        }
      },
    },

    transform: {
      filter: { id: workerFileRE },
      /** 识别 worker 请求并生成包装模块，开发态直接返回服务 URL。 */
      handler(raw, id) {
        const workerFileMatch = workerFileRE.exec(id)
        if (workerFileMatch) {
          // 构造器导入会携带具体 `query.type`；其他形式按 ESM worker 处理。
          const workerType = workerFileMatch[1] as WorkerType
          let injectEnv = ''

          if (workerType === 'classic') {
            // `importScripts` 不会自动注入 base，classic worker 需要在这里主动拼接。
            const scriptPath = JSON.stringify(
              path.posix.join(config.base, ENV_PUBLIC_PATH),
            )
            injectEnv = `importScripts(${scriptPath})\n`
          } else if (workerType === 'module') {
            const scriptPath = JSON.stringify(ENV_PUBLIC_PATH)
            injectEnv = `import ${scriptPath}\n`
          } else if (workerType === 'ignore') {
            if (this.environment.config.isBundled) {
              injectEnv = ''
            } else {
              // 动态 type 无法预判应使用 import 还是 importScripts，故直接把
              // 服务端变换后的 `/@vite/env` 代码复制到文件头。
              const environment = this.environment
              const moduleGraph =
                environment.mode === 'dev' ? environment.moduleGraph : undefined
              const module = moduleGraph?.getModuleById(ENV_ENTRY)
              injectEnv = module?.transformResult?.code || ''
            }
          }
          if (injectEnv) {
            const s = new MagicString(raw)
            s.prepend(injectEnv + ';\n')
            return {
              code: s.toString(),
              map: s.generateMap({ hires: 'boundary' }),
            }
          }
        }
      },
    },

    ...(isBuild
      ? {
          /** 把 worker 资源占位符改写为最终 URL 或 data URL，并生成必要映射。 */
          renderChunk(code, chunk, outputOptions) {
            let s: MagicString
            /** 惰性创建 worker chunk 的 MagicString 结果，避免无替换时分配映射。 */
            const result = () => {
              return (
                s && {
                  code: s.toString(),
                  map: this.environment.config.build.sourcemap
                    ? s.generateMap({ hires: 'boundary' })
                    : null,
                }
              )
            }
            workerAssetUrlRE.lastIndex = 0
            if (workerAssetUrlRE.test(code)) {
              const toRelativeRuntime =
                createToImportMetaURLBasedRelativeRuntime(
                  outputOptions.format,
                  this.environment.config.isWorker,
                )

              let match: RegExpExecArray | null
              s = new MagicString(code)
              workerAssetUrlRE.lastIndex = 0

              // 按当前输出格式，把 worker 占位符替换成相对路径或运行时表达式。
              const workerOutputCache = workerOutputCaches.get(
                config.mainConfig || config,
              )!

              while ((match = workerAssetUrlRE.exec(code))) {
                const [full, hash] = match
                const filename =
                  workerOutputCache.getEntryFilenameFromHash(hash)
                if (!filename) {
                  this.warn(`Could not find worker asset for hash: ${hash}`)
                  continue
                }
                const replacement = toOutputFilePathInJS(
                  this.environment,
                  filename,
                  'asset',
                  chunk.fileName,
                  'js',
                  toRelativeRuntime,
                )
                const replacementString =
                  typeof replacement === 'string'
                    ? JSON.stringify(encodeURIPath(replacement)).slice(1, -1)
                    : `"+${replacement.runtime}+"`
                s.update(
                  match.index,
                  match.index + full.length,
                  replacementString,
                )
              }
            }
            return result()
          },
        }
      : {}),

    /** 把 worker 子构建资源发射到主 bundle，并检查文件名内容冲突。 */
    generateBundle(opts, bundle) {
      // legacy 与现代构建共享缓存；worker 子构建也会递归经过此钩子，均不可重复发射。
      if (
        this.environment.config.isOutputOptionsForLegacyChunks?.(opts) ||
        isWorker
      ) {
        return
      }
      for (const asset of workerOutputCaches.get(config)!.getAssets()) {
        if (emittedAssets.has(asset.fileName)) continue
        emittedAssets.add(asset.fileName)

        const duplicateAsset = bundle[asset.fileName]
        if (duplicateAsset) {
          const content =
            duplicateAsset.type === 'asset'
              ? duplicateAsset.source
              : duplicateAsset.code
          // 主 bundle 已有同名同内容资源时，复用现有输出即可。
          if (isSameContent(content, asset.source)) {
            continue
          }
        }

        this.emitFile({
          type: 'asset',
          fileName: asset.fileName,
          source: asset.source,
          // fileName 已在 worker 子构建中确定，无需再传 originalFileNames / names。
        })
      }
    },

    /** 源文件变化时标记引用它的 worker bundle 失效。 */
    watchChange(file) {
      if (isWorker) return
      workerOutputCaches
        .get(config)!
        .invalidateAffectedBundles(normalizePath(file))
    },
  }
}

/** 比较字符串或二进制资源的字节内容，用于安全地去重同名输出。 */
function isSameContent(a: string | Uint8Array, b: string | Uint8Array) {
  if (typeof a === 'string') {
    if (typeof b === 'string') {
      return a === b
    }
    return Buffer.from(a).equals(b)
  }
  return Buffer.from(b).equals(a)
}
