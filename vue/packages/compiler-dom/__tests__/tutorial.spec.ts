/**
 * compiler-dom 手把手实验：用一条最小模板同时观察 Parse AST、Transform 账本、
 * 客户端代码生成和错误收集。对应教程：`share/vue/compiler/lab.html#lab-first`。
 */
import {
  ErrorCodes,
  NodeTypes,
  type CompilerError,
  type DirectiveNode,
  type ElementNode,
  type InterpolationNode,
} from '@vue/compiler-core'
import { compile, parse } from '../src'

/** 主实验模板：同时包含动态 prop、可缓存事件和动态文本三类更新协议。 */
const SOURCE =
  '<button :disabled="busy" @click="count++">Count: {{ count }}</button>'

describe('compiler guided tour', () => {
  /**
   * Given：模板包含一个动态 prop、一个不捕获局部变量的事件和一段插值。
   * When：以 module、标识符前缀、静态提升和事件缓存选项完整编译。
   * Then：AST 保留模板语义，根账本登记 helper/cache，代码携带 TEXT|PROPS 更新协议。
   *
   * 验证机制：同时断言 Parse AST、Transform 后 RootNode 与最终 code，避免只靠字符串快照。
   * 对应源码：compiler-core 的 `baseCompile()`、`transformElement()`、`generate()`。
   */
  test('trace parse, transform and generate in one run', () => {
    const errors: CompilerError[] = []
    // 单独解析一棵树，避免完整编译原地改写节点后丢失 Parse 阶段快照。
    const parsed = parse(SOURCE)
    const result = compile(SOURCE, {
      mode: 'module',
      prefixIdentifiers: true,
      hoistStatic: true,
      cacheHandlers: true,
      onError: error => errors.push(error),
    })

    const button = parsed.children[0] as ElementNode
    const disabled = button.props[0] as DirectiveNode
    const click = button.props[1] as DirectiveNode
    const interpolation = button.children[1] as InterpolationNode

    expect(errors).toEqual([])
    expect({
      rootType: parsed.type,
      tag: button.tag,
      propDirectives: button.props.map(prop =>
        prop.type === NodeTypes.DIRECTIVE ? prop.name : `attr:${prop.name}`,
      ),
      disabledArgument:
        disabled.arg?.type === NodeTypes.SIMPLE_EXPRESSION
          ? disabled.arg.content
          : undefined,
      disabledExpression:
        disabled.exp?.type === NodeTypes.SIMPLE_EXPRESSION
          ? disabled.exp.content
          : undefined,
      clickExpression:
        click.exp?.type === NodeTypes.SIMPLE_EXPRESSION
          ? click.exp.content
          : undefined,
      interpolationExpression:
        interpolation.content.type === NodeTypes.SIMPLE_EXPRESSION
          ? interpolation.content.content
          : undefined,
      helperCountAfterTransform: result.ast.helpers.size,
      cachedHandlerCountAfterTransform: result.ast.cached.length,
      hoistCountAfterTransform: result.ast.hoists.length,
    }).toEqual({
      rootType: NodeTypes.ROOT,
      tag: 'button',
      propDirectives: ['bind', 'on'],
      disabledArgument: 'disabled',
      disabledExpression: 'busy',
      clickExpression: 'count++',
      interpolationExpression: 'count',
      helperCountAfterTransform: 3,
      cachedHandlerCountAfterTransform: 1,
      hoistCountAfterTransform: 1,
    })

    expect(result.code).toContain('const _hoisted_1 = ["disabled"]')
    expect(result.code).toContain('disabled: _ctx.busy')
    expect(result.code).toContain(
      '_cache[0] || (_cache[0] = $event => (_ctx.count++))',
    )
    expect(result.code).toContain('_toDisplayString(_ctx.count)')
    expect(result.code).toContain('9 /* TEXT, PROPS */')

    // 按教程命令显式开启时打印真实产物；常规测试保持安静。
    if (process.env.VUE_COMPILER_TUTORIAL_TRACE === '1') {
      console.log(result.code)
    }
  })

  /**
   * Given：动态属性表达式在 `+` 后提前结束。
   * When：调用方用 `onError` 收集诊断，而不是采用默认抛错处理器。
   * Then：编译器返回可检查结果，并报告带源码位置的非法表达式错误。
   *
   * 验证机制：同时断言错误码、loc.source 与仍可读取的 code，证明错误回调改变的是
   * 中止策略，不会让诊断悄悄消失。
   * 对应源码：parser `createExp()` 的 Babel parse catch 分支。
   */
  test('collect a malformed expression without hiding the diagnostic', () => {
    const errors: CompilerError[] = []
    const result = compile('<div :id="user +"></div>', {
      mode: 'module',
      prefixIdentifiers: true,
      onError: error => errors.push(error),
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: ErrorCodes.X_INVALID_EXPRESSION,
      // parser 在表达式起点构造零长度诊断位置；原表达式仍保留在 AST 指令节点中。
      loc: { source: '', start: { offset: 10 } },
    })
    expect(result.code).toContain('export function render')
  })
})
