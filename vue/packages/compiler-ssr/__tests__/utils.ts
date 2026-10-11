/**
 * compiler-ssr 测试辅助：执行 SSR 编译，并从生成代码中抽取父 div 内部的 `_push` 模板字面量，
 * 便于测试聚焦字符串表达式。
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
