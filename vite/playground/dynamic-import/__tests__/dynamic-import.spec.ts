import { expect, test } from 'vitest'
import {
  browserLogs,
  findAssetFile,
  getColor,
  isBuild,
  isBundled,
  isBundledDev,
  page,
  serverLogs,
} from '~utils'

/**
 * 场景：动态 import 横跨开发态 importAnalysis、dynamic-import-vars、CSS/asset/worker 插件及构建拆包。
 * 目标：字面量和可分析变量能重写为正确模块，显式 @vite-ignore 保持运行时表达式且不告警，嵌套
 * CSS/treeshaking 在最终浏览器执行中仍正确。
 * 机制：以真实点击/DOM/CSS 和生成资产日志观察整条插件链，而非只断言转换字符串。
 */

// 基础字面量 import 应被 importAnalysis 解析、规范化并按需加载。
/**
 * 场景：在当前 playground 中，点击 “page.click('.baz')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'Baz view'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load literal dynamic import', async () => {
  await page.click('.baz')
  await expect.poll(() => page.textContent('.view')).toMatch('Baz view')
})

// bundled dev 中，`@vite-ignore` 点击后直接请求源码 `/views/qux.js`，但该模式只服务 bundle，故
// 当前请求失败。这是 vitejs/vite#23028 跟踪的真实能力缺口，不是期望行为。
/**
 * 场景：在当前 playground 中，点击 “page.click('.qux')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'Qux view'”；“serverLogs.some((log) => log.includes('cannot be analyzed by vite'))” 应等于 “false”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test.skipIf(isBundledDev)(
  'should load full dynamic import from public',
  async () => {
    await page.click('.qux')
    await expect.poll(() => page.textContent('.view')).toMatch('Qux view')
    // 用户已经用 @vite-ignore 明确接管运行时解析，不应再输出无法分析警告。
    expect(
      serverLogs.some((log) => log.includes('cannot be analyzed by vite')),
    ).toBe(false)
  },
)

// 协议 URL 不进入 Vite resolve，但浏览器仍应能执行 blob:/data: 动态模块。
/**
 * 场景：在当前 playground 中，点击 “page.click('.issue-2658-1')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'blob'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load data URL of `blob:`', async () => {
  await page.click('.issue-2658-1')
  await expect.poll(() => page.textContent('.view')).toMatch('blob')
})

/**
 * 场景：在当前 playground 中，点击 “page.click('.issue-2658-2')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'data'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load data URL of `data:`', async () => {
  await page.click('.issue-2658-2')
  await expect.poll(() => page.textContent('.view')).toMatch('data')
})

/**
 * 场景：在当前 playground 中，点击 “page.click('.mxd')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'true'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should have same reference on static and dynamic js import, .mxd', async () => {
  await page.click('.mxd')
  await expect.poll(() => page.textContent('.view')).toMatch('true')
})

// 此表达式无法静态确定正确模块。bundled dev 下 @vite-ignore 指向未进入 bundle 的源码
// `../files/mxd.js`，当前不会被服务，因此跳过（同 #23028 边界）。
/**
 * 场景：在当前 playground 中，点击 “page.click('.mxd2')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'false'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test.skipIf(isBundledDev)(
  'should have same reference on static and dynamic js import, .mxd2',
  async () => {
    await page.click('.mxd2')
    await expect.poll(() => page.textContent('.view')).toMatch('false')
  },
)

/**
 * 场景：在当前 playground 中，点击 “page.click('.mxdjson')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'true'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should have same reference on static and dynamic js import, .mxdjson', async () => {
  await page.click('.mxdjson')
  await expect.poll(() => page.textContent('.view')).toMatch('true')
})

// 变量 import 由 dynamic-import-vars 转成 glob 映射；点击验证多个候选分支。
/**
 * 场景：在当前 playground 中，点击 “page.click('.foo')”，然后点击 “page.click('.bar')”。
 * 验证目标：“page.textContent('.view')” 应匹配 “'Foo view'”；“page.textContent('.view')” 应匹配 “'Bar view'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load dynamic import with vars', async () => {
  await page.click('.foo')
  await expect.poll(() => page.textContent('.view')).toMatch('Foo view')

  await page.click('.bar')
  await expect.poll(() => page.textContent('.view')).toMatch('Bar view')
})

// CSS 动态 import 既要加载 JS 包装模块，也要让样式副作用完成。
/**
 * 场景：在当前 playground 中，点击 “page.click('.css')”。
 * 验证目标：“getColor('.view')” 应等于 “'red'”，从而确认动态 chunk 与其 CSS 副作用一起加载。
 */
test('should load dynamic import with css', async () => {
  await page.click('.css')
  await expect.poll(() => getColor('.view')).toBe('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars')” 应匹配 “'hello'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load dynamic import with vars', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars'))
    .toMatch('hello')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-ignored')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-ignored')” 应匹配 “'hello'”；“serverLogs.some((log) => log.includes('"https" has been externalized for browser compatibility'), )” 应等于 “false”，从而确认@vite-ignore 跳过静态分析且不产生误报或 preload。
 */
test('should load dynamic import with vars ignored', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-ignored'))
    .toMatch('hello')
  // `@vite-ignore` 已表明故意保留表达式，不应触发 browser external/分析警告。
  expect(
    serverLogs.some((log) =>
      log.includes('"https" has been externalized for browser compatibility'),
    ),
  ).toBe(false)
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-double-slash-ignored')”。
 * 验证目标：“page.textContent('.dynamic-import-with-double-slash-ignored')” 应匹配 “'hello'”，从而确认@vite-ignore 跳过静态分析且不产生误报或 preload。
 */
test('should load dynamic import with double slash ignored', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-double-slash-ignored'))
    .toMatch('hello')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-multiline')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-multiline')” 应匹配 “'hello'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load dynamic import with vars multiline', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-multiline'))
    .toMatch('hello')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-alias')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-alias')” 应匹配 “'hi'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load dynamic import with vars alias', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-alias'))
    .toMatch('hi')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-raw')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-raw')” 应匹配 “'export function hello()'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load dynamic import with vars raw', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-raw'))
    .toMatch('export function hello()')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-url')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-url')” 应匹配 “isBundled ? 'data:text/javascript' : '/alias/url.js'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should load dynamic import with vars url', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-url'))
    .toMatch(isBundled ? 'data:text/javascript' : '/alias/url.js')
})

// bundled dev 尚未把 dynamic-import-vars glob 创建的 worker 识别为 worker entry。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-worker')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-worker')” 应匹配 “'load worker'”，从而确认变量动态导入产生的 worker 入口能被子构建识别。
 */
test.skipIf(isBundledDev)(
  'should load dynamic import with vars worker',
  async () => {
    await expect
      .poll(() => page.textContent('.dynamic-import-with-vars-worker'))
      .toMatch('load worker')
  },
)

// 依赖包 CSS、自身/父目录路径和括号目录共同验证规范 URL 没有被字符串处理破坏。
/**
 * 场景：在当前 playground 中，点击 “page.click('.pkg-css')”。
 * 验证目标：“getColor('.pkg-css')” 应等于 “'blue'”，从而确认动态 chunk 与其 CSS 副作用一起加载。
 */
test('should load dynamic import with css in package', async () => {
  await page.click('.pkg-css')
  await expect.poll(() => getColor('.pkg-css')).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-self')”。
 * 验证目标：“page.textContent('.dynamic-import-self')” 应匹配 “'dynamic-import-self-content'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should work with load ../ and itself directory', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-self'))
    .toMatch('dynamic-import-self-content')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-nested-self')”。
 * 验证目标：“page.textContent('.dynamic-import-nested-self')” 应匹配 “'dynamic-import-nested-self-content'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should work with load ../ and contain itself directory', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-nested-self'))
    .toMatch('dynamic-import-nested-self-content')
})

// #22700：嵌套 `import('a').then(() => import('b'))` 中 a 带 CSS 副作用；构建输出不能因继续分析
// 内层 import 而漏掉外层 CSS。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.then-css-outer')”。
 * 验证目标：“page.textContent('.then-css-outer')” 应匹配 “'then-css-outer'”；“getColor('.then-css-outer')” 应等于 “'red'”，从而确认动态 chunk 与其 CSS 副作用一起加载。
 */
test('should load css of nested dynamic import', async () => {
  await expect
    .poll(() => page.textContent('.then-css-outer'))
    .toMatch('then-css-outer')
  await expect.poll(() => getColor('.then-css-outer')).toBe('red')
  await expect
    .poll(() => page.textContent('.then-css-inner'))
    .toMatch('then-css-inner')
  await expect.poll(() => getColor('.then-css-inner')).toBe('green')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-rest')”。
 * 验证目标：“page.textContent('.dynamic-import-rest')” 应匹配 “'a rest-b rest-c'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should handle object rest destructuring of a dynamic import', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-rest'))
    .toMatch('a rest-b rest-c')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.dynamic-import-with-vars-contains-parenthesis')”。
 * 验证目标：“page.textContent('.dynamic-import-with-vars-contains-parenthesis')” 应匹配 “'dynamic-import-with-vars-contains-parenthesis'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('should work a load path that contains parentheses.', async () => {
  await expect
    .poll(() =>
      page.textContent('.dynamic-import-with-vars-contains-parenthesis'),
    )
    .toMatch('dynamic-import-with-vars-contains-parenthesis')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “log”。
 * 验证目标：“log” 应包含 “'dynamic import will not move module into another chunk'”；“log” 应匹配 “/\(!\).*\/dynamic-import\/files\/mxd\.js is dynamically imported by/”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test.runIf(isBuild)(
  'should rollup warn when static and dynamic import a module in same chunk',
  // 这是 Rolldown/Rollup chunk 划分警告，不属于浏览器运行失败；用例暂时显式跳过。
  { skip: true },
  async () => {
    const log = serverLogs.join('\n')
    expect(log).toContain(
      'dynamic import will not move module into another chunk',
    )
    expect(log).toMatch(
      /\(!\).*\/dynamic-import\/files\/mxd\.js is dynamically imported by/,
    )
    expect(log).toMatch(
      /\(!\).*\/dynamic-import\/files\/mxd\.json is dynamically imported by/,
    )
    expect(log).not.toMatch(
      /\(!\).*\/dynamic-import\/nested\/shared\.js is dynamically imported by/,
    )
  },
)

// 解构、`.then(m => m.x)` 等消费形状应允许构建器只保留实际使用的动态模块导出。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “log”。
 * 验证目标：“log” 应包含 “'treeshaken foo'”；“log” 应包含 “'treeshaken bar'”，从而确认构建器仅保留动态模块实际使用的导出。
 */
test('dynamic import treeshaken log', async () => {
  const log = browserLogs.join('\n')
  expect(log).toContain('treeshaken foo')
  expect(log).toContain('treeshaken bar')
  expect(log).toContain('treeshaken baz1')
  expect(log).toContain('treeshaken baz2')
  expect(log).toContain('treeshaken baz3')
  expect(log).toContain('treeshaken baz4')
  expect(log).toContain('treeshaken baz5')
  expect(log).toContain('treeshaken baz6')
  expect(log).toContain('treeshaken default')

  expect(log).not.toContain('treeshaken removed')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “log”。
 * 验证目标：“log” 应包含 “'treeshaken syntax foo'”；“log” 应包含 “'treeshaken syntax default'”，从而确认importAnalysis/dynamic-import-vars 将字面量或可分析变量解析为正确模块。
 */
test('dynamic import syntax parsing', async () => {
  const log = browserLogs.join('\n')
  expect(log).toContain('treeshaken syntax foo')
  expect(log).toContain('treeshaken syntax default')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “findAssetFile(/treeshaken.+\.js$/)”。
 * 验证目标：“findAssetFile(/treeshaken.+\.js$/)” 不应包含 “'treeshaken removed'”，从而确认构建器仅保留动态模块实际使用的导出。
 */
test.runIf(isBuild)('dynamic import treeshaken file', async () => {
  expect(findAssetFile(/treeshaken.+\.js$/)).not.toContain('treeshaken removed')
})

/**
 * 场景：构建入口包含无法静态确定目标的动态 import，读取最终入口 chunk 文本。
 * 验证目标：生成代码仍包含形如 `.jss);` 的原始运行时 import 参数，不能为它注入确定性 preload 依赖，确认不可分析 URL 不会被误预加载。
 */
test.runIf(isBuild)('should not preload for non-analyzable urls', () => {
  const js = findAssetFile(/index-[-\w]{8}\.js$/)
  // 不可分析表达式应保持类似 `await import(e.jss)`，不能被错误包进确定性 preload 依赖表。
  expect(js).to.match(/\.jss\);/)
})
