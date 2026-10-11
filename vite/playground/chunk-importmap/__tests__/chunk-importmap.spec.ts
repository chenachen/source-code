import { expect, test } from 'vitest'
import type { OutputAsset, OutputChunk, RolldownOutput } from 'rolldown'
import { build } from 'vite'
import { browserLogs, getColor, isBuild, page, testDir } from '~utils'

/** 场景：import-map 夹具已加载；检查全部浏览器日志没有 404 文本。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

/** 场景：import-map 入口执行；轮询 .js，核对入口显示 js: ok。 */
test('index js', async () => {
  await expect.poll(() => page.textContent('.js')).toBe('js: ok')
})

/** 场景：夹具读取 import map；轮询页面展示文本，核对 /foo 映射到 /bar。 */
test('importmap', async () => {
  await expect
    .poll(() => page.textContent('.importmap'))
    .toContain('"/foo": "/bar"')
})

/** 场景：入口静态导入 chunk；轮询 .static-js，核对 static-js: ok。 */
test('static js', async () => {
  await expect.poll(() => page.textContent('.static-js')).toBe('static-js: ok')
})

/** 场景：入口动态导入 chunk；轮询 .dynamic-js，核对 dynamic-js: ok。 */
test('dynamic js', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-js'))
    .toBe('dynamic-js: ok')
})

/** 场景：静态导入的样式已加载；轮询 .static 的计算颜色为红。 */
test('static css', async () => {
  await expect.poll(() => getColor('.static')).toBe('red')
})

/** 场景：动态 JS chunk 依赖样式；轮询 .dynamic 的计算颜色为红。 */
test('dynamic css', async () => {
  await expect.poll(() => getColor('.dynamic')).toBe('red')
})

/** 场景：入口直接动态导入 CSS；轮询 .direct-dynamic 的颜色为红。 */
test('direct dynamic css', async () => {
  await expect.poll(() => getColor('.direct-dynamic')).toBe('red')
})

/** 场景：多个 chunk 共享纯 CSS 依赖，输出会移除其 JS chunk；核对共享 JS 仍执行并且共享样式为绿，覆盖残留 import-map 引用导致 404 的回归。 */
test('shared pure css chunk', async () => {
  await expect.poll(() => page.textContent('.shared-js')).toBe('shared-js: ok')
  await expect.poll(() => getColor('.shared')).toBe('green')
})

/** 场景：worker 通过 import map 加载并回复消息；轮询页面，核对 worker: pong。 */
test('worker', async () => {
  await expect.poll(() => page.textContent('.worker')).toBe('worker: pong')
})

for (const cssFileName of ['dynamic.css', 'direct-dynamic.css']) {
  /**
   * 场景：循环分别修改 dynamic.css（JS 间接引用）与 direct-dynamic.css（直接导入）的红/蓝内容，各构建一次。
   * 仅 isBuild 执行；核对入口 JS 文件名和代码不变、CSS import-map specifier 稳定，映射目标随 CSS 内容改变。
   * CSS 哈希放在映射目标中，避免仅样式变化让缓存入口指向陈旧 CSS。
   */
  test.runIf(isBuild)(
    `${cssFileName} uses a stable import map specifier`,
    async () => {
      /** 用 pre transform 替换当前循环 CSS 的颜色，返回不写磁盘的构建产物。 */
      const buildWithColor = async (color: string) =>
        (await build({
          root: testDir,
          logLevel: 'silent',
          build: { write: false },
          plugins: [
            {
              name: 'change-dynamic-css',
              enforce: 'pre',
              /** 仅修改当前 CSS 文件内容，制造哈希变化而保持导入结构一致。 */
              transform(code, id) {
                if (id.endsWith(`/${cssFileName}`)) {
                  return code.replace('red', color)
                }
              },
            },
          ],
        })) as RolldownOutput

      /** 提取唯一入口 chunk，用于比较两次构建代码与文件名。 */
      const getIndexChunk = (output: RolldownOutput) =>
        output.output.find(
          (file): file is OutputChunk => file.type === 'chunk' && file.isEntry,
        )!
      /** 解析输出 importmap.json 的 imports 映射。 */
      const getImportMap = (output: RolldownOutput) =>
        JSON.parse(
          output.output
            .find(
              (file): file is OutputAsset => file.fileName === 'importmap.json',
            )!
            .source.toString(),
        ).imports as Record<string, string>
      /** 通过原始 CSS 资产名找到当前循环的输出文件名。 */
      const getCssFileName = (output: RolldownOutput) =>
        output.output.find(
          (file): file is OutputAsset =>
            file.type === 'asset' && file.names.includes(cssFileName),
        )!.fileName

      const redBuild = await buildWithColor('red')
      const blueBuild = await buildWithColor('blue')
      const redIndex = getIndexChunk(redBuild)
      const blueIndex = getIndexChunk(blueBuild)

      // CSS 引用使用稳定 specifier，两次构建的导入者代码和文件名应相同。
      expect(redIndex.fileName).toBe(blueIndex.fileName)
      expect(redIndex.code).toBe(blueIndex.code)

      const redImportMap = getImportMap(redBuild)
      const blueImportMap = getImportMap(blueBuild)
      const cssName = cssFileName.slice(0, -'.css'.length)
      const cssSpecifier = Object.keys(redImportMap).find(
        (specifier) =>
          specifier.includes(`/${cssName}-`) && specifier.endsWith('.css'),
      )!

      // specifier 保持稳定；同一 specifier 的映射目标应随 CSS 内容改变。
      expect(cssSpecifier).toBeDefined()
      expect(redImportMap[cssSpecifier]).toBe(`/${getCssFileName(redBuild)}`)
      expect(blueImportMap[cssSpecifier]).toBe(`/${getCssFileName(blueBuild)}`)
      expect(redImportMap[cssSpecifier]).not.toBe(blueImportMap[cssSpecifier])
    },
  )
}
