/** JSON 模块转换选项；实际转换由 Rolldown 原生 JSON 插件执行。 */
export interface JsonOptions {
  /**
   * 为能作为导出名的 JSON 对象顶层属性生成命名导出，便于 tree-shaking。
   * 当前 Rolldown 原生插件对对象优先走此分支，即使 stringify 为 true 也生成对象字面量。
   * @default true
   */
  namedExports?: boolean
  /**
   * 使用 `JSON.parse("stringified")` 生成默认导出。
   *
   * 当前原生插件仅在未进入对象命名导出分支时采用此形式：true 无条件启用，
   * 'auto' 在去除 BOM 后源码超过 10,000 UTF-8 字节时启用。数组也适用；
   * 若要让对象走 JSON.parse，需要同时关闭 namedExports。
   * @default 'auto'
   */
  stringify?: boolean | 'auto'
}

/** 识别带 query 的 `.json` 与 `.json5` 请求；实际可转换格式由对应插件决定。 */
const jsonLangs = `\\.(?:json|json5)(?:$|\\?)`
/** 复用的 JSON 请求正则。 */
const jsonLangRE = new RegExp(jsonLangs)
/** 判断 URL 是否应走 JSON 模块语义，而非普通资源语义。 */
export const isJSONRequest = (request: string): boolean =>
  jsonLangRE.test(request)
