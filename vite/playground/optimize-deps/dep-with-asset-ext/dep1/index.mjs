export default { random: Math.random() }

/** 按 import.meta.url 是否包含 /.vite/deps/ 判断当前模块是否来自预构建输出。 */
export const isPreBundled = import.meta.url.includes('/.vite/deps/')
