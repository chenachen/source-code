/** 子目录中用 package imports 的 #imports/* eager glob，验证 imports 定位不依赖 importer 与 package.json 同层。 */
export const globbed = import.meta.glob('#imports/*', { eager: true })
