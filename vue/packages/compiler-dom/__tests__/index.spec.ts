/**
 * 确认公开 compile 入口组合了 v-text、v-html、v-cloak 和静态/动态 style 转换。
 */
import { compile } from '../src'

describe('compile', () => {
  /**
   * 场景：同一模板同时包含 v-text、v-html、v-cloak 与静态/动态 style，经公开 compile 生成代码并匹配快照，验证入口确实安装了 DOM 默认转换；不执行产物中的 DOM 更新。
   */
  it('should contain standard transforms', () => {
    const { code } = compile(`<div v-text="text"></div>
        <div v-html="html"></div>
        <div v-cloak>test</div>
        <div style="color:red">red</div>
        <div :style="{color: 'green'}"></div>`)

    expect(code).toMatchSnapshot()
  })
})
