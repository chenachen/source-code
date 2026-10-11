import { pathToFileURL } from 'node:url'
import { WorkerWithFallback } from 'artichokie'
import type {
  TerserMinifyOptions,
  TerserMinifyOutput,
} from '#types/internal/terserOptions'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '..'
import { _dirname, generateCodeFrame } from '../utils'
import { nodeResolveWithVite } from '../nodeResolve'

/** 扩展 Terser 压缩选项，允许配置持久化 name cache。 */
export interface TerserOptions extends TerserMinifyOptions {
  /**
   * Vite 扩展：Terser 压缩时最多创建多少 worker。
   *
   * @default CPU 数减一
   */
  maxWorkers?: number
}

let terserPath: string | undefined
/** 优先从项目解析可选 terser 依赖，再回退 Vite 安装位置，并缓存结果。 */
function loadTerserPath(root: string) {
  if (terserPath) return terserPath

  // 项目版本优先，使用户可控制 Terser 版本；Vite 位置仅作兼容回退。
  const resolved =
    nodeResolveWithVite('terser', undefined, { root }) ??
    nodeResolveWithVite('terser', _dirname, { root })
  if (resolved) return (terserPath = resolved)

  // Terser 自 Vite 3 起是可选依赖，只在实际选择它时要求安装。
  throw new Error(
    'terser not found. Since Vite v3, terser has become an optional dependency. You need to install it.',
  )
}

/**
 * 以惰性 worker pool 压缩需要 Terser 的 chunk，并把 worker 错误还原为构建错误位置。
 * 含自定义函数时回退主线程；nameCache 也本地执行，使 Terser 修改保留在调用方对象上。
 */
export function terserPlugin(config: ResolvedConfig): Plugin {
  const { maxWorkers, ...terserOptions } = config.build.terserOptions

  /** 创建 Terser worker 调度器，并按任务选项决定线程执行或本地回退。 */
  const makeWorker = () =>
    new WorkerWithFallback(
      () =>
        async (
          terserPath: string,
          code: string,
          options: TerserMinifyOptions,
        ) => {
          const terser: typeof import('terser') = await import(terserPath)
          try {
            return (await terser.minify(code, options)) as TerserMinifyOutput
          } catch (e) {
            // Error 的附加属性不会跨 worker 传回，展开为普通对象并显式保留不可枚举 stack。
            throw { stack: e.stack /* stack 不可枚举，需显式保留 */, ...e }
          }
        },
      {
        /** 自定义函数不可克隆；nameCache 必须共享原对象以保留改名结果，二者都使用本地执行。 */
        shouldUseFake(_terserPath, _code, options) {
          return !!(
            (typeof options.mangle === 'object' &&
              (options.mangle.nth_identifier?.get ||
                (typeof options.mangle.properties === 'object' &&
                  options.mangle.properties.nth_identifier?.get))) ||
            typeof options.format?.comments === 'function' ||
            typeof options.output?.comments === 'function' ||
            options.nameCache
          )
        },
        max: maxWorkers,
      },
    )

  let worker: ReturnType<typeof makeWorker>

  return {
    name: 'vite:terser',

    /** 环境启用任意 minify 时注册插件，renderChunk 再筛选 Terser 或需要回退的 legacy 输出。 */
    applyToEnvironment(environment) {
      // 即使首选压缩器不是 Terser，plugin-legacy 仍可能要求它压缩 legacy chunk。
      return !!environment.config.build.minify
    },

    /** 仅对选择 terser 的 chunk 执行压缩，并通过 worker 复用解析器实例。 */
    async renderChunk(code, chunk, outputOptions) {
      // 插件会随任意非 false minify 加载；普通 chunk 使用首选压缩器，只有无法
      // 与 Oxc 协同的 legacy 输出才在此回退 Terser。
      const usesOxcMinifier =
        (config.build.minify === true || config.build.minify === 'oxc') &&
        outputOptions.minify !== false
      const minifyLegacyWithTerser =
        this.environment.config.isOutputOptionsForLegacyChunks?.(
          outputOptions,
        ) && !usesOxcMinifier
      if (config.build.minify !== 'terser' && !minifyLegacyWithTerser) {
        return null
      }

      // 首个真正需要 Terser 的 chunk 才创建 worker pool 与加载可选依赖。
      worker ||= makeWorker()

      const terserPath = pathToFileURL(loadTerserPath(config.root)).href
      try {
        const res = await worker.run(terserPath, code, {
          safari10: true,
          ...terserOptions,
          format: {
            ...terserOptions.format,
            // ES 库必须保留 pure annotations，供下游打包器继续 tree-shaking。
            preserve_annotations:
              config.build.lib && outputOptions.format === 'es'
                ? true
                : terserOptions.format?.preserve_annotations,
          },
          sourceMap: !!outputOptions.sourcemap,
          module: outputOptions.format.startsWith('es'),
          toplevel: outputOptions.format === 'cjs',
        })
        return {
          code: res.code!,
          map: res.map as any,
        }
      } catch (e) {
        if (e.line !== undefined && e.col !== undefined) {
          e.loc = {
            file: chunk.fileName,
            line: e.line,
            column: e.col,
          }
        }
        if (e.pos !== undefined) {
          e.frame = generateCodeFrame(code, e.pos)
        }
        throw e
      }
    },

    /** 在 bundle 关闭时终止 Terser worker，防止进程残留后台任务。 */
    closeBundle() {
      worker?.stop()
    },
  }
}
