/* eslint-disable @typescript-eslint/ban-ts-comment */

// lightningcss 是可选依赖，类型入口必须允许它缺席。
// @ts-ignore `lightningcss` 可能未安装
import type Lightningcss from 'lightningcss'

/* eslint-enable @typescript-eslint/ban-ts-comment */

/**
 * Vite 允许用户传给 Lightning CSS 的配置子集。
 * 文件名、解析器、压缩、sourcemap 与依赖分析由 Vite 流水线负责，不能由用户覆盖。
 */
export type LightningCSSOptions = Omit<
  Lightningcss.BundleAsyncOptions<Lightningcss.CustomAtRules>,
  | 'filename'
  | 'resolver'
  | 'minify'
  | 'sourceMap'
  | 'analyzeDependencies'
  // 虽未由 Vite 直接覆盖，但对单文件/项目级调用边界无合理用户语义。
  | 'inputSourceMap'
  | 'projectRoot'
>
