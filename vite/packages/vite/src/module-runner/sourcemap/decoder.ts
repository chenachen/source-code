import type { OriginalMapping } from '@jridgewell/trace-mapping'
import { originalPositionFor } from '@jridgewell/trace-mapping'
import { posixDirname, posixResolve } from '../utils'

/** DecodedMap 实际消费的最小 Source Map v3 字段集合。 */
interface SourceMapLike {
  /** Source Map 规范版本，当前通常为 3。 */
  version: number
  /** VLQ 编码的生成位置映射。 */
  mappings?: string
  /** 映射段引用的原始符号名称表。 */
  names?: string[]
  /** 相对 map 文件的原始源码路径。 */
  sources?: string[]
  /** 可选内嵌原始源码，与 sources 按索引对应。 */
  sourcesContent?: string[]
}

/** trace-mapping 查询使用的零基列、一基行生成位置。 */
type Needle = {
  /** 生成代码行号。 */
  line: number
  /** 生成代码零基列号。 */
  column: number
}

/**
 * `@jridgewell/trace-mapping` 可直接消费的轻量 sourcemap 包装。
 * sources 在构造时相对 map 所在目录解析，后续堆栈映射无需重复做路径运算。
 */
export class DecodedMap {
  /** 原始 VLQ mappings 字符串。 */
  _encoded: string
  /** trace-mapping 惰性生成的解码段表。 */
  _decoded: undefined | number[][][]
  /** trace-mapping 二分查询复用的游标状态。 */
  _decodedMemo: Stats
  /** sourcemap 自身的解析基准地址。 */
  url: string
  /** 兼容 trace-mapping 的 map 文件名。 */
  file: string
  /** Source Map 规范版本。 */
  version: number
  /** 原始符号名称表。 */
  names: string[] = []
  /** 已相对 map 所在目录解析的源码绝对路径。 */
  resolvedSources: string[]

  /** 规范化映射表并预解析 sources 路径。 */
  constructor(
    public map: SourceMapLike,
    from: string,
  ) {
    const { mappings, names, sources } = map
    this.version = map.version
    this.names = names || []
    this._encoded = mappings || ''
    this._decodedMemo = memoizedState()
    this.url = from
    this.file = from
    const originDir = posixDirname(from)
    this.resolvedSources = (sources || []).map((s) =>
      posixResolve(originDir, s || ''),
    )
  }
}

/** trace-mapping 在连续查询间复用的二分搜索位置。 */
interface Stats {
  /** 上次查询使用的排序键。 */
  lastKey: number
  /** 上次 needle 的编码值。 */
  lastNeedle: number
  /** 上次命中的映射段索引。 */
  lastIndex: number
}

/** 创建 trace-mapping 使用的查询游标缓存。 */
function memoizedState(): Stats {
  return {
    lastKey: -1,
    lastNeedle: -1,
    lastIndex: -1,
  }
}

/** 查询生成位置对应的原始位置；返回值缺少列号时视为没有可用映射。 */
export function getOriginalPosition(
  map: DecodedMap,
  needle: Needle,
): OriginalMapping | null {
  const result = originalPositionFor(map as any, needle)
  if (result.column == null) {
    return null
  }
  return result
}
