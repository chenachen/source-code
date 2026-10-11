/**
 * 分别确认客户端模板中 script/style 的诊断存在，且标签不进入生成代码。
 */
import { type CompilerError, compile } from '../../src'

describe('compiler: ignore side effect tags', () => {
  /**
   * 场景：把原生 script 作为客户端模板根，以收集型 onError 编译，断言副作用诊断存在且代码不含 script，验证报错后 removeNode 仍生效。
   */
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

  /**
   * 场景：把原生 style 作为客户端模板根，以收集型 onError 编译，断言副作用诊断存在且代码不含 style，验证样式标签也走删除路径。
   */
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
