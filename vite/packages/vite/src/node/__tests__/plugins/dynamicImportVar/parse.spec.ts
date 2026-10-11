import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transformDynamicImport } from '../../../plugins/dynamicImportVars'
import { normalizePath } from '../../../utils'
import { isWindows } from '../../../../shared/utils'

/** 定位 dynamic import vars 解析夹具，避免依赖运行目录。 */
const dirname = import.meta.dirname

/** 用 `@`/`#` 模拟 alias resolver，并把转换结果拼成运行时 helper 形状供快照观察。 */
async function run(input: string) {
  const { glob, rawPattern } =
    (await transformDynamicImport(
      input,
      normalizePath(resolve(dirname, 'index.js')),
      (id) =>
        id
          .replace('@', resolve(dirname, './mods/'))
          .replace('#', resolve(dirname, '../../')),
      dirname,
    )) || {}
  return `__variableDynamicImportRuntimeHelper(${glob}, \`${rawPattern}\`)`
}

describe('parse positives', () => {
  /** 输入 ./mods/${base}.js 动态模板；转换快照应含相对 glob 与原模板查表键，核对基本变量路径推导。 */
  it('basic', async () => {
    expect(await run('`./mods/${base}.js`')).toMatchSnapshot()
  })

  /** 场景：变量动态导入以 alias 裸路径开头；验证目标：解析器返回可由 resolver 展开的相对 glob 与原查询。 */
  it('alias path', async () => {
    expect(await run('`@/${base}.js`')).toMatchSnapshot()
  })

  /** 场景：alias 解析结果需跨越多级父目录；验证目标：glob 与运行时 pattern 保留正确的 ../ 层级。 */
  it('alias path with multi ../', async () => {
    expect(await run('`#/${base}.js`')).toMatchSnapshot()
  })

  /** 场景：动态导入末尾有普通 query；验证目标：query 从 glob 主体拆出并附回每个匹配导入。 */
  it('with query', async () => {
    expect(await run('`./mods/${base}.js?foo=bar`')).toMatchSnapshot()
  })

  /** 场景：动态导入带 raw 查询模式；验证目标：解析结果选择原始文本导入并保留变量路径。 */
  it('with query raw', async () => {
    expect(await run('`./mods/${base}.js?raw`')).toMatchSnapshot()
  })

  /** ?url 进入 glob query，并指定 import:'*'，使动态导入仍返回含 default URL 的 namespace。 */
  it('with query url', async () => {
    expect(await run('`./mods/${base}.js?url`')).toMatchSnapshot()
  })

  /** 场景：问号属于模板变量而非静态 query；验证目标：解析器不把动态片段错误拆成查询串。 */
  it('? in variables', async () => {
    expect(await run('`./mods/${base ?? foo}.js?raw`')).toMatchSnapshot()
  })

  // Windows 文件名不能含 `?`，该平台的 pattern 不会像 POSIX 那样转义此字符。
  /** 场景：Windows 以外路径的 URL 静态部分含问号；验证目标：解析器按 URL query 边界保留预期 glob。 */
  it.skipIf(isWindows)('? in url', async () => {
    expect(await run('`./mo?ds/${base ?? foo}.js?url`')).toMatchSnapshot()
  })

  // 同上：只在 POSIX 验证路径部分 `?` 与 worker query 的边界。
  /** 场景：worker 查询与变量路径组合；验证目标：worker 标记进入规范化 query，glob 仍定位源模块。 */
  it.skipIf(isWindows)('? in worker', async () => {
    expect(await run('`./mo?ds/${base ?? foo}.js?worker`')).toMatchSnapshot()
  })

  /** 相对导入回到当前夹具目录；快照只检查 pattern 层级，实际排除 importer 由后续 glob 枚举完成。 */
  it('with ../ and itself', async () => {
    expect(await run('`../dynamicImportVar/${name}.js`')).toMatchSnapshot()
  })

  /** 场景：动态导入跨多级 ../ 且覆盖自身；验证目标：生成模式维持完整上溯路径。 */
  it('with multi ../ and itself', async () => {
    expect(
      await run('`../../plugins/dynamicImportVar/${name}.js`'),
    ).toMatchSnapshot()
  })
})
