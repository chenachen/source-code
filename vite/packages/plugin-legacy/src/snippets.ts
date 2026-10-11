// https://gist.github.com/samthor/64b114e4a4f539915a95b91ffd340acc
// DO NOT ALTER THIS CONTENT
/** Safari 10 的 nomodule 修复原文；直接注入 HTML，也参与固定 CSP hash 计算。 */
export const safari10NoModuleFix: string = `!function(){var e=document,t=e.createElement("script");if(!("noModule"in t)&&"onbeforeload"in t){var n=!1;e.addEventListener("beforeload",(function(e){if(e.target===t)n=!0;else if(!e.target.hasAttribute("nomodule")||!n)return;e.preventDefault()}),!0),t.type="module",t.src=".",e.head.appendChild(t),t.remove()}}();`

/** legacy polyfill script 的 DOM id，动态回退通过它取得资源 URL。 */
export const legacyPolyfillId: string = 'vite-legacy-polyfill'
/** legacy 入口内联 script 的 DOM id，其 data-src 存放 SystemJS 导入地址。 */
export const legacyEntryId: string = 'vite-legacy-entry'
/** 从入口标签 data-src 读取 URL 后调用 System.import；路径留在属性中使脚本文本和 CSP hash 固定。 */
export const systemJSInlineCode: string = `System.import(document.getElementById('${legacyEntryId}').getAttribute('data-src'))`

/** 现代能力检测成功后写入 window 的标记；动态回退据此决定是否加载 legacy。 */
const detectModernBrowserVarName = '__vite_is_modern_browser'

/**
 * 创建先于导入者执行的 data URL 模块，缺少 import.meta.resolve 时抛错。
 *
 * 静态依赖执行失败会阻止导入者继续执行。chunkId 使各 chunk 的 URL 唯一，
 * 避免 Safari 15.x 及更早版本仅在首次导入相同模块时抛错的问题。
 * https://github.com/vitejs/vite/issues/22008
 */
const createDetectImportMetaResolveSupportModule = (chunkId: string | null) =>
  `data:text/javascript,${chunkId != null ? `${JSON.stringify(chunkId)};` : ''}if(!import.meta.resolve)throw Error("import.meta.resolve not supported")`

/** 用 import.meta、动态 import 和 async generator 语法触发旧浏览器的解析失败。 */
export const detectModernBrowserDetector: string = `import.meta.url;import("_").catch(()=>1);(async function*(){})().next()`
/** HTML 中的现代能力检测模块；依赖与语法均通过后才设置 window 标记。 */
export const detectModernBrowserCode: string = `import'${createDetectImportMetaResolveSupportModule(null)}';${detectModernBrowserDetector};window.${detectModernBrowserVarName}=true`
/** 现代检测未成功时动态插入 legacy polyfill script，加载后执行固定 SystemJS 入口脚本。 */
export const dynamicFallbackInlineCode: string = `!function(){if(window.${detectModernBrowserVarName})return;console.warn("vite: loading legacy chunks, syntax error above and the same error below should be ignored");var e=document.getElementById("${legacyPolyfillId}"),n=document.createElement("script");n.src=e.src,n.onload=function(){${systemJSInlineCode}},document.body.appendChild(n)}();`

/** 为每个现代入口生成唯一的 import.meta.resolve 检测依赖，并导出包含其余能力语法的 guard。 */
export const createModernChunkLegacyGuard = (chunkId: string): string =>
  `import'${createDetectImportMetaResolveSupportModule(chunkId)}';export function __vite_legacy_guard(){${detectModernBrowserDetector}};`
