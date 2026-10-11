import { cleanUrl, isWindows, slash, unwrapId } from '../shared/utils'
import { SOURCEMAPPING_URL } from '../shared/constants'
import { decodeBase64 } from './utils'
import { DecodedMap } from './sourcemap/decoder'
import type { ResolvedResult } from './types'

/** 提取 Module Runner 代码尾部内联 base64 sourcemap 的捕获表达式。 */
const MODULE_RUNNER_SOURCEMAPPING_REGEXP = new RegExp(
  `//# ${SOURCEMAPPING_URL}=data:application/json;base64,(.+)`,
)

/** Runner 侧模块节点：同时保存执行状态、namespace、依赖图边、服务端元信息与 map。 */
export class EvaluatedModuleNode {
  /** 直接导入当前节点的模块 ID，用于失效向上追踪。 */
  public importers: Set<string> = new Set()
  /** 当前节点本轮执行直接导入的模块 ID。 */
  public imports: Set<string> = new Set()
  /** 本轮求值是否已结束；成功和失败都会置为 true，结果或错误由 promise 保存。 */
  public evaluated = false
  /** 服务端 fetchModule 返回的解析结果与代码。 */
  public meta: ResolvedResult | undefined
  /** 本轮求值 Promise；完成后仍保留，以复用导出或同一错误，失效时清除。 */
  public promise: Promise<any> | undefined
  /** 当前模块的稳定 exports namespace。 */
  public exports: any
  /** 规范 ID 去除 query/hash 后的索引键；虚拟模块和 builtin 也有此键，未必是磁盘文件。 */
  public file: string
  /** 首次需要堆栈映射时惰性解码的 sourcemap。 */
  public map: DecodedMap | undefined

  /** 创建节点并去掉 ID 的 query/hash，得到文件或虚拟模块的分组键。 */
  constructor(
    public id: string,
    public url: string,
  ) {
    this.file = cleanUrl(id)
  }
}

/**
 * Module Runner 本地模块图，分别按规范化 id、真实 file 与原 import URL 建索引。
 * 同一文件可因 query/hash 对应多个节点，而多个 URL 也可解析到同一 id 节点。
 */
export class EvaluatedModules {
  /** 规范模块 ID 到唯一执行节点的主索引。 */
  public readonly idToModuleMap: Map<string, EvaluatedModuleNode> = new Map()
  /** 真实文件到全部 query/hash 模块变体的反向索引。 */
  public readonly fileToModulesMap: Map<string, Set<EvaluatedModuleNode>> =
    new Map()
  /** 请求 URL 到规范执行节点的别名索引。 */
  public readonly urlToIdModuleMap: Map<string, EvaluatedModuleNode> = new Map()

  /** 按 resolved id 取节点；id 通常是带 query/hash 的文件路径，也可为虚拟模块。 */
  public getModuleById(id: string): EvaluatedModuleNode | undefined {
    return this.idToModuleMap.get(id)
  }

  /** 按真实文件取全部 query/hash 变体。 */
  public getModulesByFile(file: string): Set<EvaluatedModuleNode> | undefined {
    return this.fileToModulesMap.get(file)
  }

  /** 按 import 中使用的原 server URL 取节点；URL 本身不在此再次解析。 */
  public getModuleByUrl(url: string): EvaluatedModuleNode | undefined {
    return this.urlToIdModuleMap.get(unwrapId(url))
  }

  /** 确保 resolved id 存在；已有节点会追加新的 URL 别名，否则建立三种索引。 */
  public ensureModule(id: string, url: string): EvaluatedModuleNode {
    id = normalizeModuleId(id)
    if (this.idToModuleMap.has(id)) {
      const moduleNode = this.idToModuleMap.get(id)!
      this.urlToIdModuleMap.set(url, moduleNode)
      return moduleNode
    }
    const moduleNode = new EvaluatedModuleNode(id, url)
    this.idToModuleMap.set(id, moduleNode)
    this.urlToIdModuleMap.set(url, moduleNode)

    const fileModules = this.fileToModulesMap.get(moduleNode.file) || new Set()
    fileModules.add(moduleNode)
    this.fileToModulesMap.set(moduleNode.file, fileModules)
    return moduleNode
  }

  /** 清除模块执行/变换状态与旧 imports，但保留 importers 以支持 HMR 向入口回溯。 */
  public invalidateModule(node: EvaluatedModuleNode): void {
    node.evaluated = false
    node.meta = undefined
    node.map = undefined
    node.promise = undefined
    node.exports = undefined
    // imports 会随新代码变化；保留 importers 让 full reload 能沿已知反向边找到入口。
    // 重求值会追加新边，但这里没有删除旧反向边，所以已移除的依赖也可能保留 importer。
    node.imports.clear()
  }

  /** 从模块代码末尾提取、解码并缓存 Vite 内联 sourcemap；不存在时返回 null。 */
  getModuleSourceMapById(id: string): DecodedMap | null {
    const mod = this.getModuleById(id)
    if (!mod) return null
    if (mod.map) return mod.map
    if (!mod.meta || !('code' in mod.meta)) return null

    const pattern = `//# ${SOURCEMAPPING_URL}=data:application/json;base64,`
    const lastIndex = mod.meta.code.lastIndexOf(pattern)
    if (lastIndex === -1) return null

    const mapString = MODULE_RUNNER_SOURCEMAPPING_REGEXP.exec(
      mod.meta.code.slice(lastIndex),
    )?.[1]
    if (!mapString) return null
    mod.map = new DecodedMap(JSON.parse(decodeBase64(mapString)), mod.file)
    return mod.map
  }

  /** 清空三套索引，供 Runner 关闭或整体重置时释放模块图。 */
  public clear(): void {
    this.idToModuleMap.clear()
    this.fileToModulesMap.clear()
    this.urlToIdModuleMap.clear()
  }
}

/** 必须保留 node: 前缀的内建模块集合；这些模块没有可互换的裸导入名称。 */
// https://nodejs.org/api/modules.html#built-in-modules-with-mandatory-node-prefix
const prefixedBuiltins = new Set([
  'node:sea',
  'node:sqlite',
  'node:test',
  'node:test/reporters',
])

// 把 server/file URL 统一成 graph id：
// virtual:custom -> virtual:custom
// \0custom -> \0custom
// node:fs -> fs
// /@fs/C:/root/id.js => C:/root/id.js
// file:///C:/root/id.js -> C:/root/id.js
/**
 * 把 transport 返回的模块地址归一为 `EvaluatedModules` 使用的图 ID。
 *
 * @param file - virtual ID、Node 内建模块、`file:` URL、`/@fs/` URL 或普通路径。
 * @returns 去除协议差异并统一为 POSIX 分隔符的稳定 ID；带前缀的内建模块保持原样。
 * @remarks 此函数只统一身份，不检查文件是否存在，也不把 virtual ID 误转成磁盘路径。
 */
export function normalizeModuleId(file: string): string {
  if (prefixedBuiltins.has(file)) return file

  // 内部统一 POSIX 分隔符；Windows 仍保留盘符以区分根路径。
  const unixFile = slash(file)
    .replace(/^\/@fs\//, isWindows ? '' : '/')
    .replace(/^node:/, '')
    .replace(/^\/+/, '/')

  // file URL 去 scheme 后保持为文件路径，不转成 server URL。
  return unixFile.replace(/^file:\/+/, isWindows ? '' : '/')
}
