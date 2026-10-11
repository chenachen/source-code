import fs from 'node:fs'
import path from 'node:path'
import { ignoreInput } from '@voidzero-dev/vite-task-client'
import colors from 'picocolors'
import type { Plugin } from '../plugin'
import { getResolvedOutDirs, resolveEmptyOutDir } from '../watch'
import type { Environment } from '../environment'
import { copyDir, emptyDir, normalizePath } from '../utils'
import { withTrailingSlash } from '../../shared/utils'

/**
 * 在每个 Environment 首次 write=true 的 renderStart 中清理输出目录并复制 publicDir。
 * watchChange 会解除本轮标记，使下一次 watch 重建重新执行清理策略。
 */
export function prepareOutDirPlugin(): Plugin {
  const rendered = new Set<Environment>()
  return {
    name: 'vite:prepare-out-dir',
    /** 文件变化时撤销本环境已准备标记，使下一次写盘构建的 renderStart 重新准备目录。 */
    watchChange() {
      rendered.delete(this.environment)
    },
    renderStart: {
      order: 'pre',
      /** 首次输出前清理 outDir，并按 emptyOutDir 与 copyPublicDir 配置保留或复制内容。 */
      handler() {
        if (rendered.has(this.environment)) {
          return
        }

        const { config } = this.environment
        if (config.build.write) {
          rendered.add(this.environment)
          const { root, build: options } = config
          const resolvedOutDirs = getResolvedOutDirs(
            root,
            options.outDir,
            options.rolldownOptions.output,
          )
          const emptyOutDir = resolveEmptyOutDir(
            options.emptyOutDir,
            root,
            resolvedOutDirs,
            this.environment.logger,
          )
          prepareOutDir(resolvedOutDirs, emptyOutDir, this.environment)
        }
      },
    },
  }
}

/** 同时处理多个 output dir，清空父目录时保留其内部的其他输出目录与 `.git`。 */
function prepareOutDir(
  outDirs: Set<string>,
  emptyOutDir: boolean | null,
  environment: Environment,
) {
  const { publicDir } = environment.config
  const outDirsArray = [...outDirs]
  for (const outDir of outDirs) {
    // Vite Task 会追踪文件读取；emptyDir 枚举 outDir 不应被视作构建输入，否则随后
    // 写同一目录会触发读写重叠检查。先用 ignoreInput 排除该读取。
    ignoreInput(outDir)
    if (emptyOutDir !== false && fs.existsSync(outDir)) {
      // 清空父 outDir 时保留嵌套的其他 output dir，避免多 output 互相删除。
      const skipDirs = outDirsArray
        .map((dir) => {
          const relative = path.relative(outDir, dir)
          if (
            relative &&
            !relative.startsWith('..') &&
            !path.isAbsolute(relative)
          ) {
            return relative
          }
          return ''
        })
        .filter(Boolean)
      emptyDir(outDir, [...skipDirs, '.git'])
    }
    if (
      environment.config.build.copyPublicDir &&
      publicDir &&
      fs.existsSync(publicDir)
    ) {
      if (!areSeparateFolders(outDir, publicDir)) {
        environment.logger.warn(
          colors.yellow(
            `\n${colors.bold(
              `(!)`,
            )} The public directory feature may not work correctly. outDir ${colors.white(
              colors.dim(outDir),
            )} and publicDir ${colors.white(
              colors.dim(publicDir),
            )} are not separate folders.\n`,
          ),
        )
      }
      copyDir(publicDir, outDir)
    }
  }
}

/** 判断两个目录既不相同，也不存在任一方包含另一方。 */
function areSeparateFolders(a: string, b: string) {
  const na = normalizePath(a)
  const nb = normalizePath(b)
  return (
    na !== nb &&
    !na.startsWith(withTrailingSlash(nb)) &&
    !nb.startsWith(withTrailingSlash(na))
  )
}
