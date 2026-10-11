import { expect, test } from 'vitest'
import { getColor, page } from '~utils'

/** 场景：TS导入者通过tsconfig paths别名加载目标；轮询.ts，核对执行成功消息。 */
test('import from .ts', async () => {
  await expect.poll(() => page.textContent('.ts')).toMatch('[success]')
})

/** 场景：JS导入者使用同一路径配置；轮询.js，核对执行成功。 */
test('import from .js', async () => {
  await expect.poll(() => page.textContent('.js')).toMatch('[success]')
})

/** 场景：#前缀路径由tsconfig paths处理；轮询.hash，核对导入成功。 */
test('import using # prefixed path', async () => {
  await expect.poll(() => page.textContent('.hash')).toMatch('[success]')
})

/** 场景：第一路径候选未命中时尝试后续映射；轮询.fallback，核对目标加载成功。 */
test('fallback works', async () => {
  await expect.poll(() => page.textContent('.fallback')).toMatch('[success]')
})

/** 场景：嵌套tsconfig及references/include提供两个解析作用域；轮询nested-a/b，核对两者都加载成功。 */
test('nested tsconfig.json & references / include works', async () => {
  await expect.poll(() => page.textContent('.nested-a')).toMatch('[success]')
  await expect.poll(() => page.textContent('.nested-b')).toMatch('[success]')
})

/** 场景：eager glob使用tsconfig paths模式；轮询.glob-eager，核对glob-a与glob-b两导出消息。 */
test('import.meta.glob resolves tsconfig paths', async () => {
  await expect
    .poll(() => page.textContent('.glob-eager'))
    .toBe('[success] glob-a [success] glob-b')
})

/** 场景：CSS @import使用路径别名；轮询目标颜色为darkcyan。 */
test('css @import resolves tsconfig paths', async () => {
  await expect.poll(() => getColor('.tsconfig-paths-css')).toBe('darkcyan')
})

/** 场景：Sass @use使用路径别名；轮询目标颜色为seagreen。 */
test('sass @use resolves tsconfig paths', async () => {
  await expect.poll(() => getColor('.tsconfig-paths-scss')).toBe('seagreen')
})

/** 场景：Less不支持resolve.tsconfigPaths，optional别名@import被忽略；轮询颜色仍为navy，而不宣称别名解析成功。 */
test('less @import does not resolve tsconfig paths (unsupported)', async () => {
  await expect.poll(() => getColor('.tsconfig-paths-less')).toBe('navy')
})
