/** 声明配置插件生成的虚拟模块，允许 TypeScript 页面入口导入其默认字符串。 */
declare module 'absolute-importer' {
  /** 虚拟模块转发磁盘绝对路径依赖的默认导出，页面把它作为验证结果显示。 */
  const msg: string
  export default msg
}
