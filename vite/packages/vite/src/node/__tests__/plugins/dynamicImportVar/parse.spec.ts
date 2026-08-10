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
  /**
   * 场景：模板动态 import 可含相对层级、alias、普通 query 及 raw/url/worker 特殊资源 query。
   * 验证目标：glob 使用解析后的可枚举 pattern，运行时 rawPattern 仍以 importer 为基准并保留 query。
   * 机制：直接测试 transformDynamicImport 的两份输出，不混入文件枚举或浏览器执行。
   */
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

  /** 场景：动态导入带 url 查询模式；验证目标：解析结果生成默认 URL 导入配置。 */
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

  /** 场景：相对导入含 ../ 并可能匹配当前文件；验证目标：glob 保留父目录范围和 skip-self 语义。 */
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
