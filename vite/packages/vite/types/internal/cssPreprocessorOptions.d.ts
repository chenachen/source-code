/* eslint-disable @typescript-eslint/ban-ts-comment */

// 预处理器均为可选 peer dependency；即使用户未安装，也要能发布 Vite 主类型入口。
// @ts-ignore `sass` 可能未安装
import type DartSass from 'sass'
// @ts-ignore `sass-embedded` 可能未安装
import type SassEmbedded from 'sass-embedded'
// @ts-ignore `less` 可能未安装
import type Less from 'less'
// @ts-ignore `stylus` 可能未安装
import type Stylus from 'stylus'

/* eslint-enable @typescript-eslint/ban-ts-comment */

// 检测可选包缺失后退化出的 any，避免优先采用一个不存在实现的类型（见
// 证据：https://github.com/type-challenges/type-challenges/issues/29285
/** 判断类型是否退化为 `any`，用于检测未安装可选预处理器时的忽略导入结果。 */
type IsAny<T> = boolean extends (T extends never ? true : false) ? true : false

/** Dart Sass 异步字符串编译入口接受的配置。 */
type DartSassStringOptionsAsync = DartSass.StringOptions<'async'>
/** Sass Embedded 异步字符串编译入口接受的配置。 */
type SassEmbeddedStringOptionsAsync = SassEmbedded.StringOptions<'async'>
/** 优先采用 Sass Embedded 配置；其可选依赖缺失并退化为 any 时回退到 Dart Sass。 */
type SassStringOptionsAsync =
  IsAny<SassEmbeddedStringOptionsAsync> extends false
    ? SassEmbeddedStringOptionsAsync
    : DartSassStringOptionsAsync

/** 去掉由 Vite 管理的输入 URL 与 sourcemap 后，允许用户配置的现代 Sass 选项。 */
export type SassModernPreprocessBaseOptions = Omit<
  SassStringOptionsAsync,
  'url' | 'sourceMap'
>

/** 去掉 Vite 负责的文件名与 sourcemap 后的 Less 选项。 */
export type LessPreprocessorBaseOptions = Omit<
  Less.Options,
  'sourceMap' | 'filename'
>

/** 去掉 Vite 负责的 filename，并补充 Stylus define 的公开形态。 */
export type StylusPreprocessorBaseOptions = Omit<
  Stylus.RenderOptions,
  'filename'
> & {
  /** 注入给 Stylus 的变量、函数或表达式定义。 */
  define?: Record<string, any>
}

declare global {
  // Less 类型间接引用浏览器 HTMLLinkElement；Vite 的 Node 类型环境需提供空壳兼容。
  /** DOM 库缺席时满足 Less 声明依赖的可合并空壳。 */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface HTMLLinkElement {}
}
