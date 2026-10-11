import type { LinkSourceInfo, ScriptSourceInfo, SourceAddress } from '@micro-app/types'
import { isInlineScript } from '../libs/utils'

/**
 * 全局资源中心契约。
 *
 * link 与 script 使用完整资源地址作为键，在应用之间共享原始代码；应用相关的属性、
 * CSS 前缀与编译结果保存在各资源的 `appSpace` 中，避免跨应用状态互相覆盖。
 */
export interface SourceCenter<L = LinkSourceInfo, S = ScriptSourceInfo> {
  /** 外链样式资源缓存。 */
  link: {
    /** 写入或替换指定地址的样式资源信息。 */
    setInfo (address: SourceAddress, info: L): void,
    /** 读取样式资源信息；未命中时返回 `null`。 */
    getInfo (address: SourceAddress): L | null,
    /** 判断指定样式地址是否已登记。 */
    hasInfo (address: SourceAddress): boolean,
    /** 删除指定样式地址及所有应用空间数据。 */
    deleteInfo (address: SourceAddress): boolean,
  },
  /** 外部脚本与静态内联脚本资源缓存。 */
  script: {
    /** 写入或替换指定地址的脚本资源信息。 */
    setInfo (address: SourceAddress, info: S): void,
    /** 读取脚本资源信息；未命中时返回 `null`。 */
    getInfo (address: SourceAddress): S | null,
    /** 判断指定脚本地址是否已登记。 */
    hasInfo (address: SourceAddress): boolean,
    /** 删除指定脚本地址及所有应用空间数据。 */
    deleteInfo (address: SourceAddress): boolean,
    /** 按给定集合删除全局缓存中的静态内联脚本；不修改集合本身，远程资源及 appSpace 继续保留。 */
    deleteInlineInfo (addressList: Set<SourceAddress>): void,
  }
}

/** 外链样式地址到其全局代码及应用空间数据的映射。 */
export type LinkListType = Map<SourceAddress, LinkSourceInfo>
/** 脚本地址或内联 nonce 到其全局代码及应用空间数据的映射。 */
export type ScriptListType = Map<SourceAddress, ScriptSourceInfo>

/**
 * 创建当前框架模块共享的 link/script 资源中心。
 *
 * 远程资源按完整地址全局共享，因此带不同查询参数的地址会形成不同缓存项。非空原始代码
 * 命中后可跳过下载，插件、CSS 前缀、沙箱类型等应用相关结果继续保存在
 * `appSpace`。这里不保存进行中的请求，代码尚未写入时的并发调用仍会各自下载。静态内联
 * 脚本使用随机 nonce 登记，应用彻底销毁时单独清除。
 * 嵌套应用另行加载框架 bundle 时可拥有独立模块副本，这里的 Map 不跨副本汇合。
 */
function createSourceCenter (): SourceCenter {
  // 两个 Map 被返回的处理器闭包持有，生命周期与默认导出的资源中心单例一致。
  const linkList: LinkListType = new Map()
  const scriptList: ScriptListType = new Map()

  /** 为指定 Map 构造统一的增删查处理器，并把缓存未命中统一表示为 `null`。 */
  function createSourceHandler <P, T extends Map<SourceAddress, P>> (targetList: T): SourceCenter<P>['link'] | SourceCenter<LinkSourceInfo, P>['script'] {
    return {
      /** 把资源信息写入目标缓存。 */
      setInfo (address: SourceAddress, info: P): void {
        targetList.set(address, info)
      },
      /** 从目标缓存读取资源信息。 */
      getInfo (address: SourceAddress): P | null {
        return targetList.get(address) ?? null
      },
      /** 检查目标缓存是否包含该地址。 */
      hasInfo (address: SourceAddress): boolean {
        return targetList.has(address)
      },
      /** 从目标缓存删除该地址。 */
      deleteInfo (address: SourceAddress): boolean {
        return targetList.delete(address)
      }
    }
  }

  return {
    link: createSourceHandler<LinkSourceInfo, LinkListType>(linkList),
    script: {
      ...createSourceHandler<ScriptSourceInfo, ScriptListType>(scriptList),
      /** 根据应用集合清除全局内联 nonce，不从该 Set 删除键；远程地址及各 appSpace 继续留存。 */
      deleteInlineInfo (addressList: Set<SourceAddress>): void {
        addressList.forEach((address) => {
          if (isInlineScript(address)) {
            scriptList.delete(address)
          }
        })
      }
    },
  }
}

/** 全局共享资源中心单例。 */
export default createSourceCenter()
