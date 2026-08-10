import type * as esbuild from 'esbuild'
import { describe, expect, test } from 'vitest'
import { convertEsbuildPluginToRolldownPlugin } from '../../optimizer/pluginConverter'
import type { Plugin } from '../../plugin'

/** 提取转换后测试会直接调用的 options 与 generateBundle 函数形态。 */
type ConvertedPluginHooks = {
  /** 转换器生成的 options 钩子；测试借它初始化兼容构建上下文。 */
  options: Extract<Plugin['options'], Function>
  /** 转换器生成的收尾钩子；测试借它触发 esbuild onEnd 回调。 */
  generateBundle: Extract<Plugin['generateBundle'], Function>
}

describe('convertEsbuildPluginToRolldownPlugin', () => {
  /**
   * 场景：旧 optimizeDeps esbuild 插件在 onEnd 读取 BuildResult。
   * 验证目标：适配器即使不实现真实 metafile/outputFiles，也提供形状兼容对象，而不是传 undefined。
   * 机制：手工调用转换后 options/generateBundle，捕获 callback 参数。
   */
  test('passes a BuildResult to onEnd callbacks', async () => {
    let buildResult: esbuild.BuildResult | undefined

    const plugin = convertEsbuildPluginToRolldownPlugin({
      name: 'read-metafile',
      /** 注册读取 BuildResult 的 esbuild onEnd 回调，捕获适配器传入对象。 */
      setup(build) {
        build.onEnd((result) => {
          buildResult = result
          expect(result.metafile).toBeUndefined()
        })
      },
    }) as ConvertedPluginHooks

    await plugin.options.call({} as any, { plugins: [], platform: 'browser' })
    await plugin.generateBundle.call({} as any, {} as any, {} as any, true)

    expect(buildResult).toEqual({
      outputFiles: undefined,
      metafile: undefined,
      mangleCache: undefined,
    })
  })
})
