/**
 * compiler-core 工具场景：验证源码位置推进、成员路径识别、资源名编码和函数参数引用分析；
 * 路径包含可选链、嵌套计算属性、TypeScript 包装及非法表达式。
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
  /**
   * 从 Position(1,1,0) 消费 foo 换行 bar 的前两个代码单元；检查新位置仍在首行，column/offset 各增加 2。
   */
  test('same line', () => {
    const pos = p(1, 1, 0)
    const newPos = advancePositionWithClone(pos, 'foo\nbar', 2)

    expect(newPos.column).toBe(3)
    expect(newPos.line).toBe(1)
    expect(newPos.offset).toBe(2)
  })

  /**
   * 同一起点消费四个代码单元，包含 LF；检查位置到第二行首列，offset 为 4。换行后的列按最后一个 LF 重新计算。
   */
  test('same line', () => {
    const pos = p(1, 1, 0)
    const newPos = advancePositionWithClone(pos, 'foo\nbar', 4)

    expect(newPos.column).toBe(1)
    expect(newPos.line).toBe(2)
    expect(newPos.offset).toBe(4)
  })

  /**
   * 消费含两个 LF 的十个代码单元；检查位置到第三行第三列，offset 为 10，覆盖多换行的列重置。
   */
  test('multiple lines', () => {
    const pos = p(1, 1, 0)
    const newPos = advancePositionWithClone(pos, 'foo\nbar\nbaz', 10)

    expect(newPos.column).toBe(3)
    expect(newPos.line).toBe(3)
    expect(newPos.offset).toBe(10)
  })
})

// 成员表达式：比较浏览器词法器和 Babel 实现的路径识别结果，包括可选成员访问。
describe('isMemberExpression', () => {
  /** 复用路径识别断言；接受可选成员访问不等于证明该路径可直接作为赋值左侧。 */
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

  /**
   * 浏览器成员扫描复用全部合法/非法路径断言，并额外拒绝 123[a]；嵌套计算属性、字符串与换行允许，调用结束和不平衡括号拒绝。该扫描仅近似识别路径。
   */
  test('browser', () => {
    commonAssertions(isMemberExpressionBrowser)
    expect(isMemberExpressionBrowser(createSimpleExpression('123[a]'))).toBe(
      false,
    )
  })

  /**
   * Node 成员识别复用路径断言，再检查 TS as 包装、计算键及字面量边界；Babel 允许 123[a] 成员访问，但拒绝调用结果、二元式、空字符串、undefined/null。
   */
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

/**
 * 将 component/directive/filter 名编码为局部变量；检查短横线改下划线、中文字符改 UTF-16 十进制代码，同时保留资源类型前缀。
 */
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
  /**
   * 解析解构参数箭头函数并用 walkIdentifiers 检查 title；四次断言都视其为参数声明而非读取引用，isReferencedIdentifier 与 walker 的标志应一致。
   */
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
