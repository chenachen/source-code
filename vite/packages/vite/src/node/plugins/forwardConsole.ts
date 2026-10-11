import path from 'node:path'
import fs from 'node:fs'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import c from 'picocolors'
import type { ForwardConsolePayload } from '#types/customEvent'
import type { DevEnvironment, Plugin } from '..'
import { normalizePath } from '..'
import { extractSourcemapFromFile } from '../server/sourcemap'
import { generateCodeFrame } from '../utils'

/**
 * 接收浏览器/Runner 转发的 console 与未处理错误，并写入对应 Environment 的终端 logger。
 * 错误利用模块图 sourcemap 还原位置，为首个已有转换结果且磁盘文件存在的帧展示 code frame；
 * error/warn 日志走对应 logger，其余级别带原 level 前缀走 info。
 */
export function forwardConsolePlugin(pluginOpts: {
  /** 需要监听 forward-console custom event 的 Environment 名称。 */
  environments: string[]
}): Plugin {
  // 解析外部 map 可能读磁盘，按 id 缓存成功、缺失和失败结果。
  const sourceMapCache = new Map<string, any>()

  return {
    name: 'vite:forward-console',
    apply: 'serve',
    /** 为选定 Environment 注册 vite:forward-console 监听器并写入各自的 logger。 */
    configureServer(server) {
      for (const name of pluginOpts.environments) {
        // 每个 Environment 使用自己的模块图、root 与 logger，不能统一映射后广播。
        const environment = server.environments[name]
        environment.hot.on('vite:forward-console', (payload) => {
          if (
            payload.type === 'error' ||
            payload.type === 'unhandled-rejection'
          ) {
            const output = formatError(payload, environment, sourceMapCache)
            environment.config.logger.error(output, {
              timestamp: true,
            })
          } else {
            const output =
              c.dim(`[console.${payload.data.level}] `) + payload.data.message
            if (payload.data.level === 'error') {
              environment.config.logger.error(output, {
                timestamp: true,
              })
            } else if (payload.data.level === 'warn') {
              environment.config.logger.warn(output, {
                timestamp: true,
              })
            } else {
              environment.config.logger.info(output, {
                timestamp: true,
              })
            }
          }
        })
      }
    },
  }
}

/**
 * 把浏览器 ErrorPayload 的 stack 映射回项目源码，并生成终端友好的错误标题、帧列表与
 * 首个符合模块图/文件条件的 code frame。依赖堆栈仍完整保留，只展开选中的一帧源码。
 */
function formatError(
  payload: Extract<
    ForwardConsolePayload,
    {
      /** 只接受包含可格式化 Error 数据的两类控制台事件。 */
      type: 'error' | 'unhandled-rejection'
    }
  >,
  environment: DevEnvironment,
  sourceMapCache: Map<string, any>,
) {
  const error = payload.data
  const stacks = parseErrorStacktrace(error, {
    /** 把浏览器栈中的 URL 映射回模块图 ID，并兼容 Safari 丢失查询串的情况。 */
    getUrlId(id) {
      const moduleGraph = environment.moduleGraph
      const mod = moduleGraph.getModuleById(id)
      if (mod) {
        return id
      }
      const resolvedPath = normalizePath(
        path.resolve(environment.config.root, id.slice(1)),
      )
      const modUrl = moduleGraph.getModuleById(resolvedPath)
      if (modUrl) {
        return resolvedPath
      }
      // Safari 等浏览器会在 stack 中丢 query；退而求其次，使用该真实文件解析出的第一个模块 id。
      const files = moduleGraph.getModulesByFile(resolvedPath)
      if (files && files.size) {
        return files.values().next().value!.id!
      }
      return id
    },
    /** 读取并缓存模块 sourcemap，优先使用转换结果，必要时从源码尾注提取。 */
    getSourceMap(id) {
      if (sourceMapCache.has(id)) {
        return sourceMapCache.get(id)
      }

      const result = environment.moduleGraph.getModuleById(id)?.transformResult
      // 预构建依赖等可能只在文件尾引用外置 map；transformResult.map 为空时从产物中提取。
      if (result && !result.map) {
        try {
          const filePath = id.split('?')[0]
          const extracted = extractSourcemapFromFile(
            result.code,
            filePath,
            environment.config.logger,
          )
          sourceMapCache.set(id, extracted?.map)
          return extracted?.map
        } catch {
          sourceMapCache.set(id, null)
          return null
        }
      }

      sourceMapCache.set(id, result?.map)
      return result?.map
    },
    // Vitest 默认跳过 internal 文件；Vite 需要展示浏览器给出的完整用户/依赖帧，因此显式清空。
    // https://github.com/vitest-dev/vitest/blob/4783137cd8d766cf998bdf2d638890eaa51e08d9/packages/utils/src/source-map.ts#L17
    ignoreStackEntries: [],
  })

  const nearest = stacks.find((stack) => {
    // 选择第一个同时属于 Vite 模块图、已有 transform 且磁盘存在的帧作为 code frame 来源。
    const modules = environment.moduleGraph.getModulesByFile(stack.file)
    return (
      [...(modules || [])].some((m) => m.transformResult) &&
      fs.existsSync(stack.file)
    )
  })

  let output = ''
  const title =
    payload.type === 'unhandled-rejection'
      ? '[Unhandled rejection]'
      : '[Unhandled error]'
  output += c.red(`${title} ${c.bold(error.name)}: ${error.message}\n`)
  for (const stack of stacks) {
    const file = normalizePath(
      path.relative(environment.config.root, stack.file),
    )
    output += ` > ${[stack.method, `${file}:${stack.line}:${stack.column}`]
      .filter(Boolean)
      .join(' ')}\n`
    if (stack === nearest) {
      // 只给 nearest 帧展开源码，避免长堆栈把关键标题和调用链挤出终端。
      const code = fs.readFileSync(stack.file, 'utf-8')
      output += generateCodeFrame(code, stack).replace(/^/gm, '    ')
      output += '\n'
    }
  }
  return output
}
