import path from 'node:path'
import * as staticModule from './simple'
import { pathToFileURL } from 'node:url'

/** 分别动态加载字面量、相对/绝对变量、磁盘路径和 file URL，返回各 namespace 与静态 import 对照。 */
export const initialize = async () => {
  const nameRelative = './simple'
  const nameAbsolute = '/fixtures/simple'
  const nameAbsoluteExtension = '/fixtures/simple.js'
  const absolutePath = path.join(import.meta.dirname, 'simple.js')
  const fileUrl = pathToFileURL(absolutePath)
  return {
    dynamicProcessed: await import('./simple'),
    dynamicRelative: await import(nameRelative),
    dynamicAbsolute: await import(nameAbsolute),
    dynamicAbsoluteExtension: await import(nameAbsoluteExtension),
    dynamicAbsoluteFull: await import(
      (process.platform === 'win32' ? '/@fs/' : '') + absolutePath
    ),
    dynamicFileUrl: await import(fileUrl),
    static: staticModule,
  }
}
