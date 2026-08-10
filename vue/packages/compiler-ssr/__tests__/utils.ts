/**
 * compiler-ssr 测试辅助：统一执行 SSR 编译、解析生成代码中的 `_push` 片段并规范化 helper
 * 名称，使测试既能比较完整代码，也能聚焦最终 HTML 字符串表达式。
 */
import { compile } from '../src'

/**
 * 编译被父 div 包裹的模板，并抽取父标签内部的 `_push` 模板字面量。
 * 包裹可阻止根 fallthrough attrs 注入，减少非根场景快照噪声；因此该工具不适合测试根节点。
 */
export function getCompiledString(src: string): string {
  const { code } = compile(`<div>${src}</div>`)
  const match = code.match(
    /_push\(\`<div\${\s*_ssrRenderAttrs\(_attrs\)\s*}>([^]*)<\/div>\`\)/,
  )

  if (!match) {
    throw new Error(`Unexpected compile result:\n${code}`)
  }

  return `\`${match[1]}\``
}
