import { resolve } from 'node:path'
import { promises as fs } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformGlobImport } from '../../../plugins/importMetaGlob'
import { transformWithOxc } from '../../../plugins/oxc'

describe('fixture', async () => {
  /** 此 fixture 不模拟 alias；resolver 原样返回 ID，让真实磁盘 pattern 决定枚举结果。 */
  const resolveId = (id: string) => id
  const root = import.meta.dirname

  /** fixture 覆盖 eager、lazy、负 pattern 与查询选项；快照核对完整生成代码中的路径和 import 形态。 */
  it('transform', async () => {
    const id = resolve(import.meta.dirname, './fixture-a/index.ts')
    const code = (await transformWithOxc(await fs.readFile(id, 'utf-8'), id))
      .code

    expect(
      (await transformGlobImport(code, id, root, resolveId))?.s.toString(),
    ).toMatchSnapshot()
  })

  /** 比较单行与三行 glob 调用的输出行数；展开时补回原调用换行，后续代码的行位置保持不变。 */
  it('preserve line count', async () => {
    /** 转换给定 glob 源码并返回输出行数，直接检查 sourcemap 行定位前提。 */
    const getTransformedLineCount = async (code: string) =>
      (await transformGlobImport(code, 'virtual:module', root, resolveId))?.s
        .toString()
        .split('\n').length

    expect(await getTransformedLineCount("import.meta.glob('/*.js')")).toBe(1)
    expect(
      await getTransformedLineCount(
        `
          import.meta.glob(
            '/*.js'
          )
        `.trim(),
      ),
    ).toBe(3)
  })

  /** 虚拟 importer 没有磁盘目录；root pattern 或显式 base 可枚举真实文件，相对 pattern 无 base 时拒绝。 */
  it('virtual modules', async () => {
    const root = resolve(import.meta.dirname, './fixture-a')
    const code = [
      "import.meta.glob('/modules/*.ts')",
      "import.meta.glob(['/../fixture-b/*.ts'])",
      "import.meta.glob(['./*.ts'], { base: '/modules' })",
    ].join('\n')
    expect(
      (
        await transformGlobImport(code, 'virtual:module', root, resolveId)
      )?.s.toString(),
    ).toMatchSnapshot()

    try {
      await transformGlobImport(
        "import.meta.glob('./modules/*.ts')",
        'virtual:module',
        root,
        resolveId,
      )
      expect('no error').toBe('should throw an error')
    } catch (err) {
      expect(err).toMatchInlineSnapshot(
        "[Error: In virtual modules, all globs must start with '/']",
      )
    }

    // 回归 #22345：虚拟模块使用相对 glob 时，即使零文件命中也必须报错，不能静默返回 `{}`。
    await expect(async () => {
      await transformGlobImport(
        "import.meta.glob('./no-such-dir/*.ts')",
        'virtual:module',
        root,
        resolveId,
      )
    }).rejects.toMatchInlineSnapshot(
      `[Error: In virtual modules, all globs must start with '/']`,
    )
  })

  /** 场景：restoreQueryExtension 开启且 glob 查询会改变扩展名；验证目标：生成导入恢复原扩展名供后续插件识别。 */
  it('transform with restoreQueryExtension', async () => {
    const id = resolve(import.meta.dirname, './fixture-a/index.ts')
    const code = (await transformWithOxc(await fs.readFile(id, 'utf-8'), id))
      .code

    expect(
      (
        await transformGlobImport(code, id, root, resolveId, true)
      )?.s.toString(),
    ).toMatchSnapshot()
  })
})
