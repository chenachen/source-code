/**
 * compiler-sfc 测试辅助：统一 parse/compileScript 参数，使用 Babel 校验生成语法，
 * 并提供 snapshot 与 source map token 定位。
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

/**
 * 解析完整 SFC，再以统一 mockId 编译脚本；options 的 id 会被固定值覆盖以稳定快照。
 * parse errors 只输出首项而不在此提前抛错，compileScript 随后按 descriptor 自身约束处理。
 * parseOptions 用于指定文件名、模板 parser 等，复现两个编译阶段共享的位置与 AST 状态。
 */
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

/**
 * 先用 Babel 的 TS/importAttributes 插件验证生成模块，再比较完整快照。
 * 解析失败先打印代码再重抛原异常；本辅助只检查语法与输出形状，不执行生成组件。
 */
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

/**
 * 找 token 首次出现的位置，以一基行号/零基列号返回 source-map 查询对象。
 * 用例须保证 token 存在；此函数不诊断未找到或同名多处，定位范围由测试选择的 token 决定。
 * expectName=true 使用 token 为预期符号名，字符串值则指定另一个名称，false 不附 name。
 */
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
