/**
 * `v-once` 场景：验证子树写入 `_cache`、依赖追踪暂停与 block tracking 恢复，并覆盖嵌套、
 * v-if/v-for 和重复转换时缓存槽不会错误增加。
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

/** 运行 v-once 及其依赖转换，返回含缓存槽的根 AST。 */
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

  // 已位于 v-once 缓存子树时，内层 v-once 不应再分配缓存槽。
  test('inside v-once', () => {
    const root = transformWithOnce(`<div v-once><div v-once/></div>`)
    expect(root.cached).not.toBe(2)
    expect(root.cached.length).toBe(1)
  })

  // 已缓存节点必须由 hoistStatic 跳过，避免同时提升和缓存。
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
