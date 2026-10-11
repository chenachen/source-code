/**
 * `v-memo` 场景：验证依赖数组、withMemo 缓存槽、VNode 工厂和 block 转换，并覆盖与
 * v-for/key/v-if 嵌套时缓存索引及迭代 key 的正确传递。
 */
import { baseCompile } from '../../src'

describe('compiler: v-memo transform', () => {
  /** 在稳定父 div 内编译片段，返回 module/prefixIdentifiers 模式生成代码。 */
  function compile(content: string) {
    return baseCompile(`<div>${content}</div>`, {
      mode: 'module',
      prefixIdentifiers: true,
    }).code
  }

  /**
   * 根 div 使用 v-memo="[x]"；模块编译快照检查依赖数组、VNode 工厂与缓存索引组成的 withMemo 调用。原生根节点作为 block 生成，便于 memo 命中时沿用块信息。
   */
  test('on root element', () => {
    expect(
      baseCompile(`<div v-memo="[x]"></div>`, {
        mode: 'module',
        prefixIdentifiers: true,
      }).code,
    ).toMatchSnapshot()
  })

  /**
   * 将带 v-memo="[x]" 的 div 放进公共父 div fixture；快照检查 memo 包装内层元素，父节点继续按常规方式生成 children。
   */
  test('on normal element', () => {
    expect(compile(`<div v-memo="[x]"></div>`)).toMatchSnapshot()
  })

  /**
   * 普通元素同时使用 v-memo="[updateKey]" 与 :key="updateKey"；检查依赖数组和 VNode key 都访问 _ctx.updateKey。表达式转换须在 memo 包装前处理两处自由变量。
   */
  test('on normal element with dynamic key', () => {
    const code = compile(`<div v-memo="[updateKey]" :key="updateKey"></div>`)

    expect(code).toContain(`_withMemo([_ctx.updateKey]`)
    expect(code).toContain(`{ key: _ctx.updateKey }`)
  })

  /**
   * 循环内部的子 div 用 item.id 与 updateKey 作为 memo 依赖，key 调用 get(item, updateKey)；检查 item 保持循环局部变量，get/updateKey 加 _ctx 前缀。该 memo 管理循环子元素，其作用域来自外层 for。
   */
  test('on normal element with dynamic key nested in v-for', () => {
    const code = compile(
      `<div v-for="item in items">
        <div
          v-memo="[item.id, updateKey]"
          :key="get(item, updateKey)"
        >{{ item }}</div>
      </div>`,
    )

    expect(code).toContain(`_withMemo([item.id, _ctx.updateKey]`)
    expect(code).toContain(`key: _ctx.get(item, _ctx.updateKey)`)
  })

  /**
   * 组件 Comp 使用 v-memo="[x]"；快照检查组件 VNode 被 withMemo 包装。组件自身承担更新边界，vMemo 不像普通元素那样强制把其 VNodeCall 改为 block。
   */
  test('on component', () => {
    expect(compile(`<Comp v-memo="[x]"></Comp>`)).toMatchSnapshot()
  })

  /**
   * if 的原生元素分支和 else 的组件分支分别使用 v-memo；快照检查分支 key、各自 memo 工厂及缓存位置，确认结构指令完成分支代码后再包装对应节点。
   */
  test('on v-if', () => {
    expect(
      compile(
        `<div v-if="ok" v-memo="[x]"><span>foo</span>bar</div>
        <Comp v-else v-memo="[x]"></Comp>`,
      ),
    ).toMatchSnapshot()
  })

  /**
   * 带 key 的 v-for 解构 x/y，memo 依赖含 x 与 y === z；快照检查循环内的缓存项、key 与依赖比较，以及 z 的上下文访问。列表 memo 走 vFor 的每轮缓存协议，x/y 保持局部作用域。
   */
  test('on v-for', () => {
    expect(
      compile(
        `<div v-for="{ x, y } in list" :key="x" v-memo="[x, y === z]">
          <span>foobar</span>
        </div>`,
      ),
    ).toMatchSnapshot()
  })

  /**
   * 带 memo 的 v-for 使用 get(x) 作为复合 key；快照检查 get 加上下文前缀，x 保持别名，并用求值后的 key 判断该轮缓存项能否复用。
   */
  test('on v-for w/ compound key expression', () => {
    expect(
      compile(
        `<div v-for="{ x, y } in list" :key="get(x)" v-memo="[x, y === z]">
          <span>foobar</span>
        </div>`,
      ),
    ).toMatchSnapshot()
  })

  /**
   * template v-for 带 key 与 memo，内部为静态 span；快照检查 template 被解包后，循环产物仍携带 key 和每轮 memo 检查，依赖中的 x/y 与上下文 z 分别按作用域处理。
   */
  test('on template v-for', () => {
    expect(
      compile(
        `<template v-for="{ x, y } in list" :key="x" v-memo="[x, y === z]">
          <span>foobar</span>
        </template>`,
      ),
    ).toMatchSnapshot()
  })

  /**
   * template v-for 的 key 改为 get(x)；快照检查复合 key 的前缀改写以及 template 解包后的列表 memo 协议，确保缓存比较使用本轮实际 key。
   */
  test('on template v-for w/ compound key expression', () => {
    expect(
      compile(
        `<template v-for="{ x, y } in list" :key="get(x)" v-memo="[x, y === z]">
          <span>foobar</span>
        </template>`,
      ),
    ).toMatchSnapshot()
  })
})
