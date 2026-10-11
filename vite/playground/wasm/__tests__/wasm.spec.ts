import { expect, test } from 'vitest'
import { isBundled, page } from '~utils'

/** 点击内联 WASM 的执行按钮，轮询结果为 42，验证内联字节经初始化后可调用。 */
test('should work when inlined', async () => {
  await page.click('.inline-wasm .run')
  await expect
    .poll(() => page.textContent('.inline-wasm .result'))
    .toMatch('42')
})

/** 点击外置 WASM 的执行按钮，轮询结果为 24，验证输出文件被获取并初始化。 */
test('should work when output', async () => {
  await page.click('.output-wasm .run')
  await expect
    .poll(() => page.textContent('.output-wasm .result'))
    .toMatch('24')
})

/** 点击初始化返回值检查按钮，轮询 true，验证 init 返回 WebAssembly.Instance。 */
test('init function returns WebAssembly.Instance', async () => {
  await page.click('.init-returns-instance .run')
  await expect
    .poll(() => page.textContent('.init-returns-instance .result'))
    .toMatch('true')
})

/** 读取 WASM 的 ?url 文本，bundle 模式匹配 application/wasm data URL，普通 dev 匹配 /light.wasm。 */
test('?url', async () => {
  expect(await page.textContent('.url')).toMatch(
    isBundled ? 'data:application/wasm' : '/light.wasm',
  )
})

/** 页面的 worker 加载 WASM 并回传结果，轮询为 3，覆盖 worker 内初始化。 */
test('should work when wasm in worker', async () => {
  await expect.poll(() => page.textContent('.worker-wasm .result')).toMatch('3')
})

/** 页面直接导入 WASM 导出并显示结果，轮询为 3，覆盖直接导入包装。 */
test('direct wasm import', async () => {
  await expect.poll(() => page.textContent('.direct-wasm .result')).toMatch('3')
})

/** 页面直接导入有外部 imports 的 WASM，轮询结果为 42，验证导入对象绑定。 */
test('direct wasm import with wasm imports', async () => {
  await expect
    .poll(() => page.textContent('.direct-wasm-with-imports .result'))
    .toMatch('42')
})

/** 页面直接导入 WASM Global 并显示值和类型，轮询 42 number，验证导出 Global 被解包为 JS 数值。 */
test('direct wasm import unwraps exported WebAssembly.Global', async () => {
  await expect
    .poll(() => page.textContent('.direct-wasm-global .result'))
    .toMatch('42 number')
})

/** 页面的一个 WASM 导入另一个 WASM 的 global，轮询结果为 43，验证跨模块全局绑定。 */
test('wasm importing a global from another wasm', async () => {
  await expect
    .poll(() => page.textContent('.direct-wasm-global-import .result'))
    .toMatch('43')
})

/** 页面的 WASM 读取由另一个 WASM 修改的 mutable global，轮询为 9，验证共享全局状态变化可见。 */
test('wasm reading a mutable global mutated by another wasm', async () => {
  await expect
    .poll(() => page.textContent('.direct-wasm-mutable-global-import .result'))
    .toMatch('9')
})

/** 页面运行 js-string builtins 并导入字符串常量的 WASM，轮询为 5，覆盖 builtins 与字符串常量传入。 */
test('wasm using js-string builtins and imported string constants', async () => {
  await expect
    .poll(() => page.textContent('.direct-wasm-string-builtins .result'))
    .toMatch('5')
})
