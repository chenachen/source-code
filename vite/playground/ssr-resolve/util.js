import { pathToFileURL } from 'node:url'

/** 返回传入字符串，作为实际使用的服务端导出；与同文件未使用的 treeshaken 导出形成构建裁剪对照。 */
export function used(s) {
  return s
}

// 该导出未被入口使用，函数中的 node:url 调用应随未使用代码被裁掉。
/** 调用 Node 的 pathToFileURL；入口未使用这个导出，服务端构建应能裁掉该函数对应的代码。 */
export function treeshaken(s) {
  return pathToFileURL(s)
}
