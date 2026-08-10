import { parse } from '@babel/parser'
import MagicString from 'magic-string'
import type { ParserPlugin } from '@babel/parser'
import type { Identifier, Statement } from '@babel/types'
import { resolveParserPlugins } from './script/context'

/**
 * 解析普通 `<script>` 内容，并把默认导出改写成指定局部变量。
 * 组件编译器随后可向该对象合并 render、scopeId、CSS vars 等生成属性。
 */
export function rewriteDefault(
  input: string,
  as: string,
  parserPlugins?: ParserPlugin[],
): string {
  const ast = parse(input, {
    sourceType: 'module',
    plugins: resolveParserPlugins('js', parserPlugins),
  }).program.body
  const s = new MagicString(input)

  rewriteDefaultAST(ast, s, as)

  return s.toString()
}

/**
 * 基于已解析 AST，把 script 中各种默认导出形式改写为局部变量声明。
 *
 * 支持 `export default {}`、具名 class、`export { foo as default }` 和从其他模块再导出；
 * 如果没有默认导出则创建空组件对象，供后续编译步骤安全地注入选项。
 */
export function rewriteDefaultAST(
  ast: Statement[],
  s: MagicString,
  as: string,
): void {
  if (!hasDefaultExport(ast)) {
    s.append(`\nconst ${as} = {}`)
    return
  }

  // 调用方可能已用轻量扫描判断默认导出；多行注释/模板字符串会令文本扫描失准。
  // 此处以完整 Babel AST 为准，逐种语法做不会破坏 source map 的定点改写。
  ast.forEach(node => {
    if (node.type === 'ExportDefaultDeclaration') {
      if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
        const start: number =
          node.declaration.decorators && node.declaration.decorators.length > 0
            ? node.declaration.decorators[
                node.declaration.decorators.length - 1
              ].end!
            : node.start!
        s.overwrite(start, node.declaration.id.start!, ` class `)
        s.append(`\nconst ${as} = ${node.declaration.id.name}`)
      } else {
        s.overwrite(node.start!, node.declaration.start!, `const ${as} = `)
      }
    } else if (node.type === 'ExportNamedDeclaration') {
      for (const specifier of node.specifiers) {
        if (
          specifier.type === 'ExportSpecifier' &&
          specifier.exported.type === 'Identifier' &&
          specifier.exported.name === 'default'
        ) {
          if (node.source) {
            if (specifier.local.name === 'default') {
              s.prepend(
                `import { default as __VUE_DEFAULT__ } from '${node.source.value}'\n`,
              )
              const end = specifierEnd(s, specifier.local.end!, node.end!)
              s.remove(specifier.start!, end)
              s.append(`\nconst ${as} = __VUE_DEFAULT__`)
              continue
            } else {
              s.prepend(
                `import { ${s.slice(
                  specifier.local.start!,
                  specifier.local.end!,
                )} as __VUE_DEFAULT__ } from '${node.source.value}'\n`,
              )
              const end = specifierEnd(s, specifier.exported.end!, node.end!)
              s.remove(specifier.start!, end)
              s.append(`\nconst ${as} = __VUE_DEFAULT__`)
              continue
            }
          }

          const end = specifierEnd(s, specifier.end!, node.end!)
          s.remove(specifier.start!, end)
          s.append(`\nconst ${as} = ${specifier.local.name}`)
        }
      }
    }
  })
}

/** 判断模块 AST 是否以声明或具名导出说明符提供了 default。 */
export function hasDefaultExport(ast: Statement[]): boolean {
  for (const stmt of ast) {
    if (stmt.type === 'ExportDefaultDeclaration') {
      return true
    } else if (
      stmt.type === 'ExportNamedDeclaration' &&
      stmt.specifiers.some(
        spec => (spec.exported as Identifier).name === 'default',
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * 计算删除 default 导出说明符时的结束位置。
 * 对 `export { default, foo }` 连同后置逗号删除；若它是末项则只删说明符，保留前一逗号。
 */
function specifierEnd(s: MagicString, end: number, nodeEnd: number | null) {
  let hasCommas = false
  let oldEnd = end
  while (end < nodeEnd!) {
    if (/\s/.test(s.slice(end, end + 1))) {
      end++
    } else if (s.slice(end, end + 1) === ',') {
      end++
      hasCommas = true
      break
    } else if (s.slice(end, end + 1) === '}') {
      break
    }
  }
  return hasCommas ? end : oldEnd
}
