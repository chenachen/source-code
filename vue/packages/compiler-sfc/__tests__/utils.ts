/**
 * compiler-sfc 测试辅助：统一解析 SFC、编译 script setup、规范化生成代码并做语法断言；
 * mock 文件系统支持跨文件类型和 tsconfig 场景而不依赖真实项目目录。
 */
import {
  type SFCParseOptions,
  type SFCScriptBlock,
  type SFCScriptCompileOptions,
  compileScript,
  parse,
} from '../src'
import { parse as babelParse } from '@babel/parser'

/** 测试使用的稳定 SFC scope 哈希，避免生成代码随用例变化。 */
export const mockId = 'xxxxxxxx'

/** 解析完整 SFC 并用统一 mockId 编译 script block。 */
export function compileSFCScript(
  src: string,
  options?: Partial<SFCScriptCompileOptions>,
  parseOptions?: SFCParseOptions,
): SFCScriptBlock {
  const { descriptor, errors } = parse(src, parseOptions)
  if (errors.length) {
    console.warn(errors[0])
  }
  return compileScript(descriptor, {
    ...options,
    id: mockId,
  })
}

/** 先用 Babel 验证生成模块语法，再与对应快照比较。 */
export function assertCode(code: string): void {
  // 语法解析能比字符串快照更直接发现括号、分号或 TS 插件组合错误。
  try {
    babelParse(code, {
      sourceType: 'module',
      plugins: [
        'typescript',
        ['importAttributes', { deprecatedAssertSyntax: true }],
      ],
    })
  } catch (e: any) {
    console.log(code)
    throw e
  }
  expect(code).toMatchSnapshot()
}

/** source map 查询使用的生成代码位置及可选符号名。 */
interface Pos {
  /** 生成代码中的行号。 */
  line: number
  /** 生成代码中的列号。 */
  column: number
  /** source map 预期恢复的原符号名。 */
  name?: string
}

/** 定位生成代码中的 token，返回可直接传给 SourceMapConsumer 的行列对象。 */
export function getPositionInCode(
  code: string,
  token: string,
  expectName: string | boolean = false,
): Pos {
  const generatedOffset = code.indexOf(token)
  let line = 1
  let lastNewLinePos = -1
  for (let i = 0; i < generatedOffset; i++) {
    if (code.charCodeAt(i) === 10 /* 换行符字符码 */) {
      line++
      lastNewLinePos = i
    }
  }
  const res: Pos = {
    line,
    column:
      lastNewLinePos === -1
        ? generatedOffset
        : generatedOffset - lastNewLinePos - 1,
  }
  if (expectName) {
    res.name = typeof expectName === 'string' ? expectName : token
  }
  return res
}
