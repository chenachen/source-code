/**
 * `v-on` 场景：覆盖静态/动态事件名、内联语句、成员/函数表达式、修饰符空处理器
 * 与 handler 缓存，重点检查作用域捕获、函数形参和多个语句的包装。
 */
import {
  type CompilerOptions,
  type ElementNode,
  ErrorCodes,
  NodeTypes,
  type ObjectExpression,
  TO_HANDLER_KEY,
  type VNodeCall,
  helperNameMap,
  baseParse as parse,
  transform,
} from '../../src'
import { transformFor } from '../../src/transforms/vFor'
import { transformOn } from '../../src/transforms/vOn'
import { transformElement } from '../../src/transforms/transformElement'
import { transformExpression } from '../../src/transforms/transformExpression'

/**
 * 解析并运行表达式、元素和 for 转换，注册 core 的 on 转换，返回根与首个模板子节点。
 * fixture 不安装 compiler-dom 的修饰符 augmentor，也不安装 transformOnce；
 * 所以修饰符用例只检查 core 的诊断/空函数规则，v-once 用例不能验证 inVOnce 的抑制分支。
 */
function parseWithVOn(template: string, options: CompilerOptions = {}) {
  const ast = parse(template, options)
  transform(ast, {
    nodeTransforms: [transformExpression, transformElement, transformFor],
    directiveTransforms: {
      on: transformOn,
    },
    ...options,
  })
  return {
    root: ast,
    node: ast.children[0] as ElementNode,
  }
}

describe('compiler: transform v-on', () => {
  /**
   * 将 v-on:click="onClick" 转为静态 onClick key 和成员处理器；分别检查事件参数和值的 loc，验证生成属性保留来源位置。
   */
  test('basic', () => {
    const { node } = parseWithVOn(`<div v-on:click="onClick"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: {
            content: `onClick`,
            isStatic: true,
            loc: {
              start: {
                line: 1,
                column: 11,
              },
              end: {
                line: 1,
                column: 16,
              },
            },
          },
          value: {
            content: `onClick`,
            isStatic: false,
            loc: {
              start: {
                line: 1,
                column: 18,
              },
              end: {
                line: 1,
                column: 25,
              },
            },
          },
        },
      ],
    })
  })

  /**
   * 事件参数改为 [event]；检查 key 用 TO_HANDLER_KEY(event) 构造，成员处理器 handler 直接保留。
   */
  test('dynamic arg', () => {
    const { node } = parseWithVOn(`<div v-on:[event]="handler"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              `_${helperNameMap[TO_HANDLER_KEY]}(`,
              { content: `event` },
              `)`,
            ],
          },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `handler`,
            isStatic: false,
          },
        },
      ],
    })
  })

  /**
   * 动态事件与处理器开启前缀；检查 TO_HANDLER_KEY 的参数为 _ctx.event，value 为 _ctx.handler。
   */
  test('dynamic arg with prefixing', () => {
    const { node } = parseWithVOn(`<div v-on:[event]="handler"/>`, {
      prefixIdentifiers: true,
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              `_${helperNameMap[TO_HANDLER_KEY]}(`,
              { content: `_ctx.event` },
              `)`,
            ],
          },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `_ctx.handler`,
            isStatic: false,
          },
        },
      ],
    })
  })

  /**
   * 动态事件名使用 event(foo)；检查复合 key 保留调用片段且 event/foo 均加前缀，再由 TO_HANDLER_KEY 统一生成事件 key。
   */
  test('dynamic arg with complex exp prefixing', () => {
    const { node } = parseWithVOn(`<div v-on:[event(foo)]="handler"/>`, {
      prefixIdentifiers: true,
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              `_${helperNameMap[TO_HANDLER_KEY]}(`,
              { content: `_ctx.event` },
              `(`,
              { content: `_ctx.foo` },
              `)`,
              `)`,
            ],
          },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `_ctx.handler`,
            isStatic: false,
          },
        },
      ],
    })
  })

  /**
   * click 处理器是 i++ 内联语句；检查包装为 $event 箭头函数，避免渲染时提前执行自增。
   */
  test('should wrap as function if expression is inline statement', () => {
    const { node } = parseWithVOn(`<div @click="i++"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [`$event => (`, { content: `i++` }, `)`],
          },
        },
      ],
    })
  })

  /**
   * click 处理器为 foo();bar()；检查生成函数块而非表达式括号，多语句按顺序在事件触发时执行且不返回最后结果。
   */
  test('should handle multiple inline statement', () => {
    const { node } = parseWithVOn(`<div @click="foo();bar()"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            // 多条语句必须用函数块 `{}` 包裹；返回值被丢弃，与 Vue 2 行为一致。
            children: [`$event => {`, { content: `foo();bar()` }, `}`],
          },
        },
      ],
    })
  })

  /**
   * 将两条语句拆成多行；检查换行文本保留在生成函数块中。本例未启用前缀，覆盖原文本的多语句包装。
   */
  test('should handle multi-line statement', () => {
    const { node } = parseWithVOn(`<div @click="\nfoo();\nbar()\n"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            // 此处未启用 prefixIdentifiers；换行仍按多语句函数块生成，返回值被丢弃。
            children: [`$event => {`, { content: `\nfoo();\nbar()\n` }, `}`],
          },
        },
      ],
    })
  })

  /**
   * 内联 foo($event) 开启前缀；foo 改为 _ctx.foo，$event 临时登记为函数局部参数，不能添加上下文前缀。
   */
  test('inline statement w/ prefixIdentifiers: true', () => {
    const { node } = parseWithVOn(`<div @click="foo($event)"/>`, {
      prefixIdentifiers: true,
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              `$event => (`,
              {
                type: NodeTypes.COMPOUND_EXPRESSION,
                children: [
                  { content: `_ctx.foo` },
                  `(`,
                  // `$event` 是处理器形参，不得加 `_ctx.`。
                  { content: `$event` },
                  `)`,
                ],
              },
              `)`,
            ],
          },
        },
      ],
    })
  })

  /**
   * 多语句 foo($event);bar() 开启前缀；检查函数块内 foo/bar 加前缀、$event 保持局部变量，分号顺序保留。
   */
  test('multiple inline statements w/ prefixIdentifiers: true', () => {
    const { node } = parseWithVOn(`<div @click="foo($event);bar()"/>`, {
      prefixIdentifiers: true,
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              `$event => {`,
              {
                children: [
                  { content: `_ctx.foo` },
                  `(`,
                  // 多语句处理器中的 `$event` 仍是生成函数的形参，不加 `_ctx.`。
                  { content: `$event` },
                  `);`,
                  { content: `_ctx.bar` },
                  `()`,
                ],
              },
              `}`,
            ],
          },
        },
      ],
    })
  })

  /**
   * 处理器已是 $event => foo($event) 箭头函数；检查保留原表达式，不再添加第二层事件包装。
   */
  test('should NOT wrap as function if expression is already function expression', () => {
    const { node } = parseWithVOn(`<div @click="$event => foo($event)"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `$event => foo($event)`,
          },
        },
      ],
    })
  })

  /**
   * 分别输入带返回类型与联合类型数组参数的 TS 箭头函数；两种文本都识别为函数表达式并直接保留，括号类型不能误判为内联调用。
   */
  test('should NOT wrap as function if expression is already function expression (with TypeScript)', () => {
    const { node } = parseWithVOn(`<div @click="(e: any): any => foo(e)"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `(e: any): any => foo(e)`,
          },
        },
      ],
    })

    const { node: node2 } = parseWithVOn(
      `<div @click="(e: (number | string)[]) => foo(e)"/>`,
    )
    expect((node2.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `(e: (number | string)[]) => foo(e)`,
          },
        },
      ],
    })
  })

  /**
   * 处理器为 async $event => await foo($event)；检查保留异步箭头表达式，不添加额外 $event 包装。
   */
  test('should NOT wrap as function if expression is already function expression (async)', () => {
    const { node } = parseWithVOn(
      `<div @click="async $event => await foo($event)"/>`,
    )
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `async $event => await foo($event)`,
          },
        },
      ],
    })
  })

  /**
   * 箭头函数的参数、块体跨多行；检查完整文本保持为函数表达式，函数识别允许首尾空白与换行。
   */
  test('should NOT wrap as function if expression is already function expression (with newlines)', () => {
    const { node } = parseWithVOn(
      `<div @click="
      $event => {
        foo($event)
      }
    "/>`,
    )
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `
      $event => {
        foo($event)
      }
    `,
          },
        },
      ],
    })
  })

  /**
   * function 关键字函数跨多行；检查文本直接保留，函数识别同时覆盖普通函数语法。
   */
  test('should NOT wrap as function if expression is already function expression (with newlines + function keyword)', () => {
    const { node } = parseWithVOn(
      `<div @click="
      function($event) {
        foo($event)
      }
    "/>`,
    )
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `
      function($event) {
        foo($event)
      }
    `,
          },
        },
      ],
    })
  })

  /**
   * 处理器为 a['b' + c] 计算成员；检查直接保留成员引用，读取处理器不等于执行内联语句。
   */
  test('should NOT wrap as function if expression is complex member expression', () => {
    const { node } = parseWithVOn(`<div @click="a['b' + c]"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `a['b' + c]`,
          },
        },
      ],
    })
  })

  /**
   * 计算成员 a['b' + c] 开启前缀；检查仅 a/c 改为 _ctx 访问，字符串键片段保持字面量。
   */
  test('complex member expression w/ prefixIdentifiers: true', () => {
    const { node } = parseWithVOn(`<div @click="a['b' + c]"/>`, {
      prefixIdentifiers: true,
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              { content: `_ctx.a` },
              `['b' + `,
              { content: `_ctx.c` },
              `]`,
            ],
          },
        },
      ],
    })
  })

  /**
   * 函数表达式 e => foo(e) 开启前缀；检查 e 是局部形参，两处均不加前缀，只有 foo 改为 _ctx.foo。
   */
  test('function expression w/ prefixIdentifiers: true', () => {
    const { node } = parseWithVOn(`<div @click="e => foo(e)"/>`, {
      prefixIdentifiers: true,
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              { content: `e` },
              ` => `,
              { content: `_ctx.foo` },
              `(`,
              { content: `e` },
              `)`,
            ],
          },
        },
      ],
    })
  })

  /**
   * click 指令既没有表达式也没有修饰符；检查缺失表达式诊断覆盖整个指令范围。返回式 onError 允许 core 继续构造空函数。
   */
  test('should error if no expression AND no modifier', () => {
    const onError = vi.fn()
    parseWithVOn(`<div v-on:click />`, { onError })
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: ErrorCodes.X_V_ON_NO_EXPRESSION,
      loc: {
        start: {
          line: 1,
          column: 6,
        },
        end: {
          line: 1,
          column: 16,
        },
      },
    })
  })

  /**
   * click.prevent 缺少表达式；检查 core 不报错，修饰符允许仅执行平台行为的空处理器。fixture 不验证 preventDefault 包装。
   */
  test('should NOT error if no expression but has modifier', () => {
    const onError = vi.fn()
    parseWithVOn(`<div v-on:click.prevent />`, { onError })
    expect(onError).not.toHaveBeenCalled()
  })

  /**
   * 静态事件名为 foo-bar；检查驼峰化为 onFooBar，成员处理器 onMount 保持原值。
   */
  test('case conversion for kebab-case events', () => {
    const { node } = parseWithVOn(`<div v-on:foo-bar="onMount"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: {
            content: `onFooBar`,
          },
          value: {
            content: `onMount`,
          },
        },
      ],
    })
  })

  /**
   * 事件名使用旧 vnode-mounted hook 拼写；检查开发诊断 X_VNODE_HOOKS 定位事件参数，引导使用 vue: 前缀语法。
   */
  test('error for vnode hooks', () => {
    const onError = vi.fn()
    parseWithVOn(`<div v-on:vnode-mounted="onMount"/>`, { onError })
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: ErrorCodes.X_VNODE_HOOKS,
      loc: {
        start: {
          line: 1,
          column: 11,
        },
        end: {
          line: 1,
          column: 24,
        },
      },
    })
  })

  /**
   * 同时输入 vue:mounted 与 vue:before-update；检查两者生成 onVnodeMounted/onVnodeBeforeUpdate，沿用 VNode hook 的事件协议。
   */
  test('vue: prefixed events', () => {
    const { node } = parseWithVOn(
      `<div v-on:vue:mounted="onMount" @vue:before-update="onBeforeUpdate" />`,
    )
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: {
            content: `onVnodeMounted`,
          },
          value: {
            content: `onMount`,
          },
        },
        {
          key: {
            content: `onVnodeBeforeUpdate`,
          },
          value: {
            content: `onBeforeUpdate`,
          },
        },
      ],
    })
  })

  // handler 缓存：只缓存不捕获模板局部量的安全函数，并保持组件成员方法调用语义。
  describe('cacheHandler', () => {
    /**
     * click.prevent 空处理器开启缓存；检查一个槽保存 () => {}，VNode 无事件动态 patchFlag，因为函数引用可复用。
     */
    test('empty handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click.prevent />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 缓存后的 handler 引用稳定，不是 dynamicProp，因此无需 patchFlag。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `() => {}`,
        },
      })
    })

    /**
     * 成员处理器 foo 开启缓存；检查缓存的是剩余参数透传包装器，每次事件重新读取 _ctx.foo 并判空，避免固定首次函数引用。
     */
    test('member expression handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click="foo" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 缓存成员处理器后同样无需事件动态标志。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [
            `(...args) => (`,
            { content: `_ctx.foo && _ctx.foo(...args)` },
            `)`,
          ],
        },
      })
    })

    /**
     * 成员处理器 foo.bar 开启缓存；检查包装器保留对象成员调用和判空，缓存引用稳定，因此不产生事件动态 patchFlag。
     */
    test('compound member expression handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click="foo.bar" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 缓存成员访问的透传包装器保持稳定引用，不参与动态 props diff。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [
            `(...args) => (`,
            {
              children: [
                { content: `_ctx.foo` },
                `.`,
                { content: `bar` },
                ` && `,
                { content: `_ctx.foo` },
                `.`,
                { content: `bar` },
                `(...args)`,
              ],
            },
            `)`,
          ],
        },
      })
    })

    /**
     * 通过 isNativeTag 将 comp 识别为组件，其处理器是 foo 成员引用；检查没有缓存槽，保留组件回调的函数 arity。
     */
    test('bail on component member expression handler', () => {
      const { root } = parseWithVOn(`<comp v-on:click="foo" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
        isNativeTag: tag => tag === 'div',
      })
      expect(root.cached.length).toBe(0)
    })

    /**
     * 外层标记 v-once，内层 click 使用 foo 并开启 handler 缓存；检查一个槽。fixture 未安装 transformOnce，该槽来自 handler，未验证 inVOnce 分支。
     */
    test('should not be cached inside v-once', () => {
      const { root } = parseWithVOn(
        `<div v-once><div v-on:click="foo"/></div>`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )
      expect(root.cached.length).not.toBe(2)
      expect(root.cached.length).toBe(1)
    })

    /**
     * for 别名使用中文 项，事件调用 foo(项)；检查没有缓存槽，作用域引用分析必须识别 Unicode 局部变量并避免跨轮复用闭包。
     */
    test('unicode identifier should not be cached (v-for)', () => {
      const { root } = parseWithVOn(
        `<div v-for="项 in items" :key="value"><div v-on:click="foo(项)"/></div>`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )
      expect(root.cached.length).toBe(0)
    })

    /**
     * 处理器为 () => foo() 且开启缓存；检查缓存原箭头函数结构，foo 加前缀，VNode 不再产生事件动态标志。
     */
    test('inline function expression handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click="() => foo()" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 可安全缓存的调用包装不产生 patchFlag。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [`() => `, { content: `_ctx.foo` }, `()`],
        },
      })
    })

    /**
     * 处理器为 async () => await foo() 且开启缓存；检查异步/await 片段保留，foo 加前缀，缓存引用稳定。
     */
    test('inline async arrow function expression handler', () => {
      const { root, node } = parseWithVOn(
        `<div v-on:click="async () => await foo()" />`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 此处为原生 div；缓存异步箭头函数后不再产生事件动态标志。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [`async () => await `, { content: `_ctx.foo` }, `()`],
        },
      })
    })

    /**
     * 处理器为无括号参数的 async e => await foo(e)；检查 e 两处保持局部参数、foo 加前缀，整个函数进入缓存槽。
     */
    test('inline async arrow function with no bracket expression handler', () => {
      const { root, node } = parseWithVOn(
        `<div v-on:click="async e => await foo(e)" />`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )

      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 静态 click 事件的异步箭头函数可缓存，形参 e 保持局部变量。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [
            `async `,
            { content: `e` },
            ` => await `,
            { content: `_ctx.foo` },
            `(`,
            { content: `e` },
            `)`,
          ],
        },
      })
    })

    /**
     * 处理器为 async function () { await foo() }；检查普通异步函数块完整保留，只改写 foo，缓存后无需事件动态 patchFlag。
     */
    test('inline async function expression handler', () => {
      const { root, node } = parseWithVOn(
        `<div v-on:click="async function () { await foo() } " />`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // async function 表达式被缓存后仍是稳定引用，await 所调用的 foo 加上下文前缀。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [
            `async function () { await `,
            { content: `_ctx.foo` },
            `() } `,
          ],
        },
      })
    })

    /**
     * 处理器为 foo++ 并开启缓存；检查自增被包装成 $event 箭头函数后缓存，foo 改为上下文成员，静态 click 不再标记动态。
     */
    test('inline statement handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click="foo++" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 自增语句被包装成可缓存处理器，不产生事件动态 prop 标志。
      expect(vnodeCall.patchFlag).toBeUndefined()
      expect(
        (vnodeCall.props as ObjectExpression).properties[0].value,
      ).toMatchObject({
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [
            `$event => (`,
            { children: [{ content: `_ctx.foo` }, `++`] },
            `)`,
          ],
        },
      })
    })
  })
})
