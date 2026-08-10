/**
 * compiler-dom 集成入口场景：确认 DOM parser 选项、平台节点转换和指令转换均被完整注册，
 * 从模板到可执行 render 代码的组合结果符合客户端运行时协议。
 */
import { compile } from '../src'

describe('compile', () => {
  it('should contain standard transforms', () => {
    const { code } = compile(`<div v-text="text"></div>
        <div v-html="html"></div>
        <div v-cloak>test</div>
        <div style="color:red">red</div>
        <div :style="{color: 'green'}"></div>`)

    expect(code).toMatchSnapshot()
  })
})
