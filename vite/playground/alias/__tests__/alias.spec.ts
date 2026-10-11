import { expect, test } from 'vitest'
import { editFile, getColor, isBuild, page } from '~utils'

/** 场景：夹具把模块别名映射到文件绝对路径；读取 .fs，核对导入结果为 [success] alias to fs path。 */
test('fs', async () => {
  expect(await page.textContent('.fs')).toMatch('[success] alias to fs path')
})

/** 场景：夹具把别名映射到目录；读取 .fs-dir，核对目录入口解析后的成功消息。 */
test('fs directory', async () => {
  expect(await page.textContent('.fs-dir')).toMatch(
    '[success] alias to directory',
  )
})

/** 场景：夹具用正则别名映射目录；读取 .regex，核对正则替换后的入口导出成功。 */
test('regex', async () => {
  expect(await page.textContent('.regex')).toMatch(
    '[success] alias to directory via regex',
  )
})

/** 场景：夹具的依赖别名指向 root 外模块；读取 .dep，核对该文件实际执行并显示 out of root。 */
test('dependency', async () => {
  expect(await page.textContent('.dep')).toMatch('[success] out of root')
})

/** 场景：HTML script src 使用别名；读取 .from-script-src，核对别名脚本加载并执行。 */
test('js via script src', async () => {
  expect(await page.textContent('.from-script-src')).toMatch(
    '[success] from script src',
  )
})

/** 场景：HTML link 使用别名样式，初始 body 为灰；开发模式将目标 CSS 改红并轮询颜色，构建模式仅核对初始样式。 */
test('css via link', async () => {
  expect(await getColor('body')).toBe('grey')
  if (isBuild) return
  editFile('dir/test.css', (code) => code.replace('grey', 'red'))
  await expect.poll(() => getColor('body')).toBe('red')
})

/** 场景：别名指向参与依赖优化的包；读取 .optimized，核对优化后仍使用别名对应导出。 */
test('optimized dep', async () => {
  expect(await page.textContent('.optimized')).toMatch(
    '[success] alias optimized',
  )
})

/** 场景：模块引用经过别名重定向；读取 .aliased-module，核对页面拿到 aliased module 消息。 */
test('aliased module', async () => {
  expect(await page.textContent('.aliased-module')).toMatch(
    '[success] aliased module',
  )
})

/** 场景：夹具别名与 URL 路径存在冲突；读取 .url-conflict，核对最终执行别名模块并显示成功消息。 */
test('url conflict alias', async () => {
  expect(await page.textContent('.url-conflict')).toMatch(
    '[success] url conflict alias',
  )
})

/** 场景：别名配置使用 customResolver；读取 .custom-resolver，核对自定义解析结果已加载。 */
test('custom resolver', async () => {
  expect(await page.textContent('.custom-resolver')).toMatch(
    '[success] alias to custom-resolver path',
  )
})
