import { describe, expect, test } from 'vitest'
import { port } from './serve'
import { editFile, getColor, isServe, page } from '~utils'

/** custom serve创建的SSR应用访问地址。 */
const url = `http://localhost:${port}`

/**
 * 加密依赖回归：#5809。
 */
/** 场景：访问SSR页面读取加密结果，核对不包含原Secret Message文本；此断言不检查具体密文格式（#5809）。 */
test('msg should be encrypted', async () => {
  await page.goto(url)
  expect(await page.textContent('.encrypted-msg')).not.toMatch(
    'Secret Message!',
  )
})

/** 场景：访问SSR页面，fs/promises读取fixture文件；核对.file-message含File Content!。 */
test('msg read by fs/promises', async () => {
  await page.goto(url)
  expect(await page.textContent('.file-message')).toMatch('File Content!')
})

/** 场景：访问SSR页面，CJS模块导出primitive；核对页面得到Hello World!。 */
test('msg from primitive export', async () => {
  await page.goto(url)
  expect(await page.textContent('.primitive-export-message')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，TS转译形式的default/named导出均被消费；核对两结果Hello World!。 */
test('msg from TS transpiled exports', async () => {
  await page.goto(url)
  expect(await page.textContent('.ts-default-export-message')).toMatch(
    'Hello World!',
  )
  expect(await page.textContent('.ts-named-export-message')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，CJS Object.assign组合导出被消费；核对Hello World!。 */
test('msg from Object.assign exports', async () => {
  await page.goto(url)
  expect(await page.textContent('.object-assigned-exports-message')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，依赖转发其他模块导出；核对forwarded结果Hello World!。 */
test('msg from forwarded exports', async () => {
  await page.goto(url)
  expect(await page.textContent('.forwarded-export-message')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，Object.defineProperties定义导出；核对结果Hello World!。 */
test('msg from define properties exports', async () => {
  await page.goto(url)
  expect(await page.textContent('.define-properties-exports-msg')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，Object.defineProperty定义单个导出；核对结果Hello World!。 */
test('msg from define property exports', async () => {
  await page.goto(url)
  expect(await page.textContent('.define-property-exports-msg')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，模块仅通过Object.assign写导出；核对结果Hello World!。 */
test('msg from only object assigned exports', async () => {
  await page.goto(url)
  expect(await page.textContent('.only-object-assigned-exports-msg')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，noExternal内联CommonJS包；核对结果Hello World!。 */
test('msg from no external cjs', async () => {
  await page.goto(url)
  expect(await page.textContent('.no-external-cjs-msg')).toMatch('Hello World!')
})

/** 场景：访问SSR页面，优化包内部再引用external依赖；核对嵌套结果Hello World!。 */
test('msg from optimized with nested external', async () => {
  await page.goto(url)
  expect(await page.textContent('.optimized-with-nested-external')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，优化CommonJS包内部再引用external依赖；核对结果Hello World!。 */
test('msg from optimized cjs with nested external', async () => {
  await page.goto(url)
  expect(await page.textContent('.optimized-cjs-with-nested-external')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，external包使用另一个external入口；核对结果Hello World!。 */
test('msg from external using external entry', async () => {
  await page.goto(url)
  expect(await page.textContent('.external-using-external-entry')).toMatch(
    'Hello World!',
  )
})

/** 场景：访问SSR页面，链接包noExternal转换；核对Hello World from当前NODE_ENV，检查环境替换结果。 */
test('msg from linked no external', async () => {
  await page.goto(url)
  expect(await page.textContent('.linked-no-external')).toMatch(
    `Hello World from ${process.env.NODE_ENV}!`,
  )
})

/** 场景：访问SSR页面，依赖插件提供虚拟模块；读取.dep-virtual核对[success]，与同名上一用例的链接包场景不同。 */
test('msg from linked no external', async () => {
  await page.goto(url)
  expect(await page.textContent('.dep-virtual')).toMatch('[success]')
})

/** 场景：访问SSR页面，库CSS参与浏览器渲染；读取.css-lib颜色为蓝。 */
test('import css library', async () => {
  await page.goto(url)
  expect(await getColor('.css-lib')).toBe('blue')
})

/** 场景：访问SSR页面，包module条件入口被选择；读取.module-condition为[success]，本例虽同名但没有CSS颜色断言。 */
test('import css library', async () => {
  await page.goto(url)
  expect(await page.textContent('.module-condition')).toMatch('[success]')
})

/** 场景：访问SSR页面，optimizeDeps include指定嵌套依赖；读取结果含nested-include。 */
test('optimize-deps-nested-include', async () => {
  await page.goto(url)
  expect(await page.textContent('.optimize-deps-nested-include')).toMatch(
    'nested-include',
  )
})

describe.runIf(isServe)('hmr', () => {
  // TODO：server专用模块不在client图，尚未确定服务端变化应如何触发客户端更新。
  /** 场景：仅serve套件中的test.skip：预期分别编辑client/server同构模块并等待导航后显示browser-hmr/server-hmr；server文件不在client图的支持问题未解决，当前未执行。 */
  test.skip('handle isomorphic module updates', async () => {
    await page.goto(url)

    expect(await page.textContent('.isomorphic-module-server')).toMatch(
      '[server]',
    )
    // 客户端动态模块异步填充此元素，用轮询等待。
    await expect
      .poll(async () => {
        return page.textContent('.isomorphic-module-browser')
      })
      .toMatch('[browser]')

    editFile('src/isomorphic-module-browser.js', (code) =>
      code.replace('[browser]', '[browser-hmr]'),
    )
    await page.waitForNavigation()
    await expect
      .poll(async () => {
        return page.textContent('.isomorphic-module-browser')
      })
      .toMatch('[browser-hmr]')

    editFile('src/isomorphic-module-server.js', (code) =>
      code.replace('[server]', '[server-hmr]'),
    )
    await page.waitForNavigation()
    await expect
      .poll(async () => {
        return page.textContent('.isomorphic-module-server')
      })
      .toMatch('[server-hmr]')
  })
})
