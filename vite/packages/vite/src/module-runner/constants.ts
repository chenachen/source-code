// 名称也由 ssrTransform 插件导出；Runner 为避免加载 Node 侧变换器及其依赖，在此保留
// 轻量副本。两端共同构成生成代码与求值上下文的协议，值必须严格一致。
/** 当前模块 exports namespace 的上下文 key。 */
export const ssrModuleExportsKey = `__vite_ssr_exports__`
/** 静态 import 请求函数的上下文 key。 */
export const ssrImportKey = `__vite_ssr_import__`
/** 动态 import 请求函数的上下文 key。 */
export const ssrDynamicImportKey = `__vite_ssr_dynamic_import__`
/** 转发 `export *` 的上下文 key。 */
export const ssrExportAllKey = `__vite_ssr_exportAll__`
/** 以 getter 注册命名 live binding 的上下文 key。 */
export const ssrExportNameKey = `__vite_ssr_exportName__`
/** 当前模块 `import.meta` 对象的上下文 key。 */
export const ssrImportMetaKey = `__vite_ssr_import_meta__`
