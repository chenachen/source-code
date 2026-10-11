// 模块会被配置中的优化器 Rolldown load 插件整体替换；目录名保留历史 esbuild 命名。

/** 包原始 hello 函数；配置中的 Rolldown load 插件会替换整个模块，供优化插件转换对照。 */
export const hello = () => `Hello from a package`
