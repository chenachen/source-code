/**
 * DOM 事件修饰符场景：把 stop/prevent/self 等非键修饰符交给 withModifiers，把键名修饰符
 * 交给 withKeys，并断言 click.right/middle 重写及动态事件双层守卫的生成顺序。
 */
import {
  BindingTypes,
  type CompilerOptions,
  type ElementNode,
  NodeTypes,
  type ObjectExpression,
  TO_HANDLER_KEY,
  type VNodeCall,
  helperNameMap,
  baseParse as parse,
  transform,
} from '@vue/compiler-core'
import { transformOn } from '../../src/transforms/vOn'
import { V_ON_WITH_KEYS, V_ON_WITH_MODIFIERS } from '../../src/runtimeHelpers'
import { transformElement } from '../../../compiler-core/src/transforms/transformElement'
import { transformExpression } from '../../../compiler-core/src/transforms/transformExpression'
import { PatchFlags } from '@vue/shared'

/** 编译 DOM 事件并提取首元素的 VNodeCall 与 props，供修饰符断言复用。 */
function parseWithVOn(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [transformExpression, transformElement],
    directiveTransforms: {
      on: transformOn,
    },
    ...options,
  })
  const node = (ast.children[0] as ElementNode).codegenNode as VNodeCall
  return {
    root: ast,
    node,
    props: (node.props as ObjectExpression).properties,
  }
}

describe('compiler-dom: transform v-on', () => {
  /**
   * 场景：前缀模式下 click.stop.prevent 引用 test，断言 withModifiers(_ctx.test,[stop,prevent]) 的 AST，验证修饰符顺序保留且处理器先完成前缀改写。
   */
  it('should support multiple modifiers w/ prefixIdentifiers: true', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @click.stop.prevent="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_MODIFIERS,
        arguments: [{ content: '_ctx.test' }, '["stop","prevent"]'],
      },
    })
  })

  /**
   * 场景：同一元素有 click.stop 与 keyup.enter，断言两项 props 分别用 withModifiers 与 withKeys，验证各事件独立分组而不互相混入修饰符。
   */
  it('should support multiple events and modifiers options w/ prefixIdentifiers: true', () => {
    const { props } = parseWithVOn(
      `<div @click.stop="test" @keyup.enter="test" />`,
      {
        prefixIdentifiers: true,
      },
    )
    const [clickProp, keyUpProp] = props

    expect(props).toHaveLength(2)
    expect(clickProp).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_MODIFIERS,
        arguments: [{ content: '_ctx.test' }, '["stop"]'],
      },
    })
    expect(keyUpProp).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_KEYS,
        arguments: [{ content: '_ctx.test' }, '["enter"]'],
      },
    })
  })

  /**
   * 场景：click.stop.capture.once 同时有守卫和监听选项，断言键为 onClickCaptureOnce、handler 只包 stop，验证监听选项进入事件键而非运行时守卫数组。
   */
  it('should support multiple modifiers and event options w/ prefixIdentifiers: true', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @click.stop.capture.once="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      key: {
        content: `onClickCaptureOnce`,
      },
      value: {
        callee: V_ON_WITH_MODIFIERS,
        arguments: [{ content: '_ctx.test' }, '["stop"]'],
      },
    })
  })

  /**
   * 场景：keydown.stop.capture.ctrl.a 同时含选项、系统键与具体按键，断言外层 withKeys(a)、内层 withModifiers(stop,ctrl) 和 Capture 键后缀，验证三组组合顺序。
   */
  it('should wrap keys guard for keyboard events or dynamic events', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @keydown.stop.capture.ctrl.a="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      key: {
        content: `onKeydownCapture`,
      },
      value: {
        callee: V_ON_WITH_KEYS,
        arguments: [
          {
            callee: V_ON_WITH_MODIFIERS,
            arguments: [{ content: '_ctx.test' }, '["stop","ctrl"]'],
          },
          '["a"]',
        ],
      },
    })
  })

  /**
   * 场景：keyup.exact 没有具体按键限制，断言只生成 withModifiers(exact)，验证键盘事件名本身不会强制增加 withKeys。
   */
  it('should not wrap keys guard if no key modifier is present', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @keyup.exact="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_MODIFIERS,
        arguments: [{ content: '_ctx.test' }, '["exact"]'],
      },
    })
  })

  /**
   * 场景：静态 keyup.left 使用方向键语义，断言只以 left 参数包装 withKeys，验证 left/right 的含义由静态键盘事件名收窄。
   */
  it('should wrap keys guard for static key event w/ left/right modifiers', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @keyup.left="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_KEYS,
        arguments: [{ content: '_ctx.test' }, '["left"]'],
      },
    })
  })

  /**
   * 场景：动态 @[e].left 无法编译期确定键盘或鼠标，断言 left 同时进入两层包装，验证外层 withKeys/内层 withModifiers 的 AST。
   */
  it('should wrap both for dynamic key event w/ left/right modifiers', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @[e].left="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_KEYS,
        arguments: [
          {
            callee: V_ON_WITH_MODIFIERS,
            arguments: [{ content: `_ctx.test` }, `["left"]`],
          },
          '["left"]',
        ],
      },
    })
  })

  /**
   * 场景：keyup.enter 仅有限制按键修饰符，断言 withKeys 的首参直接是 _ctx.test，验证不会生成空的通用守卫包装。
   */
  it('should not wrap normal guard if there is only keys guard', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @keyup.enter="test"/>`, {
      prefixIdentifiers: true,
    })
    expect(prop).toMatchObject({
      type: NodeTypes.JS_PROPERTY,
      value: {
        callee: V_ON_WITH_KEYS,
        arguments: [{ content: '_ctx.test' }, '["enter"]'],
      },
    })
  })

  /**
   * 场景：分别转换静态 click.right 和动态 @[event].right，断言静态键改为 onContextmenu、动态键仅当规范化值严格为 onClick 时改写，验证不把全部动态事件都替换。
   */
  test('should transform click.right', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @click.right="test"/>`)
    expect(prop.key).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `onContextmenu`,
    })

    // 动态事件名。
    const {
      props: [prop2],
    } = parseWithVOn(`<div @[event].right="test"/>`)
    // 动态 click.right：规范化后的 key 严格等于 onClick 时改成 onContextmenu，否则保留原值。
    expect(prop2.key).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `(`,
        {
          children: [
            `_${helperNameMap[TO_HANDLER_KEY]}(`,
            { content: 'event' },
            `)`,
          ],
        },
        `) === "onClick" ? "onContextmenu" : (`,
        {
          children: [
            `_${helperNameMap[TO_HANDLER_KEY]}(`,
            { content: 'event' },
            `)`,
          ],
        },
        `)`,
      ],
    })
  })

  /**
   * 场景：分别转换静态 click.middle 和动态 @[event].middle，断言静态键改为 onMouseup、动态条件保留其他事件键，验证中键实际事件映射。
   */
  test('should transform click.middle', () => {
    const {
      props: [prop],
    } = parseWithVOn(`<div @click.middle="test"/>`)
    expect(prop.key).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `onMouseup`,
    })

    // core 将动态参数转成 toHandlerKey 调用，DOM 转换再判断是否需要改写。
    const {
      props: [prop2],
    } = parseWithVOn(`<div @[event].middle="test"/>`)
    // 动态 click.middle：规范化后的 key 严格等于 onClick 时改成 onMouseup，否则保留原值。
    expect(prop2.key).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `(`,
        {
          children: [
            `_${helperNameMap[TO_HANDLER_KEY]}(`,
            { content: 'event' },
            `)`,
          ],
        },
        `) === "onClick" ? "onMouseup" : (`,
        {
          children: [
            `_${helperNameMap[TO_HANDLER_KEY]}(`,
            { content: 'event' },
            `)`,
          ],
        },
        `)`,
      ],
    })
  })

  /**
   * 场景：前缀模式开启 cacheHandlers，keyup.enter.capture 引用 foo，断言一个缓存槽包含完整 withKeys 包装、Capture 键以及仅 NEED_HYDRATION，验证守卫整体缓存后不进入动态 prop 列表。
   */
  test('cache handler w/ modifiers', () => {
    const {
      root,
      props: [prop],
    } = parseWithVOn(`<div @keyup.enter.capture="foo" />`, {
      prefixIdentifiers: true,
      cacheHandlers: true,
    })
    expect(root.cached.length).toBe(1)
    // 缓存 handler 不是 dynamicProp，因此没有 PROPS 列表，只保留 hydration 标志。
    expect((root as any).children[0].codegenNode.patchFlag).toBe(
      PatchFlags.NEED_HYDRATION,
    )
    expect(prop).toMatchObject({
      key: {
        content: `onKeyupCapture`,
      },
      value: {
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index: 0,
        value: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: V_ON_WITH_KEYS,
        },
      },
    })
  })

  /**
   * 场景：bindingMetadata 把 foo 标为 SETUP_CONST，转换 keydown.up 后断言只有 NEED_HYDRATION，验证运行时稳定 handler 即便带守卫也不添加 PROPS 标志。
   */
  test('should not have PROPS patchFlag for constant v-on handlers with modifiers', () => {
    const { node } = parseWithVOn(`<div @keydown.up="foo" />`, {
      prefixIdentifiers: true,
      bindingMetadata: {
        foo: BindingTypes.SETUP_CONST,
      },
      directiveTransforms: {
        on: transformOn,
      },
    })
    // 最终只应包含 NEED_HYDRATION 标志。
    expect(node.patchFlag).toBe(PatchFlags.NEED_HYDRATION)
  })
})
