import type {
  CallExpression,
  Expression,
  Identifier,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Node,
  StringLiteral,
  TSMethodSignature,
  TSPropertySignature,
} from '@babel/types'
import path from 'path'

/** 无法从 TypeScript 静态推导出运行时构造器时使用的哨兵类型名。 */
export const UNKNOWN_TYPE = 'Unknown'

/** 从对象属性键节点解析可静态确定的字符串键。 */
export function resolveObjectKey(
  node: Node,
  computed: boolean,
): string | undefined {
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
      return String(node.value)
    case 'Identifier':
      if (!computed) return node.name
  }
  return undefined
}

/** 过滤空值并用逗号连接若干可选代码片段。 */
export function concatStrings(
  strs: Array<string | null | undefined | false>,
): string {
  return strs.filter((s): s is string => !!s).join(', ')
}

/** 判断 Babel 节点是否为任意 `*Literal` 字面量。 */
export function isLiteralNode(node: Node): boolean {
  return node.type.endsWith('Literal')
}

/** 将“标识符 callee 的调用”按固定名称或判定函数做类型守卫。 */
export function isCallOf(
  node: Node | null | undefined,
  test: string | ((id: string) => boolean) | null | undefined,
): node is CallExpression {
  return !!(
    node &&
    test &&
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    (typeof test === 'string'
      ? node.callee.name === test
      : test(node.callee.name))
  )
}

/** 单一构造器直接输出，多构造器输出 Vue prop runtime type 数组源码。 */
export function toRuntimeTypeString(types: string[]): string {
  return types.length > 1 ? `[${types.join(', ')}]` : types[0]
}

/** 取得 import specifier 的原始导入名；默认与命名空间分别返回 default/*。 */
export function getImportedName(
  specifier:
    ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier,
): string {
  if (specifier.type === 'ImportSpecifier')
    return specifier.imported.type === 'Identifier'
      ? specifier.imported.name
      : specifier.imported.value
  else if (specifier.type === 'ImportNamespaceSpecifier') return '*'
  return 'default'
}

/** 已知节点是标识符或字符串字面量时，返回值一定是字符串。 */
export function getId(node: Identifier | StringLiteral): string
/** 一般表达式只有标识符或字符串字面量可提取静态名称，否则返回 null。 */
export function getId(node: Expression): string | null
/** 按 Babel 节点类型执行名称提取的实现签名。 */
export function getId(node: Expression) {
  return node.type === 'Identifier'
    ? node.name
    : node.type === 'StringLiteral'
      ? node.value
      : null
}

/**
 * 从 TS 属性/方法签名提取编译期字符串键，支持无表达式的模板字面量计算键。
 */
export function getStringLiteralKey(
  node: TSPropertySignature | TSMethodSignature,
): string | null {
  return node.computed
    ? node.key.type === 'TemplateLiteral' && !node.key.expressions.length
      ? node.key.quasis.map(q => q.value.cooked).join('')
      : null
    : node.key.type === 'Identifier'
      ? node.key.name
      : node.key.type === 'StringLiteral'
        ? node.key.value
        : node.key.type === 'NumericLiteral'
          ? String(node.key.value)
          : null
}

/** 大小写敏感文件系统上的规范文件名恒等函数。 */
const identity = (str: string) => str
/** TypeScript 同源实现用于跳过少数大小写转换有特殊行为的 Unicode 字符。 */
const fileNameLowerCaseRegExp = /[^\u0130\u0131\u00DFa-z0-9\\/:\-_\. ]+/g
/** 可作为 replace 回调的标准小写转换。 */
const toLowerCase = (str: string) => str.toLowerCase()

/** 按 TypeScript 的规则把文件名转为稳定小写形式。 */
function toFileNameLowerCase(x: string) {
  return fileNameLowerCaseRegExp.test(x)
    ? x.replace(fileNameLowerCaseRegExp, toLowerCase)
    : x
}

/**
 * 创建 TypeScript 模块解析缓存所需的 canonical filename 函数。
 * TS 未直接导出该工具，所以这里同步其源码实现，并按文件系统大小写敏感性选择策略。
 */
export function createGetCanonicalFileName(
  useCaseSensitiveFileNames: boolean,
): (str: string) => string {
  return useCaseSensitiveFileNames ? identity : toFileNameLowerCase
}

// 浏览器 path polyfill 不暴露 posix 属性，但默认行为就是 posix，因此回退到 path 本身。
const normalize = (path.posix || path).normalize
/** Windows 反斜杠，用于在所有平台统一依赖缓存键。 */
const windowsSlashRE = /\\/g
/** 统一路径分隔符并消除 `.`/`..` 片段。 */
export function normalizePath(p: string): string {
  return normalize(p.replace(windowsSlashRE, '/'))
}

/** 跨 Node/浏览器构建统一使用 posix 语义连接路径。 */
export const joinPaths: (...paths: string[]) => string = (path.posix || path)
  .join

/**
 * 匹配不能直接作为 JS 对象裸属性名输出的符号。
 * 例如 `onUpdate:modelValue` 必须生成 `"onUpdate:modelValue"`。
 */
export const propNameEscapeSymbolsRE: RegExp =
  /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\-]/

/** 必要时用 JSON 字符串形式转义运行时 prop 名。 */
export function getEscapedPropName(key: string): string {
  return propNameEscapeSymbolsRE.test(key) ? JSON.stringify(key) : key
}

/** 判断任一 block lang 是否属于 JS/JSX。 */
export const isJS = (...langs: (string | null | undefined)[]): boolean =>
  langs.some(lang => lang === 'js' || lang === 'jsx')
/** 判断任一 block lang 是否属于 TS/TSX。 */
export const isTS = (...langs: (string | null | undefined)[]): boolean =>
  langs.some(lang => lang === 'ts' || lang === 'tsx')
