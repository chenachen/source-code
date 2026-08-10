import fsp from 'node:fs/promises'
import colors from 'picocolors'
import type { DevEnvironment } from '..'
import type { Plugin } from '../plugin'
import {
  DEP_VERSION_RE,
  ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR,
  ERR_OPTIMIZE_DEPS_PROCESSING_ERROR,
} from '../constants'
import { createDebugger } from '../utils'
import {
  isDepOptimizationDisabled,
  optimizedDepInfoFromFile,
} from '../optimizer'
import { cleanUrl } from '../../shared/utils'
import { ERR_OUTDATED_OPTIMIZED_DEP } from '../../shared/constants'

/** 优化产物文件读取日志。 */
const debug = createDebugger('vite:optimize-deps')

/**
 * 优化产物的 resolve/load 边界：验证 browserHash，等待入口所属 processing 批次提交，再直接从
 * cache 读 code/map；把过期、处理失败和真实缺文件映射为不同错误码供 HTTP 中间件处理。
 */
export function optimizedDepsPlugin(): Plugin {
  return {
    name: 'vite:optimized-deps',

    /** 仅在依赖优化器启用的环境注册预构建依赖加载插件。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        return false
      }
      return !isDepOptimizationDisabled(environment.config.optimizeDeps)
    },

    /** 识别已优化依赖或其缺失占位 ID，并阻止其他解析器改写。 */
    resolveId(id) {
      const environment = this.environment as DevEnvironment
      if (environment.depsOptimizer?.isOptimizedDepFile(id)) {
        return id
      }
    },

    // PluginContainer 不支持 `this.load({id})` 形式；Import Analysis/depInfo.processing 负责登记并
    // 等待尚未落盘的入口。

    /** 读取优化依赖文件，校验浏览器哈希，并在过期时触发重新请求。 */
    async load(id) {
      const environment = this.environment as DevEnvironment
      const depsOptimizer = environment.depsOptimizer
      if (depsOptimizer?.isOptimizedDepFile(id)) {
        const metadata = depsOptimizer.metadata
        const file = cleanUrl(id)
        const versionMatch = DEP_VERSION_RE.exec(id)
        const browserHash = versionMatch
          ? versionMatch[1].split('=')[1]
          : undefined

        // 同时查询已提交入口、待处理 discovered 与内部 chunk。
        const info = optimizedDepInfoFromFile(metadata, file)
        if (info) {
          if (
            browserHash &&
            info.browserHash !== browserHash &&
            !environment.config.optimizeDeps.ignoreOutdatedRequests
          ) {
            throwOutdatedRequest(id)
          }
          try {
            // discovered 入口的最终路径已知，但文件可能尚未打包/提交。
            await info.processing
          } catch {
            // processing 异常表示预期 reload/重跑未正常完成，转成 504 终止旧请求。
            throwProcessingError(id)
          }
          const newMetadata = depsOptimizer.metadata
          if (metadata !== newMetadata) {
            const currentInfo = optimizedDepInfoFromFile(newMetadata!, file)
            if (
              info.browserHash !== currentInfo?.browserHash &&
              !environment.config.optimizeDeps.ignoreOutdatedRequests
            ) {
              throwOutdatedRequest(id)
            }
          }
        }
        debug?.(`load ${colors.cyan(file)}`)
        // processing resolve 后文件已原子提交，直接读 cache 而不再经过其他 load hooks，避免插件
        // 与换代目录的竞态；map 缺失不影响代码响应。
        try {
          const [code, map] = await Promise.all([
            fsp.readFile(file, 'utf-8'),
            fsp
              .readFile(`${file}.map`, 'utf-8')
              .then((map) => JSON.parse(map))
              .catch(() => null),
          ])
          if (map) {
            return {
              code,
              map,
            }
          }
          return code
        } catch {
          if (
            browserHash &&
            !environment.config.optimizeDeps.ignoreOutdatedRequests
          ) {
            // 重跑后旧 browserHash 文件消失属于正常换代，交给页面 reload。
            throwOutdatedRequest(id)
          }
          throwFileNotFoundInOptimizedDep(id)
        }
      }
    },
  }
}

/** 抛优化处理异常，transform middleware 映射为 504。 */
function throwProcessingError(id: string): never {
  const err: any = new Error(
    `Something unexpected happened while optimizing "${id}". ` +
      `The current page should have reloaded by now`,
  )
  err.code = ERR_OPTIMIZE_DEPS_PROCESSING_ERROR
  // transform middleware 捕获并返回 504 request timeout。
  throw err
}

/** 抛旧版本请求，transform middleware 返回 504，浏览器 reload 后会请求新 hash。 */
export function throwOutdatedRequest(id: string): never {
  const err: any = new Error(
    `There is a new version of the pre-bundle for "${id}", ` +
      `a page reload is going to ask for it.`,
  )
  err.code = ERR_OUTDATED_OPTIMIZED_DEP
  // transform middleware 捕获并返回 504 request timeout。
  throw err
}

/** 抛优化目录内真实缺文件，transform middleware 返回 404 并提示 exclude。 */
export function throwFileNotFoundInOptimizedDep(id: string): never {
  const err: any = new Error(
    `The file does not exist at "${id}" which is in the optimize deps directory. ` +
      `The dependency might be incompatible with the dep optimizer. ` +
      `Try adding it to \`optimizeDeps.exclude\`.`,
  )
  err.code = ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR
  // transform middleware 捕获并返回 404 not found。
  throw err
}
