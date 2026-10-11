import { describe, expect, test } from 'vitest'
import {
  findAssetFile,
  getColor,
  isBuild,
  isBundled,
  isBundledDev,
  listAssets,
  page,
  readFile,
  readManifest,
} from '~utils'

/** 页面创建 module worker 后，轮询 worker 回传文本，确认消息包含 module。 */
test('should load the worker', async () => {
  await expect.poll(() => page.textContent('.worker-message')).toMatch('module')
})

/** 入口模块初始化页面后，轮询 app 文本，确认应用显示 Hello。 */
test('should work', async () => {
  await expect.poll(() => page.textContent('#app')).toMatch('Hello')
})

// bundled dev 尚未替换 import.meta.env.LEGACY，
// 对应 legacy-env define 处理仍待修复（vitejs/vite#23028）。
/** bundled dev 因 LEGACY 替换问题跳过；其余模式轮询 env，验证构建为 true、普通 dev 为 false，并检查与预期值比较的文本为 true。 */
test.skipIf(isBundledDev)('import.meta.env.LEGACY', async () => {
  await expect
    .poll(() => page.textContent('#env'))
    .toMatch(isBuild ? 'true' : 'false')
  await expect.poll(() => page.textContent('#env-equal')).toMatch('true')
})

// https://github.com/vitejs/vite/issues/3400
/** 页面执行降级后的迭代器代码，轮询输出为 hello，覆盖 legacy 迭代协议转换。 */
test('transpiles down iterators correctly', async () => {
  await expect.poll(() => page.textContent('#iterators')).toMatch('hello')
})

/** 页面执行异步生成器并收集结果，轮询输出为 [0,1,2]，覆盖异步迭代转换后仍保持顺序。 */
test('async generator', async () => {
  await expect
    .poll(() => page.textContent('#async-generator'))
    .toMatch('[0,1,2]')
})

/** 页面检查全局是否暴露 Babel helpers，轮询结果为 false，验证 IIFE 包装没有泄漏这些辅助符号。 */
test('wraps with iife', async () => {
  await expect
    .poll(() => page.textContent('#babel-helpers'))
    .toMatch('exposed babel helpers: false')
})

/** 页面请求各产物名并显示响应 MIME；构建时只有固定命名的 immutable 两项为 JS，bundled dev 只有无 hash 的 index 为 JS，普通 dev 全部回退到 HTML。 */
test('generates assets', async () => {
  await expect
    .poll(() => page.textContent('#assets'))
    .toMatch(
      isBuild
        ? [
            'index: text/html',
            'index-legacy: text/html',
            'chunk-async: text/html',
            'chunk-async-legacy: text/html',
            'immutable-chunk: text/javascript',
            'immutable-chunk-legacy: text/javascript',
            'polyfills-legacy: text/html',
          ].join('\n')
        : isBundledDev
          ? [
              // bundled dev 的入口是 /assets/index.js，不带 hash，
              // 请求该名称会命中入口并返回 JavaScript。
              // legacy 插件只参与 build，
              // 因此 bundled dev 不生成 legacy chunk。
              // 其余 chunk 名带 hash；请求未带 hash 的名称
              // 无法命中产物，因 SPA fallback 返回 index.html。
              // immutable-chunk 在这里也带 hash：dev bundle 当前
              // 不采用 build.rolldownOptions.output 的命名设置，
              // 这一行为仍待决定（vitejs/vite#23028）。
              'index: text/javascript',
              'index-legacy: text/html',
              'chunk-async: text/html',
              'chunk-async-legacy: text/html',
              'immutable-chunk: text/html',
              'immutable-chunk-legacy: text/html',
              'polyfills-legacy: text/html',
            ].join('\n')
          : [
              'index: text/html',
              'index-legacy: text/html',
              'chunk-async: text/html',
              'chunk-async-legacy: text/html',
              'immutable-chunk: text/html',
              'immutable-chunk-legacy: text/html',
              'polyfills-legacy: text/html',
            ].join('\n'),
    )
})

/** 入口样式已加载时读取 app 的计算颜色，验证抽取或开发注入的样式使其为 red。 */
test('correctly emits styles', async () => {
  expect(await getColor('#app')).toBe('red')
})

// 动态导入的 CSS。
/** 点击动态 CSS 按钮触发模块加载，轮询动态节点变为 red，验证动态导入带入的样式生效。 */
test('should load dynamic import with css', async () => {
  await page.click('#dynamic-css-button')
  await expect.poll(() => getColor('#dynamic-css')).toBe('red')
})

/** 页面显示导入 SVG 的 URL；bundle 模式应指向带 hash 的 assets 文件，普通 dev 保留 /vite.svg。 */
test('asset url', async () => {
  expect(await page.textContent('#asset-path')).toMatch(
    isBundled ? /\/assets\/vite-[-\w]+\.svg/ : '/vite.svg',
  )
})

describe.runIf(isBuild)('build', () => {
  /** 仅构建模式读取 manifest：核对 modern 与 legacy polyfill 的源键，并分别检查三种自定义 chunk 命名模板中 legacy 后缀与 hash 的位置。 */
  test('should generate correct manifest', async () => {
    const manifest = readManifest()
    // legacy polyfill 产物。
    expect(manifest['../../vite/legacy-polyfills-legacy']).toBeDefined()
    expect(manifest['../../vite/legacy-polyfills-legacy'].src).toBe(
      '../../vite/legacy-polyfills-legacy',
    )
    expect(manifest['custom0-legacy.js'].file).toMatch(
      /chunk-X-legacy\.[-\w]{8}.js/,
    )
    expect(manifest['custom1-legacy.js'].file).toMatch(
      /chunk-X-legacy-[-\w]{8}.js/,
    )
    expect(manifest['custom2-legacy.js'].file).toMatch(
      /chunk-X-legacy[-\w]{8}.js/,
    )
    // modern polyfill 产物。
    expect(manifest['../../vite/legacy-polyfills']).toBeDefined()
    expect(manifest['../../vite/legacy-polyfills'].src).toBe(
      '../../vite/legacy-polyfills',
    )
  })

  /** 仅构建模式读取 modern 与 legacy chunk，用逗号后 function(e, 的输出特征区分压缩产物；这是文本启发式断言，不解析压缩器类型。 */
  test('should minify legacy chunks', async () => {
    // 当前断言只比较压缩后函数文本的稳定特征。
    const terserPattern = /,function\(e,/

    expect(findAssetFile(/chunk-async-legacy/)).toMatch(terserPattern)
    expect(findAssetFile(/chunk-async(?!-legacy)/)).not.toMatch(terserPattern)
    expect(findAssetFile(/immutable-chunk-legacy/)).toMatch(terserPattern)
    expect(findAssetFile(/immutable-chunk(?!-legacy)/)).not.toMatch(
      terserPattern,
    )
    expect(findAssetFile(/index-legacy/)).toMatch(terserPattern)
    expect(findAssetFile(/index(?!-legacy)/)).not.toMatch(terserPattern)
    expect(findAssetFile(/polyfills-legacy/)).toMatch(terserPattern)
  })

  /** 仅构建模式读取面向 IE 11 的 legacy 主 chunk，确认 catch 仍有参数且未出现可选链，防止压缩重新引入较新语法。 */
  test('should not use newer syntax when minifying legacy chunks', () => {
    // fixture 面向 IE 11，Babel 将 legacy chunk 降到 ES5。
    // 压缩器的 es2015 compress target 不应重新引入较新语法：
    // 有参数的 catch 不应被改成省略参数的 catch（ES2019），
    // 产物也不应出现可选链（ES2020）。
    const mainLegacyChunk = findAssetFile(/chunk-main-legacy/)
    expect(mainLegacyChunk).toMatch(/catch\s*\(/)
    expect(mainLegacyChunk).not.toMatch(/catch\s*\{/)
    expect(mainLegacyChunk).not.toMatch(/\w\?\.\w/)
  })

  /** 仅构建模式枚举 assets，确认至少存在一个 .css 文件，覆盖 legacy 构建的样式输出。 */
  test('should emit css file', async () => {
    expect(
      listAssets().some((filename) => filename.endsWith('.css')),
    ).toBeTruthy()
  })

  /** 仅构建模式读取两类 polyfill chunk，确认均含 structuredClone 文本，覆盖 core-js v3 的此项填充。 */
  test('includes structuredClone polyfill which is supported after core-js v3', () => {
    expect(findAssetFile(/polyfills-legacy/)).toMatch('`structuredClone`')
    expect(findAssetFile(/polyfills-[-\w]{8}\./)).toMatch('`structuredClone`')
  })

  /** 仅构建模式枚举 assets，分别确认 legacy 主 chunk、legacy polyfill、modern polyfill 都输出带 hash 的 map 文件。 */
  test('should generate legacy sourcemap file', async () => {
    expect(
      listAssets().some((filename) =>
        /chunk-main-legacy\.[-\w]{8}\.js\.map$/.test(filename),
      ),
    ).toBeTruthy()
    expect(
      listAssets().some((filename) =>
        /polyfills-legacy-[-\w]{8}\.js\.map$/.test(filename),
      ),
    ).toBeTruthy()
    // modern polyfill 也遵循相同的 ES5 语法检查。
    expect(
      listAssets().some((filename) =>
        /polyfills-[-\w]{8}\.js\.map$/.test(filename),
      ),
    ).toBeTruthy()
  })

  /** 仅构建模式检查 import、import.meta 或 async generator 的 guard 文本：modern 入口和 polyfill 命中，modern 异步 chunk 与 legacy 入口不命中。 */
  test('should have only modern entry files guarded', async () => {
    const guard = /(import\s*\()|(import.meta)|(async\s*function\*)/
    expect(findAssetFile(/index(?!-legacy)/)).toMatch(guard)
    expect(findAssetFile(/polyfills(?!-legacy)/)).toMatch(guard)

    expect(findAssetFile(/chunk-async(?!-legacy)/)).not.toMatch(guard)
    expect(findAssetFile(/index-legacy/)).not.toMatch(guard)
  })

  /** 仅构建模式遍历名字含 legacy 的产物，查找 Unable to preload 文本，要求结果为空以确认未带入该 preload helper。 */
  test('should not include preload helper in legacy chunks', async () => {
    expect(
      listAssets().filter(
        (filename) =>
          filename.includes('-legacy') &&
          readFile(`dist/assets/${filename}`).includes('Unable to preload'),
      ),
    ).toStrictEqual([])
  })
})
