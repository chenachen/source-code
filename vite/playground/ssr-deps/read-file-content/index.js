/** Node 路径模块；将调用者传入的文件路径解析为绝对路径后交给 fs/promises。 */
const path = require('node:path')

/** 将命名异步函数赋给 CommonJS 默认出口，使 SSR 默认导入能够调用文件读取逻辑。 */
module.exports =
  /** 用 UTF-8 读取解析后的文件路径并返回内容 Promise；读取失败直接拒绝，由 SSR 渲染服务捕获。 */
  async function readFileContent(filePath) {
    const fs = require('node:fs/promises')
    return await fs.readFile(path.resolve(filePath), 'utf-8')
  }
