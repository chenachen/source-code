import { stripVTControlCharacters } from 'node:util'
import { expect, test } from 'vitest'
import { isServe, page, serverLogs } from '~utils'

/** 归一化 ANSI、pnpm 虚拟路径与 code frame 行尾，使断言只关注转发/映射语义。 */
function normalizeLogs(logs: string[]) {
  return (
    logs
      .map((log) => stripVTControlCharacters(log))
      .join('\n')
      // pnpm 版本与 peer 后缀不稳定，折叠成固定占位段。
      .replaceAll(
        /node_modules\/\.pnpm\/[^/\n]+\/node_modules\//g,
        'node_modules/.pnpm/<normalized>/node_modules/',
      )
      // code frame 的视觉填充空格不属于行为契约。
      .replaceAll(/ +\n/g, '\n')
  )
}

/** window error 应转发为 Unhandled error，并用 sourcemap 指回 TS 源码及最近 code frame。 */
/**
 * 场景：在当前 playground 中，点击 “page.click('#test-error')”。
 * 验证目标：“normalizeLogs(serverLogs)” 应包含 “'\ [Unhandled error] Error: this is test error > testError src/main.ts:30:8 28 | 29 | function testError…”，从而确认浏览器 console/未处理异常被序列化到 server logger 且堆栈指向原源。
 */
test.runIf(isServe)('unhandled error', async () => {
  await page.click('#test-error')
  await expect.poll(() => normalizeLogs(serverLogs)).toContain(`\
[Unhandled error] Error: this is test error
 > testError src/main.ts:30:8
    28 |
    29 |  function testError() {
    30 |    throw new Error('this is test error')
       |          ^
    31 |  }
    32 |
 > HTMLButtonElement.<anonymous> src/main.ts:8:2
`)
})

/** Promise rejection 使用独立标题，同时保留发起函数和事件 callback 调用链。 */
/**
 * 场景：在当前 playground 中，点击 “page.click('#test-unhandledrejection')”。
 * 验证目标：“normalizeLogs(serverLogs.slice(logIndex))” 应包含 “'\ [Unhandled rejection] Error: this is test unhandledrejection > testUnhandledRejection src/main.ts:34:…”，从而确认浏览器 console/未处理异常被序列化到 server logger 且堆栈指向原源。
 */
test.runIf(isServe)('unhandled rejection', async () => {
  const logIndex = serverLogs.length
  await page.click('#test-unhandledrejection')
  await expect.poll(() => normalizeLogs(serverLogs.slice(logIndex)))
    .toContain(`\
[Unhandled rejection] Error: this is test unhandledrejection
 > testUnhandledRejection src/main.ts:34:17
    32 |
    33 |  function testUnhandledRejection() {
    34 |    Promise.reject(new Error('this is test unhandledrejection'))
       |                   ^
    35 |  }
    36 |
 > HTMLButtonElement.<anonymous> src/main.ts:14:4
`)
})

/** console.error 的占位符/对象格式应与本地 console 接近，并带 level 前缀进入 server logger。 */
/**
 * 场景：在当前 playground 中，点击 “page.click('#test-console-error')”。
 * 验证目标：“normalizeLogs(serverLogs.slice(logIndex))” 应包含 “'[console.error] format: string=hello number=12.9 int=42 float=3.5 json={"id":1} object={"enabled":true}…”，从而确认浏览器 console/未处理异常被序列化到 server logger 且堆栈指向原源。
 */
test.runIf(isServe)('console.error', async () => {
  const logIndex = serverLogs.length
  await page.click('#test-console-error')
  await expect
    .poll(() => normalizeLogs(serverLogs.slice(logIndex)))
    .toContain(
      `[console.error] format: string=hello number=12.9 int=42 float=3.5 json={"id":1} object={"enabled":true} object2={"nested":{"deep":1}} style= literal=% trailing done`,
    )
})

/** 依赖外置 sourcemap 也要被提取；code frame 选择最近项目源码帧，不展开依赖文件。 */
/**
 * 场景：在当前 playground 中，点击 “page.click('#test-dep-error')”。
 * 验证目标：“normalizeLogs(serverLogs.slice(logIndex))” 应包含 “'\ [Unhandled error] Error: this is test dependency error > throwDepError ../../node_modules/.pnpm/<norm…”，从而确认浏览器 console/未处理异常被序列化到 server logger 且堆栈指向原源。
 */
test.runIf(isServe)('dependency stack uses source map path', async () => {
  const logIndex = serverLogs.length
  await page.click('#test-dep-error')
  await expect.poll(() => normalizeLogs(serverLogs.slice(logIndex)))
    .toContain(`\
[Unhandled error] Error: this is test dependency error
 > throwDepError ../../node_modules/.pnpm/<normalized>/node_modules/@vitejs/test-forward-console-throw-dep/index.js:2:8
 > testDepError src/main.ts:38:2
    36 |
    37 |  function testDepError() {
    38 |    throwDepError()
       |    ^
    39 |  }
    40 |
 > HTMLButtonElement.<anonymous> src/main.ts:22:2
`)
})
