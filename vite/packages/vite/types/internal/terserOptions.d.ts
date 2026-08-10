/* eslint-disable @typescript-eslint/ban-ts-comment */

// terser 是可选压缩器；通过忽略缺包诊断让未使用 terser 的项目仍能加载 Vite 类型。
// @ts-ignore `terser` 可能未安装
export type * as Terser from 'terser'
// @ts-ignore `terser` 可能未安装
import type * as Terser from 'terser'

/* eslint-enable @typescript-eslint/ban-ts-comment */

/** Vite 对外透传的 Terser 压缩输入与输出类型。 */
export type TerserMinifyOptions = Terser.MinifyOptions
/** Terser 压缩返回的代码、map 及附加结果。 */
export type TerserMinifyOutput = Terser.MinifyOutput
