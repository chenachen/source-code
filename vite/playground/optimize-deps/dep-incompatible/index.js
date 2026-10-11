/** 动态 import 目标的相对路径文本，用作预构建不兼容 URL 动态导入输入。 */
const target = './sub.js'
/** 以 import.meta.url 解析 sub.js 的 URL，供运行时动态 import 使用。 */
const subUrl = new URL(target, import.meta.url)

export default () => import(subUrl)
