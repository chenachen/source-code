import path from 'node:path'
import { cleanUrl, withTrailingSlash } from '../shared/utils'
import type { ResolvedConfig } from './config'
import {
  ERR_SYMLINK_IN_RECURSIVE_READDIR,
  normalizePath,
  recursiveReaddir,
  tryStatSync,
} from './utils'

/**
 * 每份已解析配置对应的 public 文件路径缓存。
 *
 * 使用 WeakMap 可让配置对象生命周期结束时自动释放整棵文件清单；Set 中保存
 * 以 `/` 开头、相对 publicDir 的 URL 路径，用于请求热路径的 O(1) 判断。
 */
const publicFilesMap = new WeakMap<ResolvedConfig, Set<string>>()

/**
 * 启动时递归扫描 publicDir，并建立按 URL 查询的内存索引。
 *
 * 若扫描遇到目录符号链接，`recursiveReaddir` 无法安全保证递归边界，此时放弃
 * 缓存并让后续请求走逐文件 stat；其他 I/O 错误继续抛出，避免静默隐藏配置问题。
 */
export async function initPublicFiles(
  config: ResolvedConfig,
): Promise<Set<string> | undefined> {
  let fileNames: string[]
  try {
    fileNames = await recursiveReaddir(config.publicDir)
  } catch (e) {
    if (e.code === ERR_SYMLINK_IN_RECURSIVE_READDIR) {
      return
    }
    throw e
  }
  const publicFiles = new Set(
    fileNames.map((fileName) => fileName.slice(config.publicDir.length)),
  )
  publicFilesMap.set(config, publicFiles)
  return publicFiles
}

/** 读取与当前已解析配置绑定的 public 文件缓存。 */
function getPublicFiles(config: ResolvedConfig): Set<string> | undefined {
  return publicFilesMap.get(config)
}

/**
 * 判断一个根相对请求是否精确对应 publicDir 中的普通文件，并返回规范化绝对路径。
 *
 * 有启动缓存时直接查询 Set；无缓存时拼接磁盘路径，但必须先校验结果仍位于
 * publicDir 内，阻止 `/../` 形式的路径穿越，最后再确认目标确实是文件。
 */
export function checkPublicFile(
  url: string,
  config: ResolvedConfig,
): string | undefined {
  // public 文件在解析器中会保持 URL 原样返回，因此这里接收的不是已解析绝对路径。
  const { publicDir } = config
  if (!publicDir || url[0] !== '/') {
    return
  }

  const fileName = cleanUrl(url)

  // 启动扫描成功时走内存短路，避免每个请求都触发同步 stat。
  const publicFiles = getPublicFiles(config)
  if (publicFiles) {
    return publicFiles.has(fileName)
      ? normalizePath(path.join(publicDir, fileName))
      : undefined
  }

  const publicFile = normalizePath(path.join(publicDir, fileName))
  if (!publicFile.startsWith(withTrailingSlash(publicDir))) {
    // URL 以 `../` 开头时可能越过 publicDir，必须在访问磁盘前拒绝。
    return
  }

  return tryStatSync(publicFile)?.isFile() ? publicFile : undefined
}
