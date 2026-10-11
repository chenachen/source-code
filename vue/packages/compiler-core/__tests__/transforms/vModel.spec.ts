/**
 * 平台无关 `v-model` 场景：生成 modelValue、update 赋值处理器和组件 modifiers，
 * 检查前缀与缓存规则，并诊断不可写常量、作用域变量、props 和非法成员表达式。
 */
import {
  BindingTypes,
  type CompilerOptions,
  type ComponentNode,
  type ElementNode,
  type ForNode,
  NORMALIZE_PROPS,
  NodeTypes,
  type ObjectExpression,
  type PlainElementNode,
  type VNodeCall,
  generate,
  baseParse as parse,
  transform,
} from '../../src'
import { ErrorCodes } from '../../src/errors'
import { transformModel } from '../../src/transforms/vModel'
import { transformElement } from '../../src/transforms/transformElement'
import { transformExpression } from '../../src/transforms/transformExpression'
import { transformFor } from '../../src/transforms/vFor'
import { trackSlotScopes } from '../../src/transforms/vSlot'
import type { CallExpression } from '@babel/types'

/**
 * 运行 for、表达式、元素与插槽作用域转换，注册 core 的 model 协议并返回根 AST。
 * 此 fixture 不安装 DOM model 转换或 v-once，因此 input 仍生成 modelValue/update props；
 * 含 v-once 的用例只能检查这里的缓存数量，不能验证 transformOnce 设置的 inVOnce 分支。
 */
function parseWithVModel(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)

  transform(ast, {
    nodeTransforms: [
      transformFor,
      transformExpression,
      transformElement,
      trackSlotScopes,
    ],
    directiveTransforms: {
      ...options.directiveTransforms,
      model: transformModel,
    },
    ...options,
  })

  return ast
}

describe('compiler: transform v-model', () => {
  /**
   * 输入 input v-model="model"，只运行 core model 转换；检查 modelValue 与赋值监听器组成的两项 props，监听器向 model 写入 $event，并比对生成快照。
   */
  test('simple expression', () => {
    const root = parseWithVModel('<input v-model="model" />')
    const node = root.children[0] as ElementNode
    const props = ((node.codegenNode as VNodeCall).props as ObjectExpression)
      .properties

    expect(props[0]).toMatchObject({
      key: {
        content: 'modelValue',
        isStatic: true,
      },
      value: {
        content: 'model',
        isStatic: false,
      },
    })

    expect(props[1]).toMatchObject({
      key: {
        content: 'onUpdate:modelValue',
        isStatic: true,
      },
      value: {
        children: [
          '$event => ((',
          {
            content: 'model',
            isStatic: false,
          },
          ') = $event)',
        ],
      },
    })

    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 同一 model 绑定开启 prefixIdentifiers；值与赋值左侧均改为 _ctx.model，模块生成快照验证两处改写一致。
   */
  test('simple expression (with prefixIdentifiers)', () => {
    const root = parseWithVModel('<input v-model="model" />', {
      prefixIdentifiers: true,
    })
    const node = root.children[0] as ElementNode
    const props = ((node.codegenNode as VNodeCall).props as ObjectExpression)
      .properties

    expect(props[0]).toMatchObject({
      key: {
        content: 'modelValue',
        isStatic: true,
      },
      value: {
        content: '_ctx.model',
        isStatic: false,
      },
    })

    expect(props[1]).toMatchObject({
      key: {
        content: 'onUpdate:modelValue',
        isStatic: true,
      },
      value: {
        children: [
          '$event => ((',
          {
            content: '_ctx.model',
            isStatic: false,
          },
          ') = $event)',
        ],
      },
    })

    expect(generate(root, { mode: 'module' }).code).toMatchSnapshot()
  })

  // #2426：跨行成员表达式是合法 v-model 左值，空白/换行规范化不能把它误判为畸形表达式。
  /**
   * 将 model.foo 左值拆成多行；检查原表达式空白仍保留在值与赋值代码中，成员表达式识别允许跨行访问。
   */
  test('simple expression (with multilines)', () => {
    const root = parseWithVModel('<input v-model="\n model\n.\nfoo \n" />')
    const node = root.children[0] as ElementNode
    const props = ((node.codegenNode as VNodeCall).props as ObjectExpression)
      .properties

    expect(props[0]).toMatchObject({
      key: {
        content: 'modelValue',
        isStatic: true,
      },
      value: {
        content: '\n model\n.\nfoo \n',
        isStatic: false,
      },
    })

    expect(props[1]).toMatchObject({
      key: {
        content: 'onUpdate:modelValue',
        isStatic: true,
      },
      value: {
        children: [
          '$event => ((',
          {
            content: '\n model\n.\nfoo \n',
            isStatic: false,
          },
          ') = $event)',
        ],
      },
    })

    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 使用 model[index] 左值；检查读值与 update 监听器共享完整计算成员表达式，快照验证括号保持可赋值语法。
   */
  test('compound expression', () => {
    const root = parseWithVModel('<input v-model="model[index]" />')
    const node = root.children[0] as ElementNode
    const props = ((node.codegenNode as VNodeCall).props as ObjectExpression)
      .properties

    expect(props[0]).toMatchObject({
      key: {
        content: 'modelValue',
        isStatic: true,
      },
      value: {
        content: 'model[index]',
        isStatic: false,
      },
    })

    expect(props[1]).toMatchObject({
      key: {
        content: 'onUpdate:modelValue',
        isStatic: true,
      },
      value: {
        children: [
          '$event => ((',
          {
            content: 'model[index]',
            isStatic: false,
          },
          ') = $event)',
        ],
      },
    })

    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 对 model[index] 开启前缀；检查 model/index 分段改成 _ctx 访问，并由同一复合表达式生成赋值左侧。
   */
  test('compound expression (with prefixIdentifiers)', () => {
    const root = parseWithVModel('<input v-model="model[index]" />', {
      prefixIdentifiers: true,
    })
    const node = root.children[0] as ElementNode
    const props = ((node.codegenNode as VNodeCall).props as ObjectExpression)
      .properties

    expect(props[0]).toMatchObject({
      key: {
        content: 'modelValue',
        isStatic: true,
      },
      value: {
        children: [
          {
            content: '_ctx.model',
            isStatic: false,
          },
          '[',
          {
            content: '_ctx.index',
            isStatic: false,
          },
          ']',
        ],
      },
    })

    expect(props[1]).toMatchObject({
      key: {
        content: 'onUpdate:modelValue',
        isStatic: true,
      },
      value: {
        children: [
          '$event => ((',
          {
            children: [
              {
                content: '_ctx.model',
                isStatic: false,
              },
              '[',
              {
                content: '_ctx.index',
                isStatic: false,
              },
              ']',
            ],
          },
          ') = $event)',
        ],
      },
    })

    expect(generate(root, { mode: 'module' }).code).toMatchSnapshot()
  })

  /**
   * 具名模型 foo-value；检查值 prop 保留 foo-value，更新事件名驼峰化为 onUpdate:fooValue，赋值仍写回 model。
   */
  test('with argument', () => {
    const root = parseWithVModel('<input v-model:foo-value="model" />')
    const node = root.children[0] as ElementNode
    const props = ((node.codegenNode as VNodeCall).props as ObjectExpression)
      .properties
    expect(props[0]).toMatchObject({
      key: {
        content: 'foo-value',
        isStatic: true,
      },
      value: {
        content: 'model',
        isStatic: false,
      },
    })

    expect(props[1]).toMatchObject({
      key: {
        content: 'onUpdate:fooValue',
        isStatic: true,
      },
      value: {
        children: [
          '$event => ((',
          {
            content: 'model',
            isStatic: false,
          },
          ') = $event)',
        ],
      },
    })

    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 动态模型参数 [value]；检查动态值 key 与 "onUpdate:" 拼接 key 成对生成，整个 props 经 NORMALIZE_PROPS 包装。
   */
  test('with dynamic argument', () => {
    const root = parseWithVModel('<input v-model:[value]="model" />')
    const node = root.children[0] as ElementNode
    const props = (node.codegenNode as VNodeCall)
      .props as unknown as CallExpression

    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: 'value',
                isStatic: false,
              },
              value: {
                content: 'model',
                isStatic: false,
              },
            },
            {
              key: {
                children: [
                  '"onUpdate:" + ',
                  {
                    content: 'value',
                    isStatic: false,
                  },
                ],
              },
              value: {
                children: [
                  '$event => ((',
                  {
                    content: 'model',
                    isStatic: false,
                  },
                  ') = $event)',
                ],
              },
            },
          ],
        },
      ],
    })

    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 动态模型参数开启前缀；检查两处参数访问都为 _ctx.value，读值和更新目标都为 _ctx.model，再核对模块快照。
   */
  test('with dynamic argument (with prefixIdentifiers)', () => {
    const root = parseWithVModel('<input v-model:[value]="model" />', {
      prefixIdentifiers: true,
    })
    const node = root.children[0] as ElementNode
    const props = (node.codegenNode as VNodeCall)
      .props as unknown as CallExpression

    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: '_ctx.value',
                isStatic: false,
              },
              value: {
                content: '_ctx.model',
                isStatic: false,
              },
            },
            {
              key: {
                children: [
                  '"onUpdate:" + ',
                  {
                    content: '_ctx.value',
                    isStatic: false,
                  },
                ],
              },
              value: {
                children: [
                  '$event => ((',
                  {
                    content: '_ctx.model',
                    isStatic: false,
                  },
                  ') = $event)',
                ],
              },
            },
          ],
        },
      ],
    })

    expect(generate(root, { mode: 'module' }).code).toMatchSnapshot()
  })

  /**
   * 开启前缀与 cacheHandlers 绑定 foo；update 处理器进入一个 JS_CACHE_EXPRESSION，dynamicProps 只保留 modelValue，因为缓存函数引用稳定。
   */
  test('should cache update handler w/ cacheHandlers: true', () => {
    const root = parseWithVModel('<input v-model="foo" />', {
      prefixIdentifiers: true,
      cacheHandlers: true,
    })
    expect(root.cached.length).toBe(1)
    const codegen = (root.children[0] as PlainElementNode)
      .codegenNode as VNodeCall
    // 已缓存 handler 不应再列入 dynamicProps。
    expect(codegen.dynamicProps).toBe(`["modelValue"]`)
    expect((codegen.props as ObjectExpression).properties[1].value.type).toBe(
      NodeTypes.JS_CACHE_EXPRESSION,
    )
  })

  /**
   * 在 for 的 i 作用域内绑定 foo[i]；检查不分配缓存槽，dynamicProps 同时保留读值与更新事件。处理器捕获每轮 i，必须随迭代生成。
   */
  test('should not cache update handler if it refers v-for scope variables', () => {
    const root = parseWithVModel(
      '<input v-for="i in list" v-model="foo[i]" />',
      {
        prefixIdentifiers: true,
        cacheHandlers: true,
      },
    )
    expect(root.cached.length).toBe(0)
    const codegen = (
      (root.children[0] as ForNode).children[0] as PlainElementNode
    ).codegenNode as VNodeCall
    expect(codegen.dynamicProps).toBe(`["modelValue", "onUpdate:modelValue"]`)
    expect(
      (codegen.props as ObjectExpression).properties[1].value.type,
    ).not.toBe(NodeTypes.JS_CACHE_EXPRESSION)
  })

  /**
   * 模板外层写 v-once，内部绑定 foo，并开启 handler 缓存；这里只断言一个缓存槽。fixture 未安装 transformOnce，实际槽来自 update handler，未验证 inVOnce 下禁止额外缓存的分支。
   */
  test('should not cache update handler if it inside v-once', () => {
    const root = parseWithVModel('<div v-once><input v-model="foo" /></div>', {
      prefixIdentifiers: true,
      cacheHandlers: true,
    })
    expect(root.cached).not.toBe(2)
    expect(root.cached.length).toBe(1)
  })

  /**
   * 插槽参数 foo 的成员 foo.bar 用作模型；检查读值与 update 事件均列入 dynamicProps。槽内赋值处理器依赖提供者传来的局部 foo。
   */
  test('should mark update handler dynamic if it refers slot scope variables', () => {
    const root = parseWithVModel(
      '<Comp v-slot="{ foo }"><input v-model="foo.bar"/></Comp>',
      {
        prefixIdentifiers: true,
      },
    )
    const codegen = (
      (root.children[0] as ComponentNode).children[0] as PlainElementNode
    ).codegenNode as VNodeCall
    expect(codegen.dynamicProps).toBe(`["modelValue", "onUpdate:modelValue"]`)
  })

  /**
   * 组件模型带 trim 与 bar-baz 修饰符；检查 modelModifiers 对象含静态 true 项，短横线键加引号，且固定修饰符对象不列入 dynamicProps。
   */
  test('should generate modelModifiers for component v-model', () => {
    const root = parseWithVModel('<Comp v-model.trim.bar-baz="foo" />', {
      prefixIdentifiers: true,
    })
    const vnodeCall = (root.children[0] as ComponentNode)
      .codegenNode as VNodeCall
    // 组件 props。
    expect(vnodeCall.props).toMatchObject({
      properties: [
        { key: { content: `modelValue` } },
        { key: { content: `onUpdate:modelValue` } },
        {
          key: { content: 'modelModifiers' },
          value: {
            content: `{ trim: true, "bar-baz": true }`,
            isStatic: false,
          },
        },
      ],
    })
    // modelModifiers 是编译期固定对象，不能加入永不变化的 dynamicPropNames。
    expect(vnodeCall.dynamicProps).toBe(`["modelValue", "onUpdate:modelValue"]`)
  })

  /**
   * 组件同时使用 foo.trim 与 bar.number 两个具名模型；检查各自的值、update 事件和 Modifiers prop，dynamicProps 只包含会变化的值与监听器。
   */
  test('should generate modelModifiers for component v-model with arguments', () => {
    const root = parseWithVModel(
      '<Comp v-model:foo.trim="foo" v-model:bar.number="bar" />',
      {
        prefixIdentifiers: true,
      },
    )
    const vnodeCall = (root.children[0] as ComponentNode)
      .codegenNode as VNodeCall
    // 带参数模型生成的组件 props。
    expect(vnodeCall.props).toMatchObject({
      properties: [
        { key: { content: `foo` } },
        { key: { content: `onUpdate:foo` } },
        {
          key: { content: 'fooModifiers' },
          value: { content: `{ trim: true }`, isStatic: false },
        },
        { key: { content: `bar` } },
        { key: { content: `onUpdate:bar` } },
        {
          key: { content: 'barModifiers' },
          value: { content: `{ number: true }`, isStatic: false },
        },
      ],
    })
    // 具名 model 的 modifiers prop 同样固定，不参与动态属性 diff。
    expect(vnodeCall.dynamicProps).toBe(
      `["foo", "onUpdate:foo", "bar", "onUpdate:bar"]`,
    )
  })

  // 错误分组：目标必须可写，且不能是 props、const 或 v-for/v-slot 局部变量。
  describe('errors', () => {
    /**
     * 模型指令完全缺少表达式，使用返回式 onError；检查只报一次 X_V_MODEL_NO_EXPRESSION，转换以空 props 恢复。
     */
    test('missing expression', () => {
      const onError = vi.fn()
      parseWithVModel('<span v-model />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_MODEL_NO_EXPRESSION,
        }),
      )
    })

    /**
     * 模型表达式为空串；检查只报一次畸形表达式诊断，空文本不能作为赋值左侧。
     */
    test('empty expression', () => {
      const onError = vi.fn()
      parseWithVModel('<span v-model="" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 模型表达式为 a + b；检查畸形表达式诊断，因为二元运算结果不能赋值。
     */
    test('mal-formed expression', () => {
      const onError = vi.fn()
      parseWithVModel('<span v-model="a + b" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 模型左值使用中文成员 变.量；检查不报错，成员表达式校验须支持合法 Unicode 标识符。
     */
    test('allow unicode', () => {
      const onError = vi.fn()
      parseWithVModel('<span v-model="变.量" />', { onError })

      expect(onError).toHaveBeenCalledTimes(0)
    })

    /**
     * 直接把 for 的 i 别名用作模型，开启标识符前缀；检查作用域变量诊断，替换局部形参本身无法更新列表来源。
     */
    test('used on scope variable', () => {
      const onError = vi.fn()
      parseWithVModel('<span v-for="i in list" v-model="i" />', {
        onError,
        prefixIdentifiers: true,
      })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_MODEL_ON_SCOPE_VARIABLE,
        }),
      )
    })

    /**
     * 把 bindingMetadata 中的 PROPS 绑定 p 用作模型；检查 props 只读诊断，避免生成本地赋值监听器。
     */
    test('used on props', () => {
      const onError = vi.fn()
      parseWithVModel('<div v-model="p" />', {
        onError,
        bindingMetadata: {
          p: BindingTypes.PROPS,
        },
      })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_MODEL_ON_PROPS,
        }),
      )
    })

    /**
     * 把 LITERAL_CONST 绑定 c 用作模型；检查常量不可写诊断，转换不生成对常量的赋值。
     */
    test('used on const binding', () => {
      const onError = vi.fn()
      parseWithVModel('<div v-model="c" />', {
        onError,
        bindingMetadata: {
          c: BindingTypes.LITERAL_CONST,
        },
      })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_MODEL_ON_CONST,
        }),
      )
    })
  })
})
