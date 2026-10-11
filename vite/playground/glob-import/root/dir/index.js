/** 目录内 eager glob 的命名空间表，保留 js/ts 扩展匹配并排除 importer 自身。 */
const modules = import.meta.glob('./*.{js,ts}', { eager: true })
/** 别名模式 @dir/al*.js 的 eager 结果，页面按 root 绝对键检查 alias.js。 */
const globWithAlias = import.meta.glob('@dir/al*.js', { eager: true })

// 负模式在正模式前后都应排除 x.js。
import.meta.glob(['@dir/*.js', '!@dir/x.js'])
import.meta.glob(['!@dir/x.js', '@dir/*.js'])

// 保留普通日志语句，作为 glob 改写后的 source map 观察位置。
console.log('hello')

export { modules, globWithAlias }
