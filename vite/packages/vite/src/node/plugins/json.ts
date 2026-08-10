/** JSON 模块转换选项；实际转换由 Rolldown 原生 JSON 插件执行。 */
export interface JsonOptions {
  /**
   * 为 JSON 对象每个顶层属性生成命名导出，便于 tree-shaking。
   * @default true
   */
  namedExports?: boolean
  /**
   * 把默认导出生成成高性能 `JSON.parse("stringified")`。
   *
   * `'auto'` 仅对大于 10 KiB 的数据采用 stringify；数组保持直接字面量以免语义/体积退化（#18541）。
   * @default 'auto'
   */
  stringify?: boolean | 'auto'
}

/** 支持带 query 的 `.json` 与 `.json5` 模块请求。 */
const jsonLangs = `\\.(?:json|json5)(?:$|\\?)`
/** 复用的 JSON 请求正则。 */
const jsonLangRE = new RegExp(jsonLangs)
/** 判断 URL 是否应走 JSON 模块语义，而非普通资源语义。 */
export const isJSONRequest = (request: string): boolean =>
  jsonLangRE.test(request)
