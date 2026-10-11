import { describe, expect, test } from 'vitest'
import { isBuild, isServe, page, readFile, serverLogs } from '~utils'

describe.runIf(isBuild)('build', () => {
  /** 仅构建模式检查 ES 库产物的页面输出为 It works，验证该格式被正常加载。 */
  test('es', async () => {
    expect(await page.textContent('.es')).toBe('It works')
  })

  /** 仅构建模式检查 UMD 页面输出，并读取压缩、未压缩与具名产物，验证包装函数及入口函数的文本位置。 */
  test('umd', async () => {
    expect(await page.textContent('.umd')).toBe('It works')
    const code = readFile('dist/my-lib-custom-filename.umd.cjs')
    const noMinifyCode = readFile(
      'dist/nominify/my-lib-custom-filename.umd.cjs',
    )
    const namedCode = readFile('dist/named/my-lib-named.umd.cjs')
    // 检查 banner 后紧接 UMD wrapper，以及未压缩入口函数所在位置。
    expect(code).toMatch(/^\/\*[^*]*\*\/\s*\(function\(/)
    expect(noMinifyCode).toMatch(
      /^\/\*[^*]*\*\/\s*\(function\(global.+?function\smyLib\(/s,
    )
    expect(namedCode).toMatch(/^\(function\(/)
  })

  /** 仅构建模式检查 IIFE 页面输出，并读取三种产物，验证 MyLib 或 MyLibNamed 全局变量及 IIFE 包装前缀。 */
  test('iife', async () => {
    expect(await page.textContent('.iife')).toBe('It works')
    const code = readFile('dist/my-lib-custom-filename.iife.js')
    const noMinifyCode = readFile(
      'dist/nominify/my-lib-custom-filename.iife.js',
    )
    const namedCode = readFile('dist/named/my-lib-named.iife.js')
    // 检查 banner 后的全局变量和 IIFE wrapper 前缀。
    expect(code).toMatch(/^\/\*[^*]*\*\/\s*var MyLib=\(function\(\)\{\s*/)
    expect(noMinifyCode).toMatch(
      /^\/\*[^*]*\*\/\s*var MyLib\s*=\s*\(function\(\)\s*\{\s*/,
    )
    expect(namedCode).toMatch(/^var MyLibNamed=\(function\([^()]+\)\{\s*/)
  })

  /** 仅构建模式读取 helpers-injection 产物，确认动态构造函数中的 use strict 字符串保持预期转义文本。 */
  test('restrisct-helpers-injection', async () => {
    const code = readFile(
      'dist/helpers-injection/my-lib-custom-filename.iife.js',
    )
    expect(code).toMatch(
      `\\"use strict\\"; return (" + expressionSyntax + ").constructor;"`,
    )
  })

  /** 仅构建模式轮询动态导入输出 hello vite，并确认 ES 库入口无 __vitePreload 且异步 chunk 使用带 hash 的相对导入。 */
  test('Library mode does not include `preload`', async () => {
    await expect
      .poll(() => page.textContent('.dynamic-import-message'))
      .toMatch('hello vite')
    const code = readFile('dist/lib/dynamic-import-message.es.mjs')
    expect(code).not.toMatch('__vitePreload')

    // 异步库 chunk 的文件名应包含 hash。
    expect(code).toMatch(/await import\(['"`]\.\/message-[-\w]{8}.js['"`]\)/)
  })

  /** 仅构建模式读取库入口，确认纯 CSS chunk 的异步 JS 导入消失并替换成已解决的空对象 Promise。 */
  test('Library mode does not have any reference to pure CSS chunks', async () => {
    const code = readFile('dist/lib/dynamic-import-message.es.mjs')

    // 纯 CSS chunk 的 JS 导入被已完成的空对象 Promise 替代。
    expect(code).not.toMatch(
      /await import\(['"`]\.\/dynamic-[-\w]{8}.js['"`]\)/,
    )
    expect(code).toMatch(/await Promise.resolve\(\{.*\}\)/)
  })

  /** 仅构建模式读取 ES 库产物，确认 PURE 标记保留，供下游继续 tree shaking。 */
  test('pure annotations are kept for es output', () => {
    const es = readFile('dist/my-lib-custom-filename.js')
    expect(es).toMatch(/[@#]__PURE__/)
  })

  /** 仅构建模式读取 IIFE 产物，确认 PURE 标记被移除。 */
  test('pure annotations are removed for non-es output', () => {
    const es = readFile('dist/my-lib-custom-filename.iife.js')
    expect(es).not.toMatch(/[@#]__PURE__/)
  })

  /** 仅构建模式遍历服务器日志，确认没有 @import 必须位于最前的 CSS 压缩警告。 */
  test('@import hoist', async () => {
    serverLogs.forEach((log) => {
      // 不应出现 @import 必须位于最前的 CSS 压缩警告。
      expect(log).not.toMatch('All "@import" rules must come first')
    })
  })

  /** 仅构建模式分别读取 ES、IIFE、UMD 输出，确认 process.env.NODE_ENV 文本仍保留给库使用者处理。 */
  test('preserve process.env', () => {
    const es = readFile('dist/my-lib-custom-filename.js')
    const iife = readFile('dist/my-lib-custom-filename.iife.js')
    const umd = readFile('dist/my-lib-custom-filename.umd.cjs')
    expect(es).toMatch('process.env.NODE_ENV')
    expect(iife).toMatch('process.env.NODE_ENV')
    expect(umd).toMatch('process.env.NODE_ENV')
  })

  /** 仅构建模式读取 Terser 压缩的 ES 产物，确认 debugger 文本已移除。 */
  test('debugger statements are removed by terser for es', () => {
    const terserEs = readFile('dist/terser/my-lib-custom-filename.js')
    expect(terserEs).not.toMatch('debugger')
  })

  /** 仅构建模式读取 Terser 压缩的 ES 产物，确认 PURE 标记保留。 */
  test('pure annotations are not removed by terser for es', () => {
    const terserEs = readFile('dist/terser/my-lib-custom-filename.js')
    expect(terserEs).toMatch(/[@#]__PURE__/)
  })

  /** 仅构建模式读取 Terser 压缩的 IIFE 产物，确认 PURE 标记被移除。 */
  test('pure annotations are removed by terser for non-es output', () => {
    const terserIife = readFile('dist/terser/my-lib-custom-filename.iife.js')
    expect(terserIife).not.toMatch(/[@#]__PURE__/)
  })

  /** 仅构建模式读取单 CSS 入口输出，确认 CSS 有 entry-1 标记，ES 与 UMD 各有 css-entry-1 的模块文本。 */
  test('single entry with css', () => {
    const css = readFile('dist/css-single-entry/test-my-lib.css')
    const js = readFile('dist/css-single-entry/test-my-lib.js')
    const umd = readFile('dist/css-single-entry/test-my-lib.umd.cjs')
    expect(css).toMatch('entry-1.css')
    expect(js).toMatch('css-entry-1')
    expect(umd).toContain('css-entry-1')
  })

  /** 仅构建模式读取多入口合并 CSS 与各 ES/CJS 产物，确认合并样式同时包含两入口标记，各 JS 保持对应入口文本。 */
  test('multi entry with css', () => {
    const css = readFile('dist/css-multi-entry/test-my-lib.css')
    const js1 = readFile('dist/css-multi-entry/css-entry-1.js')
    const js2 = readFile('dist/css-multi-entry/css-entry-2.js')
    const cjs1 = readFile('dist/css-multi-entry/css-entry-1.cjs')
    const cjs2 = readFile('dist/css-multi-entry/css-entry-2.cjs')
    expect(css).toMatch('entry-1.css')
    expect(css).toMatch('entry-2.css')
    expect(js1).toMatch('css-entry-1')
    expect(js2).toMatch('css-entry-2')
    expect(cjs1).toContain('css-entry-1')
    expect(cjs2).toContain('css-entry-2')
  })

  /** 仅构建模式读取启用 CSS 分割的多入口输出，确认各自 CSS 与 ES/CJS 文件都包含对应入口标记。 */
  test('multi entry with css and code split', () => {
    const css1 = readFile('dist/css-code-split/css-entry-1.css')
    const css2 = readFile('dist/css-code-split/css-entry-2.css')
    const js1 = readFile('dist/css-code-split/css-entry-1.js')
    const js2 = readFile('dist/css-code-split/css-entry-2.js')
    const cjs1 = readFile('dist/css-code-split/css-entry-1.cjs')
    const cjs2 = readFile('dist/css-code-split/css-entry-2.cjs')
    expect(css1).toMatch('entry-1.css')
    expect(css2).toMatch('entry-2.css')
    expect(js1).toMatch('css-entry-1')
    expect(js2).toMatch('css-entry-2')
    expect(cjs1).toContain('css-entry-1')
    expect(cjs2).toContain('css-entry-2')
  })
})

/** 仅开发模式轮询 demo 文本为 It works，验证库源代码在 dev 页面可执行。 */
test.runIf(isServe)('dev', async () => {
  await expect.poll(() => page.textContent('.demo')).toBe('It works')
})
