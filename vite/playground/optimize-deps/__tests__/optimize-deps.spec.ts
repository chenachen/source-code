import { describe, expect, test } from 'vitest'
import {
  browserErrors,
  browserLogs,
  getColor,
  isBuild,
  isServe,
  page,
  readDepOptimizationMetadata,
  serverLogs,
  viteTestUrl,
} from '~utils'

/** 页面静态导入 React 的默认与命名导出，先轮询按钮计数为零再点击，确认递增为一，覆盖 CJS 互操作后 hooks 可用。 */
test('default + named imports from cjs dep (react)', async () => {
  await expect.poll(() => page.textContent('.cjs button')).toBe('count is 0')
  await page.click('.cjs button')
  await expect.poll(() => page.textContent('.cjs button')).toBe('count is 1')
})

/** 页面命名导入 webpack 包装的 Phoenix，轮询 ok，验证打包 CJS 的命名导出可访问。 */
test('named imports from webpacked cjs (phoenix)', async () => {
  await expect.poll(() => page.textContent('.cjs-phoenix')).toBe('ok')
})

/** 页面默认导入 webpack 包装的 Clipboard，轮询 ok，验证默认互操作。 */
test('default import from webpacked cjs (clipboard)', async () => {
  await expect.poll(() => page.textContent('.cjs-clipboard')).toBe('ok')
})

/** 页面默认导入带 __esModule 标记的 CJS，轮询 ok，验证此标记下的默认值选择。 */
test('default import from cjs with es-module-flag (dep-cjs-with-es-module-flag)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-with-es-module-flag'))
    .toBe('ok')
})

/** 页面默认导入从 ESM 编译来的 CJS，轮询 ok，覆盖转换过的默认导出。 */
test('default import from cjs (cjs-dep-cjs-compiled-from-esm)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dep-cjs-compiled-from-esm'))
    .toBe('ok')
})

/** 页面默认导入从 CJS 编译来的 CJS，轮询 ok，覆盖 CommonJS 默认值。 */
test('default import from cjs (cjs-dep-cjs-compiled-from-cjs)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dep-cjs-compiled-from-cjs'))
    .toBe('ok')
})

/** 仅 dev 读取插件向优化依赖注入的命名导入结果，轮询 msg from injected cjs import，验证注入后的 CJS 互操作。 */
test.runIf(isServe)(
  'named import injected into an optimized dep by a plugin (dep-with-injected-import)',
  async () => {
    await expect
      .poll(() => page.textContent('.injected-import-in-optimized-dep'))
      .toBe('msg from injected cjs import')
  },
)

/** 页面动态导入 React，先轮询计数为零再点击，确认递增为一，覆盖异步 CJS 互操作。 */
test('dynamic imports from cjs dep (react)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dynamic button'))
    .toBe('count is 0')
  await page.click('.cjs-dynamic button')
  await expect
    .poll(() => page.textContent('.cjs-dynamic button'))
    .toBe('count is 1')
})

/** 页面动态命名导入 webpack 包装的 Phoenix，轮询 ok，验证动态命名空间可访问。 */
test('dynamic named imports from webpacked cjs (phoenix)', async () => {
  await expect.poll(() => page.textContent('.cjs-dynamic-phoenix')).toBe('ok')
})

/** 页面动态默认导入 webpack 包装的 Clipboard，轮询 ok，验证异步默认导出。 */
test('dynamic default import from webpacked cjs (clipboard)', async () => {
  await expect.poll(() => page.textContent('.cjs-dynamic-clipboard')).toBe('ok')
})

/** 页面动态默认导入由 ESM 编译来的 CJS，轮询 ok，验证动态命名空间中的默认值。 */
test('dynamic default import from cjs (cjs-dynamic-dep-cjs-compiled-from-esm)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dynamic-dep-cjs-compiled-from-esm'))
    .toBe('ok')
})

/** 页面动态默认导入由 CJS 编译来的 CJS，轮询 ok，覆盖其默认互操作。 */
test('dynamic default import from cjs (cjs-dynamic-dep-cjs-compiled-from-cjs)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dynamic-dep-cjs-compiled-from-cjs'))
    .toBe('ok')
})

/** 页面动态导入带 __esModule 标记的 CJS，轮询 ok，验证动态导入保留此标记对应的默认值。 */
test('dynamic default import from cjs with es-module-flag (cjs-dynamic-dep-cjs-with-es-module-flag)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dynamic-dep-cjs-with-es-module-flag'))
    .toBe('ok')
})

/** 格式不明确的 importer 动态导入带 __esModule 的模块，轮询 ok，验证该 importer 的互操作结果。 */
test('dynamic import from format-ambiguous importer respects __esModule flag (cjs-dynamic-importer-ambiguous)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dynamic-importer-ambiguous'))
    .toBe('ok')
})

/** 显式 CJS importer 动态导入依赖，轮询 ok，覆盖 Node 风格互操作的默认值选择。 */
test('dynamic import from explicit cjs importer uses node interop (cjs-dynamic-importer-cjs)', async () => {
  await expect
    .poll(() => page.textContent('.cjs-dynamic-importer-cjs'))
    .toBe('ok')
})

/** 页面使用配置为 dedupe 的 React，先检查计数为零再点击增至一，验证依赖副本合并后 hooks 可工作。 */
test('dedupe', async () => {
  await expect.poll(() => page.textContent('.dedupe button')).toBe('count is 0')
  await page.click('.dedupe button')
  await expect.poll(() => page.textContent('.dedupe button')).toBe('count is 1')
})

/** 页面调用 Axios 的 browser field 分支，轮询 pong，验证客户端解析没有选择 Node 实现。 */
test('cjs browser field (axios)', async () => {
  await expect.poll(() => page.textContent('.cjs-browser-field')).toBe('pong')
})

/** 页面通过裸包映射的 browser field 分支发起操作，轮询 pong，验证包名重定向可用。 */
test('cjs browser field bare', async () => {
  await expect
    .poll(() => page.textContent('.cjs-browser-field-bare'))
    .toBe('pong')
})

/** 页面从链接依赖导入 lodash-es，轮询 fooBarBaz，覆盖链接包的子依赖解析。 */
test('dep from linked dep (lodash-es)', async () => {
  await expect.poll(() => page.textContent('.deps-linked')).toBe('fooBarBaz')
})

/** 页面执行强制 include 的依赖，轮询 success，验证未自动发现的指定依赖可加载。 */
test('forced include', async () => {
  await expect
    .poll(() => page.textContent('.force-include'))
    .toMatch(`[success]`)
})

/** 页面对优化依赖做命名空间导入，轮询 success，验证星号导入可消费其导出。 */
test('import * from optimized dep', async () => {
  await expect.poll(() => page.textContent('.import-star')).toMatch(`[success]`)
})

/** 页面读取依赖中的 NODE_ENV 分支，构建要求 prod、dev 要求 dev，验证环境常量替换。 */
test('import from dep with process.env.NODE_ENV', async () => {
  await expect
    .poll(() => page.textContent('.node-env'))
    .toMatch(isBuild ? 'prod' : 'dev')
})

/** 页面导入含非标准 .notjs 后缀模块的依赖，轮询 success，覆盖此扩展的处理。 */
test('import from dep with .notjs files', async () => {
  await expect.poll(() => page.textContent('.not-js')).toMatch(`[success]`)
})

/** 页面加载含相对目录导入的依赖，轮询 success，验证该路径能按目录 package main 解析。 */
test('Import from dependency which uses relative path which needs to be resolved by main field', async () => {
  await expect
    .poll(() => page.textContent('.relative-to-main'))
    .toMatch(`[success]`)
})

/** 页面加载内部含动态导入的依赖，轮询 success，验证依赖子图的异步加载。 */
test('dep with dynamic import', async () => {
  await expect
    .poll(() => page.textContent('.dep-with-dynamic-import'))
    .toMatch(`[success]`)
})

/** 页面执行缺少可选 peer 的依赖，分别轮询正常与错误处理槽位为 success，验证缺失占位与应用捕获逻辑。 */
test('dep with optional peer dep', async () => {
  await expect
    .poll(() => page.textContent('.dep-with-optional-peer-dep'))
    .toMatch(`[success]`)
  await expect
    .poll(() => page.textContent('.dep-with-optional-peer-dep-error'))
    .toMatch(`[success]`)
})

/** 页面执行缺少可选 peer 子路径的依赖，正常与错误处理槽位均应显示 success，覆盖子模块占位。 */
test('dep with optional peer dep submodule', async () => {
  await expect
    .poll(() => page.textContent('.dep-with-optional-peer-dep-submodule'))
    .toMatch(`[success]`)
  await expect
    .poll(() => page.textContent('.dep-with-optional-peer-dep-submodule-error'))
    .toMatch(`[success]`)
})

/** 页面执行 CommonJS 可选 peer 依赖，正常与错误处理槽位均显示 success，覆盖 require 的缺失处理。 */
test('dep with optional peer dep (cjs)', async () => {
  await expect
    .poll(() => page.textContent('.dep-with-optional-peer-dep-cjs'))
    .toMatch(`[success]`)
  await expect
    .poll(() => page.textContent('.dep-with-optional-peer-dep-cjs-error'))
    .toMatch(`[success]`)
})

/** 页面导入含 CSS 的链接依赖，轮询计算颜色为 red，验证 JS 依赖携带的样式生效。 */
test('dep with css import', async () => {
  await expect.poll(() => getColor('.dep-linked-include')).toBe('red')
})

/** 页面导入含 CSS 的 CJS 依赖，轮询计算颜色为 blue，验证 CJS 资产导入可继续走 CSS 管线。 */
test('CJS dep with css import', async () => {
  await expect.poll(() => getColor('.cjs-with-assets')).toBe('blue')
})

/** 页面 require 主入口为 CSS 的依赖，轮询 coral，验证 CSS main 字段解析后样式生效。 */
test('CJS dep requiring dep with css main field', async () => {
  await expect.poll(() => getColor('.cjs-require-css-main-field')).toBe('coral')
})

/** 页面执行 include 依赖中的已知非 JS 文件导入，轮询 success，验证它们从优化子构建转交后续管线。 */
test('externalize known non-js files in optimize included dep', async () => {
  await expect
    .poll(() => page.textContent('.externalize-known-non-js'))
    .toMatch(`[success]`)
})

/** 页面同时消费 Vue 与 Vuex，轮询 success，验证两依赖的实际集成结果。 */
test('vue + vuex', async () => {
  await expect.poll(() => page.textContent('.vue')).toMatch(`[success]`)
})

// esbuild 优化插件的输出只在开发优化路径中断言。
/** 仅 dev 读取由 esbuild 插件改写的依赖输出，轮询 Hello from an esbuild plugin；build 不执行此优化插件断言。 */
test.runIf(isServe)('esbuild-plugin', async () => {
  await expect
    .poll(() => page.textContent('.esbuild-plugin'))
    .toMatch(`Hello from an esbuild plugin`)
})

/** 页面导入隐藏目录内的模块，轮询 hello!，覆盖扫描/加载时对隐藏路径的处理。 */
test('import from hidden dir', async () => {
  await expect.poll(() => page.textContent('.hidden-dir')).toBe('hello!')
})

/** 页面导入 excluded 包，它继续导入 included 包，轮询 nested-include，验证两条优化边界衔接。 */
test('import optimize-excluded package that imports optimized-included package', async () => {
  await expect
    .poll(() => page.textContent('.nested-include'))
    .toBe('nested-include')
})

/** 页面导入带冒号的别名包，轮询 vite.dev，验证它被 alias 解析为模块而未当 URL 协议。 */
test('import aliased package with colon', async () => {
  await expect.poll(() => page.textContent('.url')).toBe('vite.dev')
})

/** 页面导入映射到绝对路径的 alias 包，轮询指定依赖消息，覆盖 alias 后文件解析。 */
test('import aliased package using absolute path', async () => {
  await expect
    .poll(() => page.textContent('.alias-using-absolute-path'))
    .toBe('From dep-alias-using-absolute-path')
})

/** 页面的不同 script 复用同一变量名，轮询 reused，验证扫描时各脚本作用域没有冲突。 */
test('variable names are reused in different scripts', async () => {
  await expect
    .poll(() => page.textContent('.reused-variable-names'))
    .toBe('reused')
})

// #8428 回归：flattenId 必须对 '/' 与 '.' 做不同编码，
// 避免 lodash/cloneDeep 与 lodash.clonedeep 的优化名称碰撞。
/** 页面分别加载斜杠子路径、点号包名与加号子路径，轮询三份不同消息，验证扁平 ID 不把这些路径编码成同一产物。 */
test('flatten id should generate correctly', async () => {
  await expect
    .poll(() => page.textContent('.clonedeep-slash'))
    .toBe('clonedeep-slash')
  await expect
    .poll(() => page.textContent('.clonedeep-dot'))
    .toBe('clonedeep-dot')
  await expect
    .poll(() => page.textContent('.dep-with-plus-subpath'))
    .toBe('plus-subpath')
})

/** 页面以绝对与相对路径消费同一个未优化模块，轮询两来源消息的组合，覆盖模块实例复用的应用结果。 */
test('non optimized module is not duplicated', async () => {
  await expect
    .poll(() => page.textContent('.non-optimized-module-is-not-duplicated'))
    .toBe('from-absolute-path, from-relative-path')
})

/** 仅 dev 检查 ESM/CJS 依赖访问 fs/path 的日志以及用户代码访问 buffer/child_process 的浏览器错误，要求出现对应外置兼容性消息。 */
test.runIf(isServe)('error on builtin modules usage', () => {
  expect(browserLogs).toEqual(
    expect.arrayContaining([
      // ESM 依赖访问内置模块的页面输出。
      expect.stringMatching(/dep-with-builtin-module-esm.*is not a function/),
      // ESM 依赖触发的内置模块浏览器兼容警告。
      expect.stringContaining(
        'Module "fs" has been externalized for browser compatibility. Cannot access "fs.readFileSync" in client code.',
      ),
      expect.stringContaining(
        'Module "path" has been externalized for browser compatibility. Cannot access "path.join" in client code.',
      ),
      // CJS 依赖访问内置模块的页面输出。
      expect.stringMatching(/dep-with-builtin-module-cjs.*is not a function/),
      // CJS 依赖触发的内置模块浏览器兼容警告。
      expect.stringContaining(
        'Module "fs" has been externalized for browser compatibility. Cannot access "fs.readFileSync" in client code.',
      ),
      expect.stringContaining(
        'Module "path" has been externalized for browser compatibility. Cannot access "path.join" in client code.',
      ),
    ]),
  )

  expect(browserErrors.map((error) => error.message)).toEqual(
    expect.arrayContaining([
      // 用户源码访问内置模块的页面输出。
      expect.stringContaining(
        'Module "buffer" has been externalized for browser compatibility. Cannot access "buffer.Buffer" in client code.',
      ),
      expect.stringContaining(
        'Module "child_process" has been externalized for browser compatibility. Cannot access "child_process.execSync" in client code.',
      ),
    ]),
  )
})

/** 页面 require 普通 CSS 与 CSS Module 后均应为 red；dev 另先监听优化依赖响应并导航，确认 require 已改成 /@fs CSS 导入。 */
test('pre bundle css require', async () => {
  if (isServe) {
    const response = page.waitForResponse(/@vitejs_test-dep-css-require\.js/)
    await page.goto(viteTestUrl)
    const content = await (await response).text()
    expect(content).toMatch(
      /import\s"\/@fs.+@vitejs\/test-dep-css-require\/style\.css"/,
    )
  }

  await expect.poll(() => getColor('.css-require')).toBe('red')
  await expect.poll(() => getColor('.css-module-require')).toBe('red')
})

/** 仅构建模式遍历服务器日志，确认没有 Missing dependency found after crawling ended 消息。 */
test.runIf(isBuild)('no missing deps during build', async () => {
  serverLogs.forEach((log) => {
    // 此处检查依赖扫描完成后未再次发现缺失依赖。
    expect(log).not.toMatch('Missing dependency found after crawling ended')
  })
})

/** 仅 dev 监听长包名优化响应再导航，将文件最后一段去除后缀后检查长度为 170；构建模式此用例无附加断言。 */
test('name file limit is 170 characters', async () => {
  if (isServe) {
    const response = page.waitForResponse(
      /@vitejs_longfilename-\w+_[a-zA-Z\d]+\.js\?v=[a-zA-Z\d]+/,
    )
    await page.goto(viteTestUrl)
    const content = await response

    const fromUrl = content.url()
    const stripFolderPart = fromUrl.split('/').at(-1)
    const onlyTheFilePart = stripFolderPart.split('.')[0]
    expect(onlyTheFilePart).toHaveLength(170)
  }
})

describe.runIf(isServe)('optimizeDeps config', () => {
  /** 仅 dev 读取优化 metadata，检查 include glob 展开后含包根、命名导出、普通与嵌套文件的指定十五个 ID；断言允许其他优化项同时存在。 */
  test('supports include glob syntax', () => {
    const metadata = readDepOptimizationMetadata()
    expect(Object.keys(metadata.optimized)).to.include.members([
      '@vitejs/test-dep-optimize-exports-with-glob',
      '@vitejs/test-dep-optimize-exports-with-glob/named',
      '@vitejs/test-dep-optimize-exports-with-glob/glob-dir/foo',
      '@vitejs/test-dep-optimize-exports-with-glob/glob-dir/bar',
      '@vitejs/test-dep-optimize-exports-with-glob/glob-dir/nested/baz',
      '@vitejs/test-dep-optimize-exports-with-root-glob',
      '@vitejs/test-dep-optimize-exports-with-root-glob/file1.js',
      '@vitejs/test-dep-optimize-exports-with-root-glob/index.js',
      '@vitejs/test-dep-optimize-exports-with-root-glob/dir/file2.js',
      '@vitejs/test-dep-optimize-with-glob',
      '@vitejs/test-dep-optimize-with-glob/index.js',
      '@vitejs/test-dep-optimize-with-glob/named.js',
      '@vitejs/test-dep-optimize-with-glob/glob/foo.js',
      '@vitejs/test-dep-optimize-with-glob/glob/bar.js',
      '@vitejs/test-dep-optimize-with-glob/glob/nested/baz.js',
    ])
  })
})

/** 页面加载长文件名模块，轮询 hello world，验证长路径实际可执行。 */
test('long file name should work', async () => {
  await expect
    .poll(() => page.textContent('.long-file-name'))
    .toMatch(`hello world`)
})

/** 仅 dev 查找服务器日志中依赖与 optimizer 不兼容的警告，验证失败或不兼容依赖的提示。 */
test.runIf(isServe)('warn on incompatible dependency', () => {
  expect(serverLogs).toContainEqual(
    expect.stringContaining(
      'The dependency might be incompatible with the dep optimizer.',
    ),
  )
})

/** 页面导入省略 JS 后缀的 CommonJS 外置包，轮询普通及 scss/astro/tsx 名称的四个结果，验证名称看似扩展时仍按包模块解析。 */
test('import the CommonJS external package that omits the js suffix', async () => {
  await expect.poll(() => page.textContent('.external-package-js')).toBe('okay')
  await expect
    .poll(() => page.textContent('.external-package-scss-js'))
    .toBe('scss')
  await expect
    .poll(() => page.textContent('.external-package-astro-js'))
    .toBe('astro')
  await expect
    .poll(() => page.textContent('.external-package-tsx-js'))
    .toBe('tsx')
})

/** 页面加载名字带资产扩展的包，检查无双包槽位为 true、预打包槽位为 String(isServe)，区分 dev 优化与 build 处理结果。 */
test('external package name with asset extension', async () => {
  await expect
    .poll(() => page.textContent('.dep-with-asset-ext-no-dual-package'))
    .toBe('true')
  await expect
    .poll(() => page.textContent('.dep-with-asset-ext-prebundled'))
    .toBe(String(isServe))
})

/** 页面消费 CJS 的外置子依赖，轮询对象导出为 ok、Node builtin 分支为 foo bar，验证两种 external 的互操作。 */
test('dependency with external sub-dependencies', async () => {
  await expect
    .poll(() => page.textContent('.dep-cjs-with-external-deps-object'))
    .toBe('ok')
  await expect
    .poll(() => page.textContent('.dep-cjs-with-external-deps-node-builtin'))
    .toBe('foo bar')
})

/** 页面导入名字以 .vue 结尾的虚拟模块，轮询 ok，覆盖虚拟 ID 扫描后正常执行。 */
test('virtual module with .vue extension does not error during scan', async () => {
  await expect.poll(() => page.textContent('.virtual-module-vue')).toBe('ok')
})

/** 仅 dev 过滤同时含扫描失败与 virtual: 的服务器日志，要求零条，覆盖 HTML 类扩展的虚拟模块扫描。 */
test.runIf(isServe)(
  'no dep scan error for virtual modules with html-like extensions',
  () => {
    // 核对依赖扫描期间没有虚拟模块相关错误。
    const scanErrors = serverLogs.filter(
      (log) =>
        log.includes('Failed to scan for dependencies') &&
        log.includes('virtual:'),
    )
    expect(scanErrors).toHaveLength(0)
  },
)

/** 页面启动依赖包中的普通及嵌套 worker，轮询 worker-success；再核对资产 URL 在 build/dev 的不同路径并请求它，要求 200。 */
test('should fix relative worker paths in optimized dependencies', async () => {
  await expect
    .poll(() => page.textContent('.worker-lib'))
    .toBe('worker-success')
  await expect
    .poll(() => page.textContent('.worker-nested'))
    .toBe('worker-success')

  const assetMatcher = isBuild
    ? /assets\/logo-[-\w]+\.png/
    : /\/node_modules\/@vitejs\/test-dep-with-assets\/logo\.png/
  await expect.poll(() => page.textContent('.asset-url')).toMatch(assetMatcher)

  const url = await page.textContent('.asset-url')
  const res = await page.request.get(url)
  expect(res.status()).toBe(200)
})
