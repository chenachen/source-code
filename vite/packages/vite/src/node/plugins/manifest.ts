import path from 'node:path'
import type { OutputChunk, RenderedChunk } from 'rolldown'
import { viteManifestPlugin as nativeManifestPlugin } from 'rolldown/experimental'
import type { Plugin } from '../plugin'
import { normalizePath } from '../utils'
import { perEnvironmentState } from '../environment'
import { type Environment, perEnvironmentPlugin } from '..'
import { cssEntriesMap } from './asset'

/** 判断产物文件是否为 JavaScript，以筛选清单中的入口和动态入口。 */
const endsWithJSRE = /\.[cm]?js$/

/** 把源文件键映射到构建产物及其依赖信息。 */
export type Manifest = Record<string, ManifestChunk>

/** 描述清单中单个源模块对应的文件、CSS、资源和依赖关系。 */
export interface ManifestChunk {
  /** 已知时记录 chunk/asset 的输入文件名。 */
  src?: string
  /** chunk/asset 的输出文件名。 */
  file: string
  /** 该 chunk 导入的 CSS 文件。 */
  css?: string[]
  /** 该 chunk 导入的非 CSS 资产文件。 */
  assets?: string[]
  /** 该 chunk/asset 是否为入口。 */
  isEntry?: boolean
  /** 已知时记录 chunk/asset 的逻辑名称。 */
  name?: string
  // names 字段已从类型删除，但原生插件仍为兼容旧消费者输出。
  /**
   * 是否为动态入口；仅 JS chunk 存在。
   */
  isDynamicEntry?: boolean
  /**
   * 该 chunk 静态导入的 chunk；值为 manifest key，仅 JS chunk 存在。
   */
  imports?: string[]
  /**
   * 该 chunk 动态导入的 chunk；值为 manifest key，仅 JS chunk 存在。
   */
  dynamicImports?: string[]
}

/**
 * 在启用 build.manifest 的 Environment 中生成 manifest，并用 Vite metadata
 * 补入 CSS/asset 引用。多个 output 会先分别生成，再按 Environment 状态合并成一个文件。
 */
export function manifestPlugin(): Plugin {
  const getState = perEnvironmentState(() => {
    return {
      manifest: {} as Manifest,
      outputCount: 0,
      /** 清空当前环境的清单与 CSS 入口状态，保证监听重构建不混入旧产物。 */
      reset() {
        this.manifest = {}
        this.outputCount = 0
      },
    }
  })

  return perEnvironmentPlugin('native:manifest', (environment) => {
    if (!environment.config.build.manifest) return false

    const root = environment.config.root
    const outPath =
      environment.config.build.manifest === true
        ? '.vite/manifest.json'
        : environment.config.build.manifest

    const envs: Record<string, Environment> = {}
    /** 优先使用 facade 模块 ID 作为清单键，否则回退 chunk 名称。 */
    function getChunkName(chunk: OutputChunk) {
      return (
        getChunkOriginalFileName(chunk, root, false) ??
        `_${path.basename(chunk.fileName)}`
      )
    }

    return [
      {
        name: 'native:manifest-envs',
        /** 捕获当前构建环境并重置清单状态。 */
        buildStart() {
          envs[environment.name] = this.environment
        },
      },
      nativeManifestPlugin({
        root,
        outPath,
        isOutputOptionsForLegacyChunks:
          environment.config.isOutputOptionsForLegacyChunks,
        /** 把已登记 CSS 入口引用转换为最终文件名集合。 */
        cssEntries() {
          return Object.fromEntries(
            [...cssEntriesMap.get(envs[environment.name])!.values()].map(
              ({ name, referenceId }) => {
                return [referenceId, name]
              },
            ),
          )
        },
      }),
      {
        name: 'native:manifest-compatible',
        /** 遍历 chunk 与资源构造清单；多环境输出时合并后只发射一次最终文件。 */
        generateBundle(_, bundle) {
          const asset = bundle[outPath]
          if (asset.type === 'asset') {
            let manifest: Manifest | undefined
            for (const output of Object.values(bundle)) {
              const importedCss = output.viteMetadata?.importedCss
              const importedAssets = output.viteMetadata?.importedAssets
              if (!importedCss?.size && !importedAssets?.size) continue
              manifest ??= JSON.parse(asset.source.toString()) as Manifest
              if (output.type === 'chunk') {
                const item = manifest[getChunkName(output)]
                if (!item) continue
                if (importedCss?.size) {
                  item.css = [...importedCss]
                }
                if (importedAssets?.size) {
                  item.assets = [...importedAssets]
                }
              } else if (output.type === 'asset' && output.names.length > 0) {
                // 资产按每个唯一 originalFileName 登记，保留多个源文件去重到同一输出的映射。
                const keys =
                  output.originalFileNames.length > 0
                    ? output.originalFileNames
                    : [`_${path.basename(output.fileName)}`]

                for (const key of keys) {
                  const item = manifest[key]
                  if (!item) continue
                  if (!(item.file && endsWithJSRE.test(item.file))) {
                    if (importedCss?.size) {
                      item.css = [...importedCss]
                    }
                    if (importedAssets?.size) {
                      item.assets = [...importedAssets]
                    }
                  }
                }
              }
            }
            const output = this.environment.config.build.rolldownOptions.output
            const outputLength = Array.isArray(output) ? output.length : 1
            if (manifest && outputLength === 1) {
              asset.source = JSON.stringify(manifest, undefined, 2)
              return
            }

            const state = getState(this)
            state.outputCount++
            state.manifest = Object.assign(
              state.manifest,
              manifest ?? JSON.parse(asset.source.toString()),
            )
            if (state.outputCount >= outputLength) {
              asset.source = JSON.stringify(state.manifest, undefined, 2)
              state.reset()
            } else {
              delete bundle[outPath]
            }
          }
        },
      },
    ]
  })
}

/**
 * 用 facadeModuleId 生成相对 root 的 manifest key；legacy 输出在扩展名前加后缀，
 * 并移除虚拟模块 null byte，确保 key 可序列化。
 */
export function getChunkOriginalFileName(
  chunk: OutputChunk | RenderedChunk,
  root: string,
  isLegacy: boolean,
): string | undefined {
  if (chunk.facadeModuleId) {
    let name = normalizePath(path.relative(root, chunk.facadeModuleId))
    if (isLegacy && !chunk.name.includes('-legacy')) {
      const ext = path.extname(name)
      const endPos = ext.length !== 0 ? -ext.length : undefined
      name = `${name.slice(0, endPos)}-legacy${ext}`
    }
    return name.replace(/\0/g, '')
  }
}
