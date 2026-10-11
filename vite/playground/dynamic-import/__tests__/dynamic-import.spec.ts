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
/** 点击 Baz 后执行字面量 import，动态模块导出 msg 写入页面；unbundled 由 Import Analysis 改写 URL，bundled 由打包器处理。 */
test('should load literal dynamic import', async () => {
  await page.click('.baz')
  await expect.poll(() => page.textContent('.view')).toMatch('Baz view')
})

// bundled dev 中，`@vite-ignore` 点击后直接请求源码 `/views/qux.js`，但该模式只服务 bundle，故
// 当前请求失败。这是 vitejs/vite#23028 跟踪的真实能力缺口，不是期望行为。
/** 运行时变量 view 指向 /views/qux.js，@vite-ignore 保留表达式；模块确实加载且没有分析警告。生产构建由 fixture writeBundle 另行复制该文件。 */
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
/** 运行时创建 blob URL 并忽略静态分析；浏览器执行该模块，页面读到其导出的 blob 消息。 */
test('should load data URL of `blob:`', async () => {
  await page.click('.issue-2658-1')
  await expect.poll(() => page.textContent('.view')).toMatch('blob')
})

/** 运行时创建 data URL 并忽略静态分析；浏览器执行内嵌模块，页面读到其导出的 data 消息。 */
test('should load data URL of `data:`', async () => {
  await page.click('.issue-2658-2')
  await expect.poll(() => page.textContent('.view')).toMatch('data')
})

/** 同一 JS 文件经静态 import 与可展开的模板动态 import 加载；比较 default 对象，应共享同一模块实例。 */
test('should have same reference on static and dynamic js import, .mxd', async () => {
  await page.click('.mxd')
  await expect.poll(() => page.textContent('.view')).toMatch('true')
})

// 此表达式无法静态确定正确模块。bundled dev 下 @vite-ignore 指向未进入 bundle 的源码
// `../files/mxd.js`，当前不会被服务，因此跳过（同 #23028 边界）。
/** @vite-ignore 原样加载手工路径；页面比较结果为 false，记录它与静态导入默认对象的身份差异。bundled dev 暂时跳过。 */
test.skipIf(isBundledDev)(
  'should have same reference on static and dynamic js import, .mxd2',
  async () => {
    await page.click('.mxd2')
    await expect.poll(() => page.textContent('.view')).toMatch('false')
  },
)

/** 同一 JSON 文件经静态 import 与模板动态 import 加载；两次 default 值应指向同一对象。 */
test('should have same reference on static and dynamic js import, .mxdjson', async () => {
  await page.click('.mxdjson')
  await expect.poll(() => page.textContent('.view')).toMatch('true')
})

// 变量 import 由 dynamic-import-vars 转成 glob 映射；点击验证多个候选分支。
/** 点击 Foo、Bar 选择不同文件名；变量模板先转成 glob，再由 runtime helper 选候选模块，页面分别显示对应消息。 */
test('should load dynamic import with vars', async () => {
  await page.click('.foo')
  await expect.poll(() => page.textContent('.view')).toMatch('Foo view')

  await page.click('.bar')
  await expect.poll(() => page.textContent('.view')).toMatch('Bar view')
})

// CSS 动态 import 既要加载 JS 包装模块，也要让样式副作用完成。
/** 点击后动态导入 CSS，等待 .view 变红；unbundled 注入样式，bundled 加载对应 CSS 产物。 */
test('should load dynamic import with css', async () => {
  await page.click('.css')
  await expect.poll(() => getColor('.view')).toBe('red')
})

/** 启动时动态导入 ../alias/hello.js 并调用 hello 导出，页面显示 hello。 */
test('should load dynamic import with vars', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars'))
    .toMatch('hello')
})

/** 忽略的 HTTPS import 在请求失败后的 catch 中写入 hello；断言检验失败处理和没有误报 https builtin，不表示远程模块加载成功。 */
test('should load dynamic import with vars ignored', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-ignored'))
    .toMatch('hello')
  // https 是运行时协议 URL，不应被当成 Node 的 https 模块而 externalize。
  expect(
    serverLogs.some((log) =>
      log.includes('"https" has been externalized for browser compatibility'),
    ),
  ).toBe(false)
})

/** 含双斜杠的 HTTPS 模板 import 使用 @vite-ignore；请求失败后 catch 写入 hello，表达式保留运行时 URL 语义。 */
test('should load dynamic import with double slash ignored', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-double-slash-ignored'))
    .toMatch('hello')
})

/** import 关键字、参数与注释跨行；模板仍被识别并展开，候选模块的 hello 导出被调用。 */
test('should load dynamic import with vars multiline', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-multiline'))
    .toMatch('hello')
})

/** 模板以 @ alias 开头，先解析 alias 再生成相对 glob；选中 hi.js 后页面显示 hi。 */
test('should load dynamic import with vars alias', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-alias'))
    .toMatch('hi')
})

/** 模板动态 import 带 ?raw；候选项返回含 default 文本的 namespace，页面序列化后可看到 hello 函数源码。 */
test('should load dynamic import with vars raw', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-raw'))
    .toMatch('export function hello()')
})

/** 模板动态 import 带 ?url；返回 namespace 中的 default 是资源 URL，unbundled 使用 /alias/url.js，bundled 可内联为 data URL。 */
test('should load dynamic import with vars url', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-with-vars-url'))
    .toMatch(isBundled ? 'data:text/javascript' : '/alias/url.js')
})

// bundled dev 尚未把 dynamic-import-vars glob 创建的 worker 识别为 worker entry。
/** 模板的 ?worker query 保留完整 namespace；用 default 构造 worker 并收发消息，页面显示 load worker。bundled dev 暂时跳过。 */
test.skipIf(isBundledDev)(
  'should load dynamic import with vars worker',
  async () => {
    await expect
      .poll(() => page.textContent('.dynamic-import-with-vars-worker'))
      .toMatch('load worker')
  },
)

// 动态模块的依赖包 CSS 应随加载生效。
/** 动态模块继续导入包内 CSS；页面元素变蓝，验证依赖样式随动态加载一起生效。 */
test('should load dynamic import with css in package', async () => {
  await page.click('.pkg-css')
  await expect.poll(() => getColor('.pkg-css')).toBe('blue')
})

/** 模板经 ../ 回到当前 nested 目录，运行时选择 self.js 并读取 self 导出。 */
test('should work with load ../ and itself directory', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-self'))
    .toMatch('dynamic-import-self-content')
})

/** 模板进入 nested/nested 子目录后选择 self.js；读取该子目录模块的独立导出。 */
test('should work with load ../ and contain itself directory', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-nested-self'))
    .toMatch('dynamic-import-nested-self-content')
})

// #22700：嵌套 `import('a').then(() => import('b'))` 中 a 带 CSS 副作用；构建输出不能因继续分析
// 内层 import 而漏掉外层 CSS。
/** 外层 import().then 中继续导入内层模块；两个模块的文本与红/绿 CSS 都必须保留并加载。 */
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

/** 动态 import 的 namespace 用对象 rest 解构；a、rest.b、rest.c 都能取到，页面显示组合内容。 */
test('should handle object rest destructuring of a dynamic import', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-import-rest'))
    .toMatch('a rest-b rest-c')
})

/** importer 位于含括号的 (app) 目录；静态目录字符经 glob 转义后仍能选中目标模块。 */
test('should work a load path that contains parentheses.', async () => {
  await expect
    .poll(() =>
      page.textContent('.dynamic-import-with-vars-contains-parenthesis'),
    )
    .toMatch('dynamic-import-with-vars-contains-parenthesis')
})

/** 这条构建用例已显式 skip；保留的断言描述静态/动态导入共用 chunk 时的拆分警告，不计作已执行验证。 */
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
/** 多种动态 import 消费形式都调用所需导出；浏览器应打印对应日志，不调用未使用的 removed 导出。实际移除代码由后面的产物断言检查。 */
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

/** 解构、属性读取和 then 回调等动态导入语法都应保持执行结果，浏览器打印所需 foo/default 日志。 */
test('dynamic import syntax parsing', async () => {
  const log = browserLogs.join('\n')
  expect(log).toContain('treeshaken syntax foo')
  expect(log).toContain('treeshaken syntax default')
})

/** 仅在 build 检查生成 chunk 文本：未使用的 removed 导出及其日志字符串应被 tree-shake 删除。 */
test.runIf(isBuild)('dynamic import treeshaken file', async () => {
  expect(findAssetFile(/treeshaken.+\.js$/)).not.toContain('treeshaken removed')
})

/** 构建保留无法分析的属性表达式 import；产物中的 .jss); 形态验证参数没有被改成确定目标的 preload 代码。 */
test.runIf(isBuild)('should not preload for non-analyzable urls', () => {
  const js = findAssetFile(/index-[-\w]{8}\.js$/)
  // 不可分析表达式应保持类似 `await import(e.jss)`，不能被错误包进确定性 preload 依赖表。
  expect(js).to.match(/\.jss\);/)
})
