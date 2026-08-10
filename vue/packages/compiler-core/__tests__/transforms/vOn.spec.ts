/**
 * `v-on` 场景：覆盖静态/动态事件名、对象监听、内联语句、成员/函数表达式、修饰符 augmentor
 * 与 handler 缓存，重点检查作用域捕获和多个语句的函数包装。
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

/** 编译 core v-on，并提取事件属性及根 helper/缓存信息。 */
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

  test('should handle multi-line statement', () => {
    const { node } = parseWithVOn(`<div @click="\nfoo();\nbar()\n"/>`)
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      properties: [
        {
          key: { content: `onClick` },
          value: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            // prefixIdentifiers 模式下多语句同样生成块函数，并丢弃最后表达式返回值。
            children: [`$event => {`, { content: `\nfoo();\nbar()\n` }, `}`],
          },
        },
      ],
    })
  })

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
                  // 动态参数表达式中的 `$event` 也保持局部形参。
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

  test('should NOT error if no expression but has modifier', () => {
    const onError = vi.fn()
    parseWithVOn(`<div v-on:click.prevent />`, { onError })
    expect(onError).not.toHaveBeenCalled()
  })

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

    test('compound member expression handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click="foo.bar" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 缓存函数表达式不参与动态 props diff。
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

    test('bail on component member expression handler', () => {
      const { root } = parseWithVOn(`<comp v-on:click="foo" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
        isNativeTag: tag => tag === 'div',
      })
      expect(root.cached.length).toBe(0)
    })

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
      // 组件处理器缓存后也不视为动态 prop。
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
      // 动态事件名之外，缓存值本身不额外产生标志。
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
      // 多语句缓存处理器仍是稳定缓存引用。
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

    test('inline statement handler', () => {
      const { root, node } = parseWithVOn(`<div v-on:click="foo++" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      })
      expect(root.cached.length).toBe(1)
      expect(root.cached.length).toBe(1)
      const vnodeCall = node.codegenNode as VNodeCall
      // 可缓存的可选链处理器不产生动态 prop 标志。
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
