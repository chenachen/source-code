/**
 * `v-once` 场景：验证子树写入 `_cache`、block tracking 暂停与恢复；覆盖嵌套 v-once、
 * v-if/v-for，并检查内层 v-once 不重复分配缓存槽。
 */
import {
  type CompilerOptions,
  NodeTypes,
  generate,
  getBaseTransformPreset,
  baseParse as parse,
  transform,
} from '../../src'
import { RENDER_SLOT, SET_BLOCK_TRACKING } from '../../src/runtimeHelpers'

/**
 * 先解析模板，再运行基础节点/指令预设，并允许 options 覆盖转换配置。
 * 返回根 AST，便于同时检查 cached 槽、helper 与生成代码；此 helper 不执行缓存的运行时命中。
 */
function transformWithOnce(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  const [nodeTransforms, directiveTransforms] = getBaseTransformPreset()
  transform(ast, {
    nodeTransforms,
    directiveTransforms,
    ...options,
  })
  return ast
}

describe('compiler: v-once transform', () => {
  /**
   * 根 div 同时带动态 id 与 v-once；转换后只分配一个缓存槽并注册 SET_BLOCK_TRACKING，根 codegenNode 缓存整个 div 的 VNodeCall。代码快照检查缓存表达式的生成方式。
   */
  test('as root node', () => {
    const root = transformWithOnce(`<div :id="foo" v-once />`)
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect(root.codegenNode).toMatchObject({
      type: NodeTypes.JS_CACHE_EXPRESSION,
      index: 0,
      value: {
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 父 div 内的动态 div 带 v-once；只给内层节点分配缓存槽，父节点的 children 保留这个缓存表达式。检查 helper、缓存索引及生成快照，确认缓存边界位于被标记的子树。
   */
  test('on nested plain element', () => {
    const root = transformWithOnce(`<div><div :id="foo" v-once /></div>`)
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect((root.children[0] as any).children[0].codegenNode).toMatchObject({
      type: NodeTypes.JS_CACHE_EXPRESSION,
      index: 0,
      value: {
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 父 div 内的 Comp 带动态 id 和 v-once；缓存表达式包住组件 VNodeCall，组件标签已解析为 _component_Comp。检查单个缓存槽和 block tracking helper，确认组件也复用同一缓存机制。
   */
  test('on component', () => {
    const root = transformWithOnce(`<div><Comp :id="foo" v-once /></div>`)
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect((root.children[0] as any).children[0].codegenNode).toMatchObject({
      type: NodeTypes.JS_CACHE_EXPRESSION,
      index: 0,
      value: {
        type: NodeTypes.VNODE_CALL,
        tag: `_component_Comp`,
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 父 div 内的 slot outlet 带 v-once；缓存的是 RENDER_SLOT 调用，而不是原生元素 VNodeCall。检查单个缓存槽、helper 与快照，确认出口调用整体只在首次求值时执行。
   */
  test('on slot outlet', () => {
    const root = transformWithOnce(`<div><slot v-once /></div>`)
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect((root.children[0] as any).children[0].codegenNode).toMatchObject({
      type: NodeTypes.JS_CACHE_EXPRESSION,
      index: 0,
      value: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: RENDER_SLOT,
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 外层和内层 div 都标记 v-once；检查 cached 长度仍为 1。遍历外层缓存子树时 inVOnce 为真，内层指令不再分配额外缓存槽。
   */
  test('inside v-once', () => {
    const root = transformWithOnce(`<div v-once><div v-once/></div>`)
    expect(root.cached).not.toBe(2)
    expect(root.cached.length).toBe(1)
  })

  /**
   * 开启 hoistStatic 后转换带 v-once 的静态子 div；缓存槽仍为 1，hoists 为空，子节点保留缓存表达式。该场景验证静态提升跳过已经由 v-once 管理的节点。
   */
  test('with hoistStatic: true', () => {
    const root = transformWithOnce(`<div><div v-once /></div>`, {
      hoistStatic: true,
    })
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect(root.hoists.length).toBe(0)
    expect((root.children[0] as any).children[0].codegenNode).toMatchObject({
      type: NodeTypes.JS_CACHE_EXPRESSION,
      index: 0,
      value: {
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * if 分支上的 div 标记 v-once，后接 else 的 p；转换后缓存整个 IfNode 的条件表达式，包含 div 与 p 两个分支。检查一个缓存槽与快照，确认首次选中的分支决定后续复用结果。
   */
  test('with v-if/else', () => {
    const root = transformWithOnce(`<div v-if="BOOLEAN" v-once /><p v-else/>`)
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect(root.children[0]).toMatchObject({
      type: NodeTypes.IF,
      // 应缓存完整 v-if/else-if/else 表达式，而不是某一个分支。
      codegenNode: {
        type: NodeTypes.JS_CACHE_EXPRESSION,
        value: {
          type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
          consequent: {
            type: NodeTypes.VNODE_CALL,
            tag: `"div"`,
          },
          alternate: {
            type: NodeTypes.VNODE_CALL,
            tag: `"p"`,
          },
        },
      },
    })
  })

  /**
   * 同一 div 同时带 v-for 和 v-once；ForNode 的 codegenNode 被整体缓存，缓存值内部才是 renderList。检查单个缓存槽及快照，确认缓存整个列表结果，而非每轮额外分配槽。
   */
  test('with v-for', () => {
    const root = transformWithOnce(`<div v-for="i in list" v-once />`)
    expect(root.cached.length).toBe(1)
    expect(root.helpers).toContain(SET_BLOCK_TRACKING)
    expect(root.children[0]).toMatchObject({
      type: NodeTypes.FOR,
      // 应缓存完整 v-for 列表表达式，而不是单轮迭代节点。
      codegenNode: {
        type: NodeTypes.JS_CACHE_EXPRESSION,
      },
    })
  })
})
