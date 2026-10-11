/**
 * 模板表达式转换场景：验证自由标识符前缀、局部作用域、Babel 新语法、TS 语法和
 * bindingMetadata 快速路径；同时覆盖函数参数/解构/switch 等容易误判引用关系的结构。
 */
import {
  BindingTypes,
  type CompilerOptions,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  type InterpolationNode,
  NodeTypes,
  baseCompile,
  baseParse as parse,
  transform,
} from '../../src'
import { transformIf } from '../../src/transforms/vIf'
import { transformExpression } from '../../src/transforms/transformExpression'
import { PatchFlagNames, PatchFlags } from '../../../shared/src'

/**
 * 默认开启前缀，运行 if 与表达式转换后返回根的首 child，供断言插值内容或元素指令。
 * 此管线不安装元素 codegen；要检查完整生成代码的用例使用下方 baseCompile helper。
 */
function parseWithExpressionTransform(
  template: string,
  options: CompilerOptions = {},
) {
  const ast = parse(template, options)
  transform(ast, {
    prefixIdentifiers: true,
    nodeTransforms: [transformIf, transformExpression],
    ...options,
  })
  return ast.children[0]
}

/** 使用 prefixIdentifiers 编译表达式模板，供生成代码断言复用。 */
function compile(template: string) {
  return baseCompile(template, { prefixIdentifiers: true })
}

describe('compiler: expression transform', () => {
  /**
   * 根插值 foo；检查快速路径直接把简单表达式改为 _ctx.foo，无需构造复合节点。
   */
  test('interpolation (root)', () => {
    const node = parseWithExpressionTransform(`{{ foo }}`) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.foo`,
    })
  })

  /**
   * 分别编译无内容、仅空格和元素内空白插值；检查三处 content 都为空串，空文本提前返回，不添加前缀或语法诊断。
   */
  test('empty interpolation', () => {
    const node = parseWithExpressionTransform(`{{}}`) as InterpolationNode
    const node2 = parseWithExpressionTransform(`{{ }}`) as InterpolationNode
    const node3 = parseWithExpressionTransform(
      `<div>{{ }}</div>`,
    ) as ElementNode

    const objectToBeMatched = {
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: ``,
    }
    expect(node.content).toMatchObject(objectToBeMatched)
    expect(node2.content).toMatchObject(objectToBeMatched)
    expect((node3.children[0] as InterpolationNode).content).toMatchObject(
      objectToBeMatched,
    )
  })

  /**
   * div child 中插值 foo；检查递归遍历同样将表达式改为 _ctx.foo，根/子插值规则一致。
   */
  test('interpolation (children)', () => {
    const el = parseWithExpressionTransform(
      `<div>{{ foo }}</div>`,
    ) as ElementNode
    const node = el.children[0] as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.foo`,
    })
  })

  /**
   * 插值 foo + bar(baz.qux)；检查自由变量 foo/bar/baz 加前缀，静态成员 qux 保留，运算与调用片段按源码顺序拼接。
   */
  test('interpolation (complex)', () => {
    const el = parseWithExpressionTransform(
      `<div>{{ foo + bar(baz.qux) }}</div>`,
    ) as ElementNode
    const node = el.children[0] as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `_ctx.foo` },
        ` + `,
        { content: `_ctx.bar` },
        `(`,
        { content: `_ctx.baz` },
        `.`,
        { content: `qux` },
        `)`,
      ],
    })
  })

  /**
   * 自定义指令 v-foo:arg="baz"；检查静态参数 arg 不改写，值表达式 baz 改为 _ctx.baz。
   */
  test('directive value', () => {
    const node = parseWithExpressionTransform(
      `<div v-foo:arg="baz"/>`,
    ) as ElementNode
    const arg = (node.props[0] as DirectiveNode).arg!
    expect(arg).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `arg`,
    })
    const exp = (node.props[0] as DirectiveNode).exp!
    expect(exp).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.baz`,
    })
  })

  /**
   * 自定义指令动态参数 [arg] 与值 baz；检查两处都改为 _ctx 访问，动态参数与指令值独立处理。
   */
  test('dynamic directive arg', () => {
    const node = parseWithExpressionTransform(
      `<div v-foo:[arg]="baz"/>`,
    ) as ElementNode
    const arg = (node.props[0] as DirectiveNode).arg!
    expect(arg).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.arg`,
    })
    const exp = (node.props[0] as DirectiveNode).exp!
    expect(exp).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.baz`,
    })
  })

  /**
   * 插值调用 foo(baz+1,{key:kuz})；检查三自由变量的前缀及各自 loc，固定对象键 key 保留在原文本片段，拆分仍可定位每个名字。
   */
  test('should prefix complex expressions', () => {
    const node = parseWithExpressionTransform(
      `{{ foo(baz + 1, { key: kuz }) }}`,
    ) as InterpolationNode
    // 多个自由标识符应拆成可分别前缀化的复合表达式。
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        {
          content: `_ctx.foo`,
          loc: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 6, line: 1, column: 7 },
          },
        },
        `(`,
        {
          content: `_ctx.baz`,
          loc: {
            start: { offset: 7, line: 1, column: 8 },
            end: { offset: 10, line: 1, column: 11 },
          },
        },
        ` + 1, { key: `,
        {
          content: `_ctx.kuz`,
          loc: {
            start: { offset: 23, line: 1, column: 24 },
            end: { offset: 26, line: 1, column: 27 },
          },
        },
        ` })`,
      ],
    })
  })

  /**
   * 分别使用 Math.max 与 new Error；检查允许的全局名不加上下文前缀，成员/调用片段仍拆分以供生成和映射。
   */
  test('should not prefix whitelisted globals', () => {
    const node = parseWithExpressionTransform(
      `{{ Math.max(1, 2) }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [{ content: `Math` }, `.`, { content: `max` }, `(1, 2)`],
    })

    expect(
      (parseWithExpressionTransform(`{{ new Error() }}`) as InterpolationNode)
        .content,
    ).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: ['new ', { content: 'Error' }, '()'],
    })
  })

  /**
   * 逐个插值 true、false、null、this；检查都保持原简单文本，不从组件实例读取这些字面量/关键字。
   */
  test('should not prefix reserved literals', () => {
    /** 断言 JS 保留字/字面量保持简单表达式且不添加上下文前缀。 */
    function assert(exp: string) {
      const node = parseWithExpressionTransform(
        `{{ ${exp} }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: exp,
      })
    }
    assert(`true`)
    assert(`false`)
    assert(`null`)
    assert(`this`)
  })

  /**
   * 插值 function foo(){return bar}；检查函数声明名 foo 不加前缀，外部读取 bar 改为 _ctx.bar。
   */
  test('should not prefix id of a function declaration', () => {
    const node = parseWithExpressionTransform(
      `{{ function foo() { return bar } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `function `,
        { content: `foo` },
        `() { return `,
        { content: `_ctx.bar` },
        ` }`,
      ],
    })
  })

  /**
   * 箭头参数 foo 与函数体 foo+bar；检查 foo 的声明和读取保持局部，只有 bar 加前缀。
   */
  test('should not prefix params of a function expression', () => {
    const node = parseWithExpressionTransform(
      `{{ foo => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `foo` },
        ` => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  /**
   * 箭头参数 foo=baz；检查默认值 baz 和函数体自由量 bar 加前缀，foo 两处仍局部。
   */
  test('should prefix default value of a function expression param', () => {
    const node = parseWithExpressionTransform(
      `{{ (foo = baz) => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `(`,
        { content: `foo` },
        ` = `,
        { content: `_ctx.baz` },
        `) => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  /**
   * 箭头参数解构 {foo}；检查解构声明和函数体 foo 都不改写，bar 仍访问上下文。
   */
  test('should not prefix function param destructuring', () => {
    const node = parseWithExpressionTransform(
      `{{ ({ foo }) => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `({ `,
        { content: `foo` },
        ` }) => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  /**
   * 对象属性 a 的值是 foo=>foo，属性 b 的值是 foo；检查前者函数内保持局部，离开后 b 的 foo 改为 _ctx.foo，函数作用域不泄漏。
   */
  test('function params should not affect out of scope identifiers', () => {
    const node = parseWithExpressionTransform(
      `{{ { a: foo => foo, b: foo } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ a: `,
        { content: `foo` },
        ` => `,
        { content: `foo` },
        `, b: `,
        { content: `_ctx.foo` },
        ` }`,
      ],
    })
  })

  /**
   * 解构参数 {foo=bar}；检查默认值与函数体中的 bar 都加前缀，声明 foo 与其读取保持局部。
   */
  test('should prefix default value of function param destructuring', () => {
    const node = parseWithExpressionTransform(
      `{{ ({ foo = bar }) => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `({ `,
        { content: `foo` },
        ` = `,
        { content: `_ctx.bar` },
        ` }) => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  /**
   * 对象包含静态方法 foo 和属性 value；检查这两个 key 不加前缀，方法体调用 baz 与属性值 bar 才访问 _ctx。
   */
  test('should not prefix an object property key', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo() { baz() }, value: bar } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ foo() { `,
        { content: `_ctx.baz` },
        `() }, value: `,
        { content: `_ctx.bar` },
        ` }`,
      ],
    })
  })

  /**
   * 对象显式写 {foo:foo}；检查只改写 value，生成 {foo:_ctx.foo}，不把静态 key 当作第二个同范围引用。
   */
  test('should not duplicate object key with same name as value', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo: foo } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [`{ foo: `, { content: `_ctx.foo` }, ` }`],
    })
  })

  /**
   * 对象计算 key [foo] 与值 bar；检查两者均加前缀，计算 key 属于实际表达式读取。
   */
  test('should prefix a computed object property key', () => {
    const node = parseWithExpressionTransform(
      `{{ { [foo]: bar } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ [`,
        { content: `_ctx.foo` },
        `]: `,
        { content: `_ctx.bar` },
        ` }`,
      ],
    })
  })

  /**
   * 对象简写 {foo}；检查展开成 foo:_ctx.foo，保留静态键名，同时正确改写值引用。
   */
  test('should prefix object property shorthand value', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [`{ foo: `, { content: `_ctx.foo` }, ` }`],
    })
  })

  /**
   * 成员链 foo.bar.baz；检查只有根对象 foo 加前缀，bar/baz 作为静态属性名称保留。
   */
  test('should not prefix id in a member expression', () => {
    const node = parseWithExpressionTransform(
      `{{ foo.bar.baz }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `_ctx.foo` },
        `.`,
        { content: `bar` },
        `.`,
        { content: `baz` },
      ],
    })
  })

  /**
   * 计算成员 foo[bar][baz]；检查三名字均加前缀，计算属性名与根对象一样是自由变量读取。
   */
  test('should prefix computed id in a member expression', () => {
    const node = parseWithExpressionTransform(
      `{{ foo[bar][baz] }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `_ctx.foo` },
        `[`,
        { content: `_ctx.bar` },
        `][`,
        { content: '_ctx.baz' },
        `]`,
      ],
    })
  })

  /**
   * 插值语法为 a( 并使用收集式 onError；检查原 Babel 消息附加到编译表达式错误，parser 已标失败的 AST 防止后续重复解析。
   */
  test('should handle parse error', () => {
    const onError = vi.fn()
    parseWithExpressionTransform(`{{ a( }}`, { onError })
    expect(onError.mock.calls[0][0].message).toMatch(
      `Error parsing JavaScript expression: Unexpected token`,
    )
  })

  /**
   * 绑定值为 undefined 并带源码内注释；检查不报错，允许的全局 undefined 和 JS 注释不会误触发非法表达式。字符串内容按原样保留。
   */
  test('should not error', () => {
    const onError = vi.fn()
    parseWithExpressionTransform(
      `<p :id="undefined /* force override the id */"/>`,
      {
        onError,
      },
    )
    expect(onError).not.toHaveBeenCalled()
  })

  /**
   * 插值赋值 x=1；检查左侧也改为 _ctx.x，引用分析不能仅处理读值而漏掉写入目标。
   */
  test('should prefix in assignment', () => {
    const node = parseWithExpressionTransform(
      `{{ x = 1 }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [{ content: `_ctx.x` }, ` = 1`],
    })
  })

  /**
   * 对象/数组嵌套解构赋值 {x,y:[z]}=obj；检查 x 简写展开，x/z 写入目标及 obj 来源均改为上下文引用，属性 key y 保持静态。
   */
  test('should prefix in assignment pattern', () => {
    const node = parseWithExpressionTransform(
      `{{ { x, y: [z] } = obj }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ x: `,
        { content: `_ctx.x` },
        `, y: [`,
        { content: `_ctx.z` },
        `] } = `,
        { content: `_ctx.obj` },
      ],
    })
  })

  // #8295：浮点数字面量仍是编译期常量，不能因为含 `.` 被成员表达式路径误分类。
  /**
   * 插值数组 [1,2.1]；检查 CAN_STRINGIFY，浮点点号不使纯字面量数组失去静态能力。
   */
  test('should treat floating point number literals as constant', () => {
    const node = parseWithExpressionTransform(
      `{{ [1, 2.1] }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      constType: ConstantTypes.CAN_STRINGIFY,
    })
  })

  // #10807：字符串内容即使包含括号也仍是常量，不能由字符启发式提前放弃静态分析。
  /**
   * 插值静态对象字符串 ok()；检查 CAN_STRINGIFY，字符串内部括号不是调用语法。
   */
  test('should not bail constant on strings w/ ()', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo: 'ok()' } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      constType: ConstantTypes.CAN_STRINGIFY,
    })
  })

  /**
   * 插值 new Date().getFullYear()；检查两个相关标识符片段均 NOT_CONSTANT，允许的全局函数调用仍会产生运行时变化。
   */
  test('should bail constant for global identifiers w/ new or call expressions', () => {
    const node = parseWithExpressionTransform(
      `{{ new Date().getFullYear() }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      children: [
        'new ',
        { constType: ConstantTypes.NOT_CONSTANT },
        '().',
        { constType: ConstantTypes.NOT_CONSTANT },
        '()',
      ],
    })
  })

  /**
   * 事件函数内 for-in 声明 const x，循环后又调用 error(x)；检查循环内 log(x) 不加前缀，退出循环后改为 error(_ctx.x)。
   */
  test('should not prefix temp variable of for...in', () => {
    const { code } = compile(
      `<div @click="() => {
        for (const x in list) {
          log(x)
        }
        error(x)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.x)`)
    expect(code).toMatch(`error(_ctx.x)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 事件函数内 for-of 声明 const x；检查循环局部 x 与循环后自由 x 分别处理，快照核对整段代码。
   */
  test('should not prefix temp variable of for...of', () => {
    const { code } = compile(
      `<div @click="() => {
        for (const x of list) {
          log(x)
        }
        error(x)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.x)`)
    expect(code).toMatch(`error(_ctx.x)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 事件函数内普通 for 声明 let i；检查循环体 i 局部，循环后 error(i) 使用 _ctx.i，块级别名随 for 退出撤销。
   */
  test('should not prefix temp variable of for loop', () => {
    const { code } = compile(
      `<div @click="() => {
        for (let i = 0; i < list.length; i++) {
          log(i)
        }
        error(i)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.i)`)
    expect(code).toMatch(`error(_ctx.i)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 将普通 for 的 i 改为 var；检查循环体和循环后都不加前缀，直接 for 的 var 被登记到外层函数块。
   */
  test('should allow leak of var declarations in for loop', () => {
    const { code } = compile(
      `<div @click="() => {
        for (var i = 0; i < list.length; i++) {
          log(i)
        }
        error(i)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.i)`)
    expect(code).not.toMatch(`error(_ctx.i)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * catch 参数 err，catch 后再读取 err；检查 catch 内局部、外部 _ctx.err，异常参数作用域只覆盖 catch 子树。
   */
  test('should not prefix catch block param', () => {
    const { code } = compile(
      `<div @click="() => {
         try {} catch (err) { console.error(err) }
        console.log(err)
      }"/>`,
    )
    expect(code).not.toMatch(`console.error(_ctx.err)`)
    expect(code).toMatch(`console.log(_ctx.err)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * catch 参数嵌套解构出 length；检查内部 length 不加前缀，离开 catch 后改为 _ctx.length，解构提取须递归到叶子绑定。
   */
  test('should not prefix destructured catch block param', () => {
    const { code } = compile(
      `<div @click="() => {
        try {
          throw new Error('sup?')
        } catch ({ message: { length } }) {
          console.error(length)
        }
        console.log(length)
      }"/>`,
    )
    expect(code).not.toMatch(`console.error(_ctx.length)`)
    expect(code).toMatch(`console.log(_ctx.length)`)
    expect(code).toMatchSnapshot()
  })

  // 新语法分组：确认 Babel parser 插件能处理提案语法且标识符前缀仍准确。
  describe('ES Proposals support', () => {
    /**
     * 插值 BigInt 字面量 13000n；检查保持动态表达式节点文本，但 constType 为 CAN_STRINGIFY，isStatic 字符串标志与常量能力不同。
     */
    test('bigInt', () => {
      const node = parseWithExpressionTransform(
        `{{ 13000n }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `13000n`,
        isStatic: false,
        constType: ConstantTypes.CAN_STRINGIFY,
      })
    })

    /**
     * 插值 a??b；检查空值合并语法保留，两个自由读取都加前缀。
     */
    test('nullish coalescing', () => {
      const node = parseWithExpressionTransform(
        `{{ a ?? b }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [{ content: `_ctx.a` }, ` ?? `, { content: `_ctx.b` }],
      })
    })

    /**
     * 插值 a?.b?.c；检查仅 a 加前缀，可选访问符与静态成员 b/c 保留。
     */
    test('optional chaining', () => {
      const node = parseWithExpressionTransform(
        `{{ a?.b?.c }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `_ctx.a` },
          `?.`,
          { content: `b` },
          `?.`,
          { content: `c` },
        ],
      })
    })

    /**
     * 安装 minimal pipelineOperator 插件，插值 a |> uppercase；检查两自由变量均加前缀，额外语法插件与引用拆分共同生效。
     */
    test('Enabling additional plugins', () => {
      // 显式安装 minimal pipeline 插件，检查该语法中的输入与函数名仍被前缀化。
      const node = parseWithExpressionTransform(`{{ a |> uppercase }}`, {
        expressionPlugins: [
          [
            'pipelineOperator',
            {
              proposal: 'minimal',
            },
          ],
        ],
      }) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `_ctx.a` },
          ` |> `,
          { content: `_ctx.uppercase` },
        ],
      })
    })
  })

  // SFC 绑定元数据分组：根据 props/ref/let/const 来源生成最短且可写性正确的访问代码。
  describe('bindingMetadata', () => {
    /** 固定脚本来源 fixture：含 props、各类 setup 绑定、Options 状态及覆盖全局 isNaN 的 ref。 */
    const bindingMetadata = {
      props: BindingTypes.PROPS,
      setup: BindingTypes.SETUP_MAYBE_REF,
      setupConst: BindingTypes.SETUP_CONST,
      data: BindingTypes.DATA,
      options: BindingTypes.OPTIONS,
      reactive: BindingTypes.SETUP_REACTIVE_CONST,
      literal: BindingTypes.LITERAL_CONST,
      isNaN: BindingTypes.SETUP_REF,
    }

    /** 用固定 SFC bindingMetadata 编译，以比较 inline/non-inline 访问策略。 */
    function compileWithBindingMetadata(
      template: string,
      options?: CompilerOptions,
    ) {
      return baseCompile(template, {
        prefixIdentifiers: true,
        bindingMetadata,
        ...options,
      })
    }

    /**
     * 固定绑定元数据使用非 inline 模式；检查 props/setup/data/options 与覆盖全局 isNaN 分别走专用渲染参数，函数签名包含六个参数。
     */
    test('non-inline mode', () => {
      const { code } = compileWithBindingMetadata(
        `<div>{{ props }} {{ setup }} {{ data }} {{ options }} {{ isNaN }}</div>`,
      )
      expect(code).toMatch(`$props.props`)
      expect(code).toMatch(`$setup.setup`)
      expect(code).toMatch(`$setup.isNaN`)
      expect(code).toMatch(`$data.data`)
      expect(code).toMatch(`$options.options`)
      expect(code).toMatch(`_ctx, _cache, $props, $setup, $data, $options`)
      expect(code).toMatchSnapshot()
    })

    /**
     * 同一绑定元数据开启 inline；检查 props 用 __props、maybe-ref 用 unref、const 直接读、确定 ref 用 .value，data/options 未内联而仍走 _ctx。
     */
    test('inline mode', () => {
      const { code } = compileWithBindingMetadata(
        `<div>{{ props }} {{ setup }} {{ setupConst }} {{ data }} {{ options }} {{ isNaN }}</div>`,
        { inline: true },
      )
      expect(code).toMatch(`__props.props`)
      expect(code).toMatch(`_unref(setup)`)
      expect(code).toMatch(`_toDisplayString(setupConst)`)
      expect(code).toMatch(`_ctx.data`)
      expect(code).toMatch(`_ctx.options`)
      expect(code).toMatch(`isNaN.value`)
      expect(code).toMatchSnapshot()
    })

    /**
     * inline 插值 literal const；检查直接读取 literal 且没有 TEXT 标记，固定字面量无需运行时文本比较。
     */
    test('literal const handling', () => {
      const { code } = compileWithBindingMetadata(`<div>{{ literal }}</div>`, {
        inline: true,
      })
      expect(code).toMatch(`toDisplayString(literal)`)
      // #7973：字面量 const 不会变化，插值无需 TEXT patchFlag。
      expect(code).not.toMatch(
        `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`,
      )
    })

    /**
     * 非 inline 插值 literal const；检查通过 $setup.literal 读取，同样不生成 TEXT 标记。
     */
    test('literal const handling， non-inline mode', () => {
      const { code } = compileWithBindingMetadata(`<div>{{ literal }}</div>`)
      expect(code).toMatch(`toDisplayString($setup.literal)`)
      // #7973：非 inline 模式通过 $setup.literal 读取字面量 const，同样无需 TEXT patchFlag。
      expect(code).not.toMatch(
        `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`,
      )
    })

    /**
     * inline 插值 reactive const；检查仍有 TEXT 标记，绑定引用稳定不表示对象内部展示值固定。
     */
    test('reactive const handling', () => {
      const { code } = compileWithBindingMetadata(`<div>{{ reactive }}</div>`, {
        inline: true,
      })
      // #7973：reactive const 的引用稳定但内部值可变，仍必须保留 TEXT patchFlag。
      expect(code).toMatch(
        `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`,
      )
    })

    // #10754：单独改写赋值右侧时保留 await，再拼回原 async 函数；setup let 的 ref 分支仍须生成。
    /**
     * async 函数中向 setup let x 赋 await bar；检查生成 isRef(x) 的 .value 写入分支并保留原 await 右值，bar 是 setup const 直接读取。
     */
    test('await expression in right hand of assignment, inline mode', () => {
      const node = parseWithExpressionTransform(
        `{{ (async () => { x = await bar })() }}`,
        {
          inline: true,
          bindingMetadata: {
            x: BindingTypes.SETUP_LET,
            bar: BindingTypes.SETUP_CONST,
          },
        },
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          `(async () => { `,
          {
            content: `_isRef(x) ? x.value = await bar : x`,
          },
          ` = await `,
          {
            content: `bar`,
          },
          ` })()`,
        ],
      })
    })
  })

  // switch case 共享词法作用域，验证声明计数不会在相邻 case 间提前撤销或泄漏。
  describe('switch case variable declarations', () => {
    /**
     * switch case 无显式块，直接声明 const foo 并在模板串中读取；检查两处保留局部 foo，case 共享词法作用域的声明须提前登记。
     */
    test('should handle const declarations in switch case without braces', () => {
      const { code } = compile(
        `{{ (() => { switch (1) { case 1: const foo = "bar"; return \`\${foo}\`; } })() }}`,
      )

      expect(code).toMatch(`const foo = "bar";`)
      expect(code).toMatch(`return \`\${foo}\`;`)
      expect(code).not.toMatch(`_ctx.foo`)
    })

    /**
     * switch case 内有显式块并声明 foo；检查局部声明与读取都保持原名，已有块作用域路径继续成立。
     */
    test('should handle const declarations in switch case with braces (existing behavior)', () => {
      const { code } = compile(
        `{{ (() => {
          switch (true) {
            case true: {
              const foo = "bar";
              return \`\${foo}\`;
            }
          }
        })() }}`,
      )

      expect(code).toMatch(`const foo = "bar";`)
      expect(code).toMatch(`return \`\${foo}\`;`)
      expect(code).not.toMatch(`_ctx.foo`)
    })

    /**
     * switch 判别式 foo 与 case 测试/返回值 bar 均未声明；检查两者加 _ctx 前缀。测试标题虽称 local，实际验证的是自由引用，case 表达式不引入绑定。
     */
    test('should parse switch case test as local scoped variables', () => {
      const { code } = compile(
        `{{ (() => { switch (foo) { case bar: return \`\${bar}\`; } })() }}`,
      )

      expect(code).toMatch('_ctx.foo')
      expect(code).toMatch(`_ctx.bar`)
    })
  })
})
