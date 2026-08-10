import { resolve } from 'node:path'
import { promises as fs } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformGlobImport } from '../../../plugins/importMetaGlob'
import { transformWithOxc } from '../../../plugins/oxc'

describe('fixture', async () => {
  /**
   * 场景：真实 fixture 同时覆盖 eager/lazy、named import、query、base、Object.keys/values 与虚拟模块。
   * 目标：固定完整生成代码、换行稳定性、虚拟模块绝对 pattern 约束和 query 扩展名恢复。
   * 机制：先走 Oxc 得到实际上游代码，再调用 transformGlobImport 做结果快照。
   */
  const resolveId = (id: string) => id
  const root = import.meta.dirname

  /** 场景：fixture 覆盖 eager、lazy、负 pattern 与查询选项；验证目标：转换代码和匹配文件集合符合快照。 */
  it('transform', async () => {
    const id = resolve(import.meta.dirname, './fixture-a/index.ts')
    const code = (await transformWithOxc(await fs.readFile(id, 'utf-8'), id))
      .code

    expect(
      (await transformGlobImport(code, id, root, resolveId))?.s.toString(),
    ).toMatchSnapshot()
  })

  /** 场景：glob 调用跨多行且转换会插入导入；验证目标：输出保持原源码行数，sourcemap 行定位不漂移。 */
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

  /** 场景：importer 与匹配项包含虚拟模块 ID；验证目标：resolver 参与 glob 展开并生成可加载虚拟导入。 */
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
