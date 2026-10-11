import type { Plugin } from 'vite'
/** 带 .svg 后缀的公开虚拟模块名，验证扩展名不会绕过插件虚拟模块处理。 */
const svgVirtualModuleId = 'virtual:foo.svg'
/** 带零字节的内部虚拟 ID，与磁盘 SVG 文件和资产 URL 处理区分。 */
const resolvedSvgVirtualModuleId = '\0' + svgVirtualModuleId

/** 创建 pre 插件，将虚拟 SVG 导入解析为返回 SVG 原文的 JS 模块。 */
export default function svgVirtualModulePlugin(): Plugin {
  return {
    name: 'svg-virtual-module',
    /** 只接管公开虚拟 SVG 名，返回带零字节前缀的内部 ID。 */
    resolveId(id) {
      if (id === svgVirtualModuleId) {
        return resolvedSvgVirtualModuleId
      }
    },
    /** 只为内部虚拟 ID 返回默认导出 SVG 字符串的 JS，未命中时继续插件链。 */
    async load(id, _options) {
      if (id === resolvedSvgVirtualModuleId) {
        return `export default '<svg><rect width="100" height="100"></svg>'`
      }
    },
    enforce: 'pre',
  }
}
