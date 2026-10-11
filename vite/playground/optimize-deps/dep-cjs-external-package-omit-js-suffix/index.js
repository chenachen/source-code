/** 从省略最终 .js 后缀的 require 中取出 okay，检验 .okay/.scss/.astro/.tsx 文本路径的扩展名补全。 */
const { okay } = require('./test.okay')
/** 从省略最终 .js 后缀的 require 中取出 scss，检验 .okay/.scss/.astro/.tsx 文本路径的扩展名补全。 */
const { scss } = require('./test.scss')
/** 从省略最终 .js 后缀的 require 中取出 astro，检验 .okay/.scss/.astro/.tsx 文本路径的扩展名补全。 */
const { astro } = require('./test.astro')
/** 从省略最终 .js 后缀的 require 中取出 tsx，检验 .okay/.scss/.astro/.tsx 文本路径的扩展名补全。 */
const { tsx } = require('./test.tsx')

module.exports = { okay, scss, astro, tsx }
