/**
Types from https://github.com/rollup/plugins/blob/master/packages/alias/types/index.d.ts
Inlined because the plugin is bundled.

https://github.com/rollup/plugins/blob/master/LICENSE

The MIT License (MIT)

Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

import type { FunctionPluginHooks } from 'rolldown'

/** 一条按顺序匹配的导入别名规则。 */
export interface Alias {
  /** 要匹配的导入说明符或正则表达式。 */
  find: string | RegExp
  /** 命中后替换成的目标说明符。 */
  replacement: string
  /**
   * 为此规则指定替代解析算法，而不是使用 Rolldown/Rollup 默认解析器。
   *
   * @default null
   * @deprecated 请改用带 `resolveId` 钩子和 `enforce: 'pre'` 的自定义插件。
   */
  customResolver?: ResolverFunction | ResolverObject | null
}

/** 只保留函数类型，用于从底层钩子联合中过滤可调用签名。 */
export type MapToFunction<T> = T extends Function ? T : never

/** 与 Rolldown resolveId 函数式钩子保持一致的别名自定义解析器。 */
export type ResolverFunction = MapToFunction<FunctionPluginHooks['resolveId']>

/** 对象式自定义解析器，可在首次解析前执行 buildStart 初始化。 */
export interface ResolverObject {
  /** alias 插件启动时运行的可选初始化钩子，与底层 buildStart 签名一致。 */
  buildStart?: FunctionPluginHooks['buildStart']
  /** 命中该别名规则后负责解析替换目标的钩子。 */
  resolveId: ResolverFunction
}

/**
 * import/require 说明符的别名配置，可使用对象简写或规则数组。
 *
 * 数组形式按声明顺序匹配，首条命中规则优先。Vite 规范化后传给 alias 插件；
 * bundled dev 且没有 customResolver 时改用 Rolldown native alias 插件。
 *
 * https://github.com/rollup/plugins/tree/master/packages/alias#entries
 */
export type AliasOptions = readonly Alias[] | { [find: string]: string }
