import path from 'node:path'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import type { EnvironmentModuleGraph } from '..'

let offset: number

/** 探测当前 Node `new Function` wrapper 在 stack 中额外贡献的行偏移。 */
function calculateOffsetOnce() {
  if (offset !== undefined) {
    return
  }

  try {
    // 与 ESModulesEvaluator 单独前置的 `"use strict";` 保持一致。
    new Function('"use strict";\nthrow new Error(1)')()
  } catch (e) {
    // Node 12 与 13+ 对函数 wrapper 的行号计算不同，运行时探测比硬编码版本可靠。
    const match = /:(\d+):\d+\)$/.exec(e.stack.split('\n')[1])
    offset = match ? +match[1] - 1 : 0
  }
}

/**
 * 逐帧查找模块图 transform sourcemap，把 evaluator 生成代码的位置还原到源码；
 * 同时标记疑似已被其他工具重写的帧，避免静默给出双重偏移结果。
 */
export function ssrRewriteStacktrace(
  stack: string,
  moduleGraph: EnvironmentModuleGraph,
): {
  /** 逐帧应用 Source Map 后的堆栈文本。 */
  result: string
  /** 是否发现行列已经越过 evaluator wrapper、疑似被其他工具先重写。 */
  alreadyRewritten: boolean
} {
  calculateOffsetOnce()

  let alreadyRewritten = false
  const rewritten = stack
    .split('\n')
    .map((line) => {
      return line.replace(
        /^ {4}at (?:(\S.*?)\s\()?(.+?):(\d+)(?::(\d+))?\)?/,
        (input, varName, id, originalLine, originalColumn) => {
          if (!id) return input

          const mod = moduleGraph.getModuleById(id)
          const rawSourceMap = mod?.transformResult?.map

          if (!rawSourceMap) {
            return input
          }

          const traced = new TraceMap(rawSourceMap as any)
          const line = Number(originalLine) - offset
          // stack 列号从 1 开始，sourcemap 查询列从 0 开始。
          const column = Number(originalColumn) - 1
          if (line <= 0 || column < 0) {
            alreadyRewritten = true
            return input
          }

          const pos = originalPositionFor(traced, { line, column })
          if (!pos.source) {
            return input
          }

          const trimmedVarName = varName?.trim()
          const sourceFile = path.resolve(path.dirname(id), pos.source)
          // 输出回 stack 时再把 sourcemap 的 0-based 列转回 1-based。
          const source = `${sourceFile}:${pos.line}:${pos.column + 1}`
          if (!trimmedVarName || trimmedVarName === 'eval') {
            return `    at ${source}`
          } else {
            return `    at ${trimmedVarName} (${source})`
          }
        },
      )
    })
    .join('\n')
  return { result: rewritten, alreadyRewritten }
}

/** 按 Error.stack 的属性描述符选择 redefine 或赋值，兼容只读/不可配置实现。 */
export function rebindErrorStacktrace(e: Error, stacktrace: string): void {
  const { configurable, writable } = Object.getOwnPropertyDescriptor(
    e,
    'stack',
  )!
  if (configurable) {
    Object.defineProperty(e, 'stack', {
      value: stacktrace,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  } else if (writable) {
    e.stack = stacktrace
  }
}

/** 记录已处理 Error，避免重复应用 Source Map 造成二次偏移。 */
const rewroteStacktraces = new WeakSet()

/** 对同一 Error 只执行一次 SSR sourcemap 栈重写。 */
export function ssrFixStacktrace(
  e: Error,
  moduleGraph: EnvironmentModuleGraph,
): void {
  if (!e.stack) return
  // 重复映射会把已是源码的位置再次当生成位置，导致错误行列。
  if (rewroteStacktraces.has(e)) return

  const { result: stacktrace, alreadyRewritten } = ssrRewriteStacktrace(
    e.stack,
    moduleGraph,
  )
  rebindErrorStacktrace(e, stacktrace)
  if (alreadyRewritten) {
    e.message +=
      ' (The stacktrace appears to be already rewritten by something else, but was passed to vite.ssrFixStacktrace. This may cause incorrect stacktraces.)'
  }

  rewroteStacktraces.add(e)
}
