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

  test('on root element', () => {
    expect(
      baseCompile(`<div v-memo="[x]"></div>`, {
        mode: 'module',
        prefixIdentifiers: true,
      }).code,
    ).toMatchSnapshot()
  })

  test('on normal element', () => {
    expect(compile(`<div v-memo="[x]"></div>`)).toMatchSnapshot()
  })

  test('on normal element with dynamic key', () => {
    const code = compile(`<div v-memo="[updateKey]" :key="updateKey"></div>`)

    expect(code).toContain(`_withMemo([_ctx.updateKey]`)
    expect(code).toContain(`{ key: _ctx.updateKey }`)
  })

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

  test('on component', () => {
    expect(compile(`<Comp v-memo="[x]"></Comp>`)).toMatchSnapshot()
  })

  test('on v-if', () => {
    expect(
      compile(
        `<div v-if="ok" v-memo="[x]"><span>foo</span>bar</div>
        <Comp v-else v-memo="[x]"></Comp>`,
      ),
    ).toMatchSnapshot()
  })

  test('on v-for', () => {
    expect(
      compile(
        `<div v-for="{ x, y } in list" :key="x" v-memo="[x, y === z]">
          <span>foobar</span>
        </div>`,
      ),
    ).toMatchSnapshot()
  })

  test('on v-for w/ compound key expression', () => {
    expect(
      compile(
        `<div v-for="{ x, y } in list" :key="get(x)" v-memo="[x, y === z]">
          <span>foobar</span>
        </div>`,
      ),
    ).toMatchSnapshot()
  })

  test('on template v-for', () => {
    expect(
      compile(
        `<template v-for="{ x, y } in list" :key="x" v-memo="[x, y === z]">
          <span>foobar</span>
        </template>`,
      ),
    ).toMatchSnapshot()
  })

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
