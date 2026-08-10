/**
 * 客户端副作用标签场景：组件模板中的 script/style 必须报告诊断并从 AST 删除，防止挂载
 * 模板时执行脚本或意外注入全局样式；相邻节点仍需保持正确遍历顺序。
 */
import { type CompilerError, compile } from '../../src'

describe('compiler: ignore side effect tags', () => {
  it('should ignore script', () => {
    let err: CompilerError | undefined
    const { code } = compile(`<script>console.log(1)</script>`, {
      /** 捕获可恢复编译错误，随后同时断言诊断与生成代码。 */
      onError(e) {
        err = e
      },
    })
    expect(code).not.toMatch('script')
    expect(err).toBeDefined()
    expect(err!.message).toMatch(`Tags with side effect`)
  })

  it('should ignore style', () => {
    let err: CompilerError | undefined
    const { code } = compile(`<style>h1 { color: red }</style>`, {
      /** 捕获 style 副作用标签诊断。 */
      onError(e) {
        err = e
      },
    })
    expect(code).not.toMatch('style')
    expect(err).toBeDefined()
    expect(err!.message).toMatch(`Tags with side effect`)
  })
})
