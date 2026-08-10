import { describe, expect, test } from 'vitest'
import { parseAst } from 'rollup/parseAst'
import { assetImportMetaUrlPlugin } from '../../plugins/assetImportMetaUrl'
import { resolveConfig } from '../../config'
import { PartialEnvironment } from '../../baseEnvironment'

/** 创建最小开发环境，只观察 assetImportMetaUrl 插件生成的代码。 */
async function createAssetImportMetaurlPluginTransform() {
  const config = await resolveConfig({ configFile: false }, 'serve')
  const instance = assetImportMetaUrlPlugin(config)
  const environment = new PartialEnvironment('client', config)

  return async (code: string) => {
  // @ts-expect-error transform.handler should exist
    const result = await instance.transform.handler.call(
      { environment, parse: parseAst },
      code,
      'foo.ts',
    )
    return result?.code || result
  }
}

describe('assetImportMetaUrlPlugin', async () => {
  const transform = await createAssetImportMetaurlPluginTransform()

  /**
   * 场景：模板 URL 中含一个或多个动态片段。
   * 机制：静态前后缀折叠为 glob，连续变量共用一个 `*`，运行时仍以原模板取值。
   * 验证目标：只打包可能命中的资产，又不改变模板字符串的选择语义。
   */
  test('variable between /', async () => {
    expect(
      await transform('new URL(`./foo/${dir}/index.js`, import.meta.url)'),
    ).toMatchInlineSnapshot(
      `"new URL((import.meta.glob("./foo/*/index.js", {"eager":true,"import":"default","query":"?url"}))[\`./foo/\${dir}/index.js\`], import.meta.url)"`,
    )
  })

  /** 场景：模板变量后紧跟非斜杠字符；验证目标：glob 推导保留该静态后缀并生成对应查表键。 */
  test('variable before non-/', async () => {
    expect(
      await transform('new URL(`./foo/${dir}.js`, import.meta.url)'),
    ).toMatchInlineSnapshot(
      `"new URL((import.meta.glob("./foo/*.js", {"eager":true,"import":"default","query":"?url"}))[\`./foo/\${dir}.js\`], import.meta.url)"`,
    )
  })

  /** 场景：同一 URL 模板包含两个变量段；验证目标：两个动态段分别展开为 glob 通配符。 */
  test('two variables', async () => {
    expect(
      await transform('new URL(`./foo/${dir}${file}.js`, import.meta.url)'),
    ).toMatchInlineSnapshot(
      `"new URL((import.meta.glob("./foo/*.js", {"eager":true,"import":"default","query":"?url"}))[\`./foo/\${dir}\${file}.js\`], import.meta.url)"`,
    )
  })

  /** 场景：两个变量位于不同斜杠分段之间；验证目标：glob 保持目录边界并覆盖两个动态段。 */
  test('two variables between /', async () => {
    expect(
      await transform(
        'new URL(`./foo/${dir}${dir2}/index.js`, import.meta.url)',
      ),
    ).toMatchInlineSnapshot(
      `"new URL((import.meta.glob("./foo/*/index.js", {"eager":true,"import":"default","query":"?url"}))[\`./foo/\${dir}\${dir2}/index.js\`], import.meta.url)"`,
    )
  })

  /**
   * 场景：模板从变量开始，无法推导相对当前模块的搜索根。
   * 验证目标：保持原表达式，不生成可能遍历任意目录的 import.meta.glob。
   */
  test('ignore starting with a variable', async () => {
    expect(
      await transform('new URL(`${file}.js`, import.meta.url)'),
    ).toMatchInlineSnapshot(`"new URL(\`\${file}.js\`, import.meta.url)"`)
  })
})
