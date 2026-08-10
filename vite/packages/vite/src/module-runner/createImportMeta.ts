import { isWindows } from '../shared/utils'
import { createImportMetaResolver } from './importMetaResolver'
import type { ModuleRunnerImportMeta } from './types'
import { posixDirname, posixPathToFileHref, toWindowsPath } from './utils'

/** 拒绝运行时动态读取的 env 替身；静态字段应已由服务端 transform 展开。 */
const envProxy = new Proxy({} as any, {
  /** 为任意动态属性访问抛出带修复建议的错误。 */
  get(_, p) {
    throw new Error(
      `[module runner] Dynamic access of "import.meta.env" is not supported. Please, use "import.meta.env.${String(p)}" instead.`,
    )
  },
})

/**
 * 创建跨运行时的最小 import.meta：file URL、filename/dirname、受限 env/resolve/glob。
 * 动态 env 与未被静态转换的 glob 明确报错，避免悄悄返回错误值。
 */
export function createDefaultImportMeta(
  modulePath: string,
): ModuleRunnerImportMeta {
  const href = posixPathToFileHref(modulePath)
  const filename = modulePath
  const dirname = posixDirname(modulePath)
  return {
    filename: isWindows ? toWindowsPath(filename) : filename,
    dirname: isWindows ? toWindowsPath(dirname) : dirname,
    url: href,
    env: envProxy,
    /** 默认运行时没有宿主解析器，显式报告不支持。 */
    resolve(_id: string, _parent?: string) {
      throw new Error('[module runner] "import.meta.resolve" is not supported.')
    },
    /** 正常的 import.meta.glob 应在服务端 transform 阶段静态替换。 */
    glob() {
      throw new Error(
        `[module runner] "import.meta.glob" is statically replaced during ` +
          `file transformation. Make sure to reference it by the full name.`,
      )
    },
  }
}

/** 为 Node 增加 `main=false` 与基于 Node loader hook 的 import.meta.resolve。 */
export function createNodeImportMeta(
  modulePath: string,
): ModuleRunnerImportMeta {
  const defaultMeta = createDefaultImportMeta(modulePath)
  const href = defaultMeta.url

  const importMetaResolver = createImportMetaResolver()

  return {
    ...defaultMeta,
    main: false,
    /** 用 Node loader hook 按调用方指定的 parent URL 解析模块标识。 */
    resolve(id: string, parent?: string) {
      const resolver = importMetaResolver ?? defaultMeta.resolve
      return resolver(id, parent ?? href)
    },
  }
}
