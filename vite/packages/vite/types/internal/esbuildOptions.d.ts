/* eslint-disable @typescript-eslint/ban-ts-comment */

// esbuild 是可选依赖路径；用户未安装时也不能让 Vite 的主声明解析失败。
// @ts-ignore `esbuild` 可能未安装
import type esbuild from 'esbuild'

/* eslint-enable @typescript-eslint/ban-ts-comment */

/** esbuild 接受的单个或多个运行时目标。 */
export type EsbuildTarget = string | string[]

/** Vite 转换入口接受的 esbuild loader 名称。 */
export type EsbuildLoader = esbuild.Loader
/** Vite 透传给 esbuild 单文件转换的配置。 */
export type EsbuildTransformOptions = esbuild.TransformOptions
/** esbuild 单文件转换返回的代码、map 与告警。 */
export type EsbuildTransformResult = esbuild.TransformResult

/** esbuild 错误或告警的结构化诊断信息。 */
export type EsbuildMessage = esbuild.Message

/**
 * 依赖优化允许透传的 esbuild BuildOptions。
 * bundle、入口、输出位置、watch 与 metafile 由 Vite 优化器掌控，故从用户表面移除。
 */
export type DepsOptimizerEsbuildOptions = Omit<
  esbuild.BuildOptions,
  | 'bundle'
  | 'entryPoints'
  | 'external'
  | 'write'
  | 'watch'
  | 'outdir'
  | 'outfile'
  | 'outbase'
  | 'outExtension'
  | 'metafile'
>
