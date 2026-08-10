import MagicString from 'magic-string'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import { createFilter } from '../utils'
import { cleanUrl } from '../../shared/utils'

/**
 * 兼容历史公开的 `esbuild.banner/footer` 选项。
 *
 * banner/footer 本应由 transform 插件实现；Rolldown 构建不再天然消费这两个
 * esbuild 字段，因此临时在这里拼接，并在需要时生成 sourcemap。
 */
export function esbuildBannerFooterCompatPlugin(
  config: ResolvedConfig,
): Plugin | undefined {
  const options = config.esbuild
  if (!options) return

  const { include, exclude, banner, footer } = options
  if (!banner && !footer) return

  const filter = createFilter(include || /\.(m?ts|[jt]sx)$/, exclude || /\.js$/)

  return {
    name: 'vite:esbuild-banner-footer-compat',
    /** 为匹配模块补入 esbuild banner/footer；需要映射时通过 MagicString 保留源码位置。 */
    transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        const needsSourcemap =
          this.environment.mode === 'dev' ||
          (this.environment.mode === 'build' &&
            this.environment.config.build.sourcemap)
        if (!needsSourcemap) {
          if (banner) {
            code = `${banner}\n${code}`
          }
          if (footer) {
            code = `${code}\n${footer}`
          }
          return code
        }

        let s: MagicString | undefined
        /** 惰性创建 MagicString，仅在首次需要改写源码时分配映射状态。 */
        const str = () => s || (s = new MagicString(code))

        if (banner) {
          str().prepend(`${banner}\n`)
        }
        if (footer) {
          str().append(`${footer}\n`)
        }

        if (s) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: 'boundary' }),
          }
        }
      }
    },
  }
}
