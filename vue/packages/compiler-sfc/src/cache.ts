import { LRUCache } from 'lru-cache'

/**
 * 创建 compiler-sfc 使用的字符串键缓存。
 *
 * 浏览器全局/ESM 构建不能引入 Node 侧 LRU 实现，使用普通 Map；Node 构建使用有上限的
 * LRU，避免开发服务器长期运行、处理大量文件后缓存无限增长。
 */
export function createCache<T extends {}>(
  max = 500,
): Map<string, T> | LRUCache<string, T> {
  /* v8 ignore next 3 */
  if (__GLOBAL__ || __ESM_BROWSER__) {
    return new Map<string, T>()
  }
  return new LRUCache({ max })
}
