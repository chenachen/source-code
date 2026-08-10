/**
 * 无法作为浏览器 import specifier 的 resolved id 前缀。
 */
export const VALID_ID_PREFIX = `/@id/`

/**
 * Rollup 生态用 `\0` 标记插件虚拟模块（例如运行时 helper），阻止 node resolve 等其他
 * 插件把它当普通文件处理，sourcemap 等核心功能也可据此区分虚拟/真实模块。
 *
 * import URL 不允许 null byte，所以 import analysis 临时替换成该占位符；进入插件管线前
 * 再解码。配合 {@link VALID_ID_PREFIX}，浏览器最终看到 `/@id/__x00__{id}`。
 */
export const NULL_BYTE_PLACEHOLDER = `__x00__`

/** 拆开拼接，避免源码文件自身被 sourcemap 注释扫描器误识别为有效标记。 */
export let SOURCEMAPPING_URL = 'sourceMa'
SOURCEMAPPING_URL += 'ppingURL'

/** 标识由 Module Runner 专用流程生成的内联 sourcemap，避免重复附加。 */
export const MODULE_RUNNER_SOURCEMAPPING_SOURCE =
  '//# sourceMappingSource=vite-generated'

/** 依赖优化产物已过期时使用的稳定错误码，HMR 可忽略并等待新版本。 */
export const ERR_OUTDATED_OPTIMIZED_DEP = 'ERR_OUTDATED_OPTIMIZED_DEP'
