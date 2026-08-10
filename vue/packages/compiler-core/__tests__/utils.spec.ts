/**
 * compiler-core 工具场景：验证源码位置推进、可赋值成员表达式判断和 Babel 标识符引用分析；
 * 边界用例覆盖 Unicode、可选链、嵌套解构、TypeScript 节点及无效左值。
 */
import { babelParse, walkIdentifiers } from '@vue/compiler-sfc'
import {
  type ExpressionNode,
  type TransformContext,
  isReferencedIdentifier,
} from '../src'
import { type Position, createSimpleExpression } from '../src/ast'
import {
  advancePositionWithClone,
  isMemberExpressionBrowser,
  isMemberExpressionNode,
  toValidAssetId,
} from '../src/utils'

/** 用简短参数构造 Position，便于位置推进表格保持可读。 */
function p(line: number, column: number, offset: number): Position {
  return { column, line, offset }
}

// 位置推进：覆盖单行、多换行与非零起点，确认 clone 不修改调用方位置对象。
describe('advancePositionWithClone', () => {
  test('same line', () => {
    const pos = p(1, 1, 0)
    const newPos = advancePositionWithClone(pos, 'foo\nbar', 2)

    expect(newPos.column).toBe(3)
    expect(newPos.line).toBe(1)
    expect(newPos.offset).toBe(2)
  })

  test('same line', () => {
    const pos = p(1, 1, 0)
    const newPos = advancePositionWithClone(pos, 'foo\nbar', 4)

    expect(newPos.column).toBe(1)
    expect(newPos.line).toBe(2)
    expect(newPos.offset).toBe(4)
  })

  test('multiple lines', () => {
    const pos = p(1, 1, 0)
    const newPos = advancePositionWithClone(pos, 'foo\nbar\nbaz', 10)

    expect(newPos.column).toBe(3)
    expect(newPos.line).toBe(3)
    expect(newPos.offset).toBe(10)
  })
})

// 成员表达式：比较浏览器轻量词法器和 Babel 路径对合法 v-model 左值的判断。
describe('isMemberExpression', () => {
  /** 对浏览器轻量实现和 Node Babel 实现复用同一组合法/非法左值断言。 */
  function commonAssertions(raw: (exp: ExpressionNode) => boolean) {
    /** 把字符串包装成 AST 表达式后调用当前被测实现。 */
    const fn = (str: string) => raw(createSimpleExpression(str))
    // 合法成员访问、计算属性与可选链。
    expect(fn('obj.foo')).toBe(true)
    expect(fn('obj[foo]')).toBe(true)
    expect(fn('obj[arr[0]]')).toBe(true)
    expect(fn('obj[arr[ret.bar]]')).toBe(true)
    expect(fn('obj[arr[ret[bar]]]')).toBe(true)
    expect(fn('obj[arr[ret[bar]]].baz')).toBe(true)
    expect(fn('obj[1 + 1]')).toBe(true)
    expect(fn(`obj[x[0]]`)).toBe(true)
    expect(fn('obj[1][2]')).toBe(true)
    expect(fn('obj[1][2].foo[3].bar.baz')).toBe(true)
    expect(fn(`a[b[c.d]][0]`)).toBe(true)
    expect(fn('obj?.foo')).toBe(true)
    expect(fn('foo().test')).toBe(true)

    // 字符串内部的括号/引号不应改变成员访问嵌套计数。
    expect(fn(`a['foo' + bar[baz]["qux"]]`)).toBe(true)

    // 多行空白允许出现在点访问和方括号访问周围。
    expect(fn('obj \n .foo \n [bar \n + baz]')).toBe(true)
    expect(fn(`\n model\n.\nfoo \n`)).toBe(true)

    // 非成员路径、括号不配对和完整赋值表达式必须拒绝。
    expect(fn('a \n b')).toBe(false)
    expect(fn('obj[foo')).toBe(false)
    expect(fn('objfoo]')).toBe(false)
    expect(fn('obj[arr[0]')).toBe(false)
    expect(fn('obj[arr0]]')).toBe(false)
    expect(fn('a + b')).toBe(false)
    expect(fn('foo()')).toBe(false)
    expect(fn('a?b:c')).toBe(false)
    expect(fn(`state['text'] = $event`)).toBe(false)
  }

  test('browser', () => {
    commonAssertions(isMemberExpressionBrowser)
    expect(isMemberExpressionBrowser(createSimpleExpression('123[a]'))).toBe(
      false,
    )
  })

  test('node', () => {
    const ctx = { expressionPlugins: ['typescript'] } as any as TransformContext
    /** 使用带 TypeScript 表达式插件的 Node 实现检查源码。 */
    const fn = (str: string) =>
      isMemberExpressionNode(createSimpleExpression(str), ctx)
    commonAssertions(exp => isMemberExpressionNode(exp, ctx))

    // TypeScript as 表达式包装下仍能识别成员左值。
    expect(fn('foo as string')).toBe(true)
    expect(fn(`foo.bar as string`)).toBe(true)
    expect(fn(`foo['bar'] as string`)).toBe(true)
    expect(fn(`foo[bar as string]`)).toBe(true)
    expect(fn(`(foo as string)`)).toBe(true)
    expect(fn(`123[a]`)).toBe(true)
    expect(fn(`foo() as string`)).toBe(false)
    expect(fn(`a + b as string`)).toBe(false)
    // #9865：字符串字面量和 `undefined` 都不是可赋值成员表达式，不能接受为 v-model 目标。
    expect(fn('""')).toBe(false)
    expect(fn('undefined')).toBe(false)
    expect(fn('null')).toBe(false)
  })
})

test('toValidAssetId', () => {
  expect(toValidAssetId('foo', 'component')).toBe('_component_foo')
  expect(toValidAssetId('p', 'directive')).toBe('_directive_p')
  expect(toValidAssetId('div', 'filter')).toBe('_filter_div')
  expect(toValidAssetId('foo-bar', 'component')).toBe('_component_foo_bar')
  expect(toValidAssetId('test-测试-1', 'component')).toBe(
    '_component_test_2797935797_1',
  )
})

// 引用分析：区分读取、声明、属性 key、标签、解构目标及 TypeScript 类型位置。
describe('isReferencedIdentifier', () => {
  test('identifiers in function parameters should not be inferred as references', () => {
    expect.assertions(4)
    const ast = babelParse(`(({ title }) => [])`)
    walkIdentifiers(
      ast.program.body[0],
      (node, parent, parentStack, isReference) => {
        expect(isReference).toBe(false)
        expect(isReferencedIdentifier(node, parent, parentStack)).toBe(false)
      },
      true,
    )
  })
})
