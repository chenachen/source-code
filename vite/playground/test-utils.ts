// playground 浏览器端到端测试共用辅助；通过 `~utils` 导入，并复用 vitestSetup 的当前页面与临时目录。

import fs from 'node:fs'
import path from 'node:path'
import colors from 'css-color-names'
import type {
  ConsoleMessage,
  ElementHandle,
  Locator,
} from 'playwright-chromium'
import type { DepOptimizationMetadata, Manifest } from 'vite'
import { normalizePath } from 'vite'
import {
  fromComment,
  fromMapFileComment,
  removeComments,
} from 'convert-source-map'
import { expect } from 'vitest'
import type { ResultPromise as ExecaResultPromise } from 'execa'
import { isWindows, page, sourcemapSnapshot, testDir } from './vitestSetup'

export * from './vitestSetup'

/** 各 fixture 的固定 HTTP 端口；独立启动的测试服务需互不冲突，部分配置直接使用对应数字。 */
export const ports = {
  cli: 9510,
  'cli-module': 9511,
  json: 9512,
  'legacy/ssr': 9520,
  lib: 9521,
  'optimize-missing-deps': 9522,
  'legacy/client-and-ssr': 9523,
  'assets/encoded-base': 9554, // 对应 vite.config-encoded-base.js 中直接写入的端口。
  'assets/url-base': 9525, // 对应 vite.config-url-base.js 中直接写入的端口。
  ssr: 9600,
  'ssr-deps': 9601,
  'ssr-html': 9602,
  'ssr-noexternal': 9603,
  'ssr-pug': 9604,
  'ssr-wasm': 9608,
  'ssr-webworker': 9605,
  'proxy-bypass': 9606, // 对应 proxy-hmr/vite.config.js 中直接写入的端口。
  'proxy-bypass/non-existent-app': 9607, // 对应 proxy-hmr/other-app/vite.config.js 中直接写入的端口。
  'ssr-hmr': 9609, // 对应 hmr-ssr 的自定义服务端口。
  'proxy-hmr': 9616, // 对应 proxy-hmr/vite.config.js 中直接写入的端口。
  'proxy-hmr/other-app': 9617, // 对应 proxy-hmr/other-app/vite.config.js 中直接写入的端口。
  'ssr-conditions': 9620,
  'css/postcss-caching': 5005,
  'css/postcss-plugins-different-dir': 5006,
  'css/dynamic-import': 5007,
  'css/lightningcss-proxy': 5008,
  'backend-integration': 5009,
  'client-reload': 5010,
  'client-reload/hmr-port': 5011,
  'client-reload/cross-origin': 5012,
}
/** HTTP 服务之外单独监听的 HMR 端口；多 playground 并行时同样需互不冲突。 */
export const hmrPorts = {
  'optimize-missing-deps': 24680,
  ssr: 24681,
  'ssr-deps': 24682,
  'ssr-html': 24683,
  'ssr-noexternal': 24684,
  'ssr-pug': 24685,
  'ssr-wasm': 24691,
  'css/lightningcss-proxy': 24686,
  json: 24687,
  'ssr-conditions': 24688,
  'client-reload/hmr-port': 24689,
  'client-reload/cross-origin': 24690,
}

/** CSS 颜色表的反向索引，把浏览器 RGB 计算值转换成测试期望的命名颜色。 */
const hexToNameMap: Record<string, string> = {}
Object.keys(colors).forEach((color) => {
  hexToNameMap[colors[color]] = color
})

/** 把一个 RGB 整数分量转成至少两位的十六进制文本，供 rgbToHex 拼接。 */
function componentToHex(c: number): string {
  const hex = c.toString(16)
  return hex.length === 1 ? '0' + hex : hex
}

/** 解析浏览器的 rgb(r, g, b) 字符串；不匹配时返回 undefined，让调用者保留原计算值。 */
function rgbToHex(rgb: string): string | undefined {
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (match) {
    const [_, rs, gs, bs] = match
    return (
      '#' +
      componentToHex(parseInt(rs, 10)) +
      componentToHex(parseInt(gs, 10)) +
      componentToHex(parseInt(bs, 10))
    )
  }
  return undefined
}

/** 将选择器或 Locator 解析成当前 page 的 ElementHandle；选择器没有匹配元素时立即报错。 */
async function toEl(
  el: string | ElementHandle | Locator,
): Promise<ElementHandle> {
  if (typeof el === 'string') {
    const realEl = await page.$(el)
    if (realEl == null) {
      throw new Error(`Cannot find element: "${el}"`)
    }
    return realEl
  }
  if ('elementHandle' in el) {
    return el.elementHandle()
  }
  return el
}

/** 读取元素最终前景色，并尽量转换成命名颜色，使断言同时覆盖样式加载与层叠结果。 */
export async function getColor(
  el: string | ElementHandle | Locator,
): Promise<string> {
  el = await toEl(el)
  const rgb = await el.evaluate((el) => getComputedStyle(el as Element).color)
  return hexToNameMap[rgbToHex(rgb)] ?? rgb
}

/** 读取计算后的 background-image；浏览器已把相对资源 URL 解析为带主机与端口的地址。 */
export async function getBg(
  el: string | ElementHandle | Locator,
): Promise<string> {
  el = await toEl(el)
  return el.evaluate((el) => getComputedStyle(el as Element).backgroundImage)
}

/**
 * 按完整选择器查找 CSSStyleRule，返回规则原始 background-image，供产物 URL 断言使用。
 * getBg 读取计算值会补主机/端口；这里保留 CSS 中的原值。无法访问的跨源样式表被跳过。
 */
export async function getCssRuleBg(selector: string): Promise<string> {
  return page.evaluate((sel) => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === sel) {
            return rule.style.backgroundImage
          }
        }
      } catch (_e) {}
    }
  }, selector)
}

/** 读取元素最终背景色，优先转换为命名颜色；未知颜色保留浏览器原计算字符串。 */
export async function getBgColor(
  el: string | ElementHandle | Locator,
): Promise<string> {
  el = await toEl(el)
  const rgb = await el.evaluate(
    (el) => getComputedStyle(el as Element).backgroundColor,
  )
  return hexToNameMap[rgbToHex(rgb)] ?? rgb
}

/** 从当前 playground-temp 测试目录读取文本；缺省编码为 UTF-8。 */
export function readFile(filename: string, encoding?: BufferEncoding): string
/** encoding 显式为 null 时返回原始字节，供二进制 fixture 检查。 */
export function readFile(filename: string, encoding: null): Buffer
/** 按 testDir 解析路径并同步读取，文本/字节返回类型由编码参数决定。 */
export function readFile(
  filename: string,
  encoding?: BufferEncoding | null,
): Buffer | string {
  if (encoding === undefined) encoding = 'utf-8'
  return fs.readFileSync(path.resolve(testDir, filename), encoding)
}

/** 以 UTF-8 读改写临时 fixture；修改必须改变字节长度，才能被测试使用的 polling watcher 捕获。 */
export function editFile(
  filename: string,
  replacer: (content: string) => string,
): void
/** 以 Buffer 改写二进制 fixture，仍要求结果与原文件字节长度不同。 */
export function editFile(
  filename: string,
  encoding: null,
  replacer: (content: Buffer) => Buffer,
): void
/** 显式编码与 replacer 分离的改写形式，文本和 Buffer 均交由同一长度检查。 */
export function editFile(
  filename: string,
  encoding: BufferEncoding | null,
  replacer: ((content: Buffer) => Buffer) | ((content: string) => string),
): void
/**
 * 改写当前临时 fixture 并触发 watcher；同字节长度的替换在写盘前抛错，避免 polling 漏报。
 * 该函数只负责文件变化，调用者仍需用日志或 expect.poll 等待 HMR/重构建完成。
 */
export function editFile(
  filename: string,
  encodingOrReplacer: BufferEncoding | null | ((content: string) => string),
  maybeReplacer?: ((content: Buffer) => Buffer) | ((content: string) => string),
): void {
  filename = path.resolve(testDir, filename)
  const [encoding, replacer] = maybeReplacer
    ? [encodingOrReplacer as BufferEncoding | null, maybeReplacer]
    : ['utf-8' as const, encodingOrReplacer as (content: string) => string]
  const content: string | Buffer = fs.readFileSync(filename, encoding)
  const modified = (replacer as (content: string | Buffer) => string | Buffer)(
    content,
  )
  if (Buffer.byteLength(modified) === Buffer.byteLength(content)) {
    const e = new Error(
      `editFile("${filename}") did not change the file size. The polling ` +
        `watcher used in tests may miss same-length edits and cause flaky ` +
        `failures; change the edit so the file's byte length changes. See ` +
        `https://github.com/vitejs/vite/blob/main/CONTRIBUTING.md#test-env-and-helpers`,
    )
    Error.captureStackTrace(e, editFile)
    throw e
  }
  fs.writeFileSync(filename, modified)
}

/** 在当前临时 fixture 下递归创建父目录并写入新文件，供新增依赖或 glob/HMR 场景触发 watcher。 */
export function addFile(filename: string, content: string): void {
  const resolvedFilename = path.resolve(testDir, filename)
  fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true })
  fs.writeFileSync(resolvedFilename, content)
}

/** 删除当前临时 fixture 的指定文件，供 unlink、失效传播与 glob 候选移除用例使用。 */
export function removeFile(filename: string): void {
  fs.unlinkSync(path.resolve(testDir, filename))
}

/** 列出 dist 下指定子目录的 assets 文件名，让构建测试检查输出集合而非仅观察页面效果。 */
export function listAssets(base = ''): string[] {
  const assetsDir = path.join(testDir, 'dist', base, 'assets')
  return fs.readdirSync(assetsDir)
}

/**
 * 在 dist/base/assets 中匹配文件名并读取 UTF-8 内容；matchAll 时拼接全部匹配产物。
 * 输出目录或匹配文件不存在时返回 undefined，其他读取错误继续抛出。
 */
export function findAssetFile(
  match: string | RegExp,
  base = '',
  assets = 'assets',
  matchAll = false,
): string | undefined {
  const assetsDir = path.join(testDir, 'dist', base, assets)
  let files: string[]
  try {
    files = fs.readdirSync(assetsDir)
  } catch (e) {
    if (e.code === 'ENOENT') {
      return undefined
    }
    throw e
  }
  if (matchAll) {
    const matchedFiles = files.filter((file) => file.match(match))
    return matchedFiles.length
      ? matchedFiles
          .map((file) =>
            fs.readFileSync(path.resolve(assetsDir, file), 'utf-8'),
          )
          .join('')
      : undefined
  } else {
    const matchedFile = files.find((file) => file.match(match))
    return matchedFile
      ? fs.readFileSync(path.resolve(assetsDir, matchedFile), 'utf-8')
      : undefined
  }
}

/** 读取指定构建子目录的 .vite/manifest.json，供入口、资源和 chunk 映射断言使用。 */
export function readManifest(base = ''): Manifest {
  return JSON.parse(
    fs.readFileSync(
      path.join(testDir, 'dist', base, '.vite/manifest.json'),
      'utf-8',
    ),
  )
}

/** 读取指定 Environment 的 optimizer 元数据；client 使用 deps，其余使用 deps_<环境名>。 */
export function readDepOptimizationMetadata(
  environmentName = 'client',
): DepOptimizationMetadata {
  const suffix = environmentName === 'client' ? '' : `_${environmentName}`
  return JSON.parse(
    fs.readFileSync(
      path.join(testDir, `node_modules/.vite/deps${suffix}/_metadata.json`),
      'utf-8',
    ),
  )
}

/** 日志目标命中后执行的可等待断言回调；接收监听期间收集的完整 console 文本数组。 */
type UntilBrowserLogAfterCallback = (logs: string[]) => PromiseLike<void> | void

/** 先监听，再执行 operation；expectOrder 指定数组目标是否严格按接收顺序匹配。 */
export async function untilBrowserLogAfter(
  operation: () => any,
  target: string | RegExp | Array<string | RegExp>,
  expectOrder?: boolean,
  callback?: UntilBrowserLogAfterCallback,
): Promise<string[]>
/** 不显式传顺序标记时，数组目标允许乱序到达；命中后再执行可选断言回调。 */
export async function untilBrowserLogAfter(
  operation: () => any,
  target: string | RegExp | Array<string | RegExp>,
  callback?: UntilBrowserLogAfterCallback,
): Promise<string[]>
/** 在修改文件或点击之前建立日志监听，避免操作立即输出日志时错过事件，再等待目标与回调完成。 */
export async function untilBrowserLogAfter(
  operation: () => any,
  target: string | RegExp | Array<string | RegExp>,
  arg3?: boolean | UntilBrowserLogAfterCallback,
  arg4?: UntilBrowserLogAfterCallback,
): Promise<string[]> {
  const expectOrder = typeof arg3 === 'boolean' ? arg3 : false
  const callback = typeof arg3 === 'boolean' ? arg4 : arg3

  const promise = untilBrowserLog(target, expectOrder)
  await operation()
  const logs = await promise
  if (callback) {
    await callback(logs)
  }
  return logs
}

/**
 * 等待当前页面 console 命中目标；有序数组逐条断言，无序数组逐个移除已命中目标，超时为 5 秒。
 * 超时会卸载监听；成功只清计时器，监听仍留到 page 关闭，返回的 logs 也可能继续追加。
 */
async function untilBrowserLog(
  target?: string | RegExp | Array<string | RegExp>,
  expectOrder = true,
): Promise<string[]> {
  const { promise, resolve, reject } = promiseWithResolvers<void>()
  let timeoutId: ReturnType<typeof setTimeout>

  const logs = []

  try {
    /** 为单目标和无序目标生成精确字符串/正则匹配器。 */
    const isMatch = (matcher: string | RegExp) => (text: string) =>
      typeof matcher === 'string' ? text === matcher : matcher.test(text)

    let processMsg: (text: string) => boolean

    if (!target) {
      processMsg = () => true
    } else if (Array.isArray(target)) {
      if (expectOrder) {
        const remainingTargets = [...target]
        processMsg = (text: string) => {
          const nextTarget = remainingTargets.shift()
          expect(text).toMatch(nextTarget)
          return remainingTargets.length === 0
        }
      } else {
        const remainingMatchers = target.map(isMatch)
        processMsg = (text: string) => {
          const nextIndex = remainingMatchers.findIndex((matcher) =>
            matcher(text),
          )
          if (nextIndex >= 0) {
            remainingMatchers.splice(nextIndex, 1)
          }
          return remainingMatchers.length === 0
        }
      }
    } else {
      processMsg = isMatch(target)
    }

    /** 收集每条 console 文本并推进目标匹配；断言失败使等待 Promise 拒绝。 */
    const handleMsg = (msg: ConsoleMessage) => {
      try {
        const text = msg.text()
        logs.push(text)
        const done = processMsg(text)
        if (done) {
          resolve()
        }
      } catch (err) {
        reject(err)
      }
    }

    timeoutId = setTimeout(() => {
      const nextTarget = Array.isArray(target)
        ? expectOrder
          ? target[0]
          : target.join(', ')
        : target
      reject(
        new Error(
          `Timeout waiting for browser logs. Waiting for: ${nextTarget}`,
        ),
      )
      page.off('console', handleMsg)
    }, 5000)

    page.on('console', handleMsg)
  } catch (err) {
    reject(err)
  }

  await promise
  clearTimeout(timeoutId)

  return logs
}

/** 从代码最后一行解析内联 Source Map；外置 map 需使用带 read 回调的重载。 */
export function extractSourcemap(content: string): any
/** 按最后一行的外置 map 注释异步读取并解析；传 read 时不接受 data: 内联 map。 */
export function extractSourcemap(
  content: string,
  read: (filename: string) => Promise<string>,
): Promise<any>
/** 按是否提供 read 回调区分外置/内联 Source Map，并返回转换库解析出的原始对象。 */
export function extractSourcemap(
  content: string,
  read?: (filename: string) => Promise<string>,
): any {
  const lines = content.trim().split('\n')
  const lastLine = lines[lines.length - 1]
  if (read) {
    const result = fromMapFileComment(lastLine, async (url) => {
      if (url.startsWith('data:')) {
        throw new Error(`Omit read argument when sourcemap is inline`)
      }
      const content = await read(url)
      return content
    })
    return result.then((r) => r.toObject())
  }
  return fromComment(lastLine).toObject()
}

/**
 * 归一化路径、debugId 和 optimizer hash，并排序/清理 map 字段，使快照不依赖机器或单次构建。
 * withoutContent 只传给 serializer 控制快照正文；可视化链接仍使用保留 sourcesContent 的 map。
 */
export const formatSourcemapForSnapshot = (
  map: any,
  code: string,
  withoutContent = false,
): any => {
  const root = normalizePath(testDir)
  const m = { ...map }
  delete m.file
  if (m.names && m.names.length === 0) {
    delete m.names
  }
  if (m.ignoreList && m.ignoreList.length === 0) {
    delete m.ignoreList
  }
  if (m.debugId) {
    m.debugId = '00000000-0000-0000-0000-000000000000'
  }
  m.sources = m.sources.map((source) => source.replace(root, '/root'))
  if (m.sourceRoot) {
    m.sourceRoot = m.sourceRoot.replace(root, '/root')
  }
  const normalized = Object.fromEntries(
    Object.keys(m)
      .filter((key) => m[key] !== null)
      .sort()
      .map((key) => [key, m[key]]),
  )
  const c = removeComments(code.replace(/\?v=[\da-f]{8}/g, '?v=00000000'))
  return { map: normalized, code: c, [sourcemapSnapshot]: { withoutContent } }
}

/** 停止测试启动的子进程；Windows 用 taskkill /T 终止进程树，其余平台向进程发送 SIGTERM。 */
export async function killProcess(
  serverProcess: ExecaResultPromise,
): Promise<void> {
  if (isWindows) {
    try {
      const { execaCommandSync } = await import('execa')
      execaCommandSync(`taskkill /pid ${serverProcess.pid} /T /F`)
    } catch (e) {
      console.error('failed to taskkill:', e)
    }
  } else {
    serverProcess.kill('SIGTERM')
  }
}

/** 将 Promise 与外部可调用的完成/拒绝入口一起返回，用于日志或构建事件驱动的等待。 */
export interface PromiseWithResolvers<T> {
  /** 调用方等待的结果 Promise。 */
  promise: Promise<T>
  /** 提交值或可等待值，使结果 Promise 完成。 */
  resolve: (value: T | PromiseLike<T>) => void
  /** 以指定原因拒绝结果 Promise。 */
  reject: (reason?: any) => void
}
/** 创建可由事件监听器从外部 resolve/reject 的 Promise，供当前 Node 目标兼容使用。 */
export function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve: any
  let reject: any
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}
