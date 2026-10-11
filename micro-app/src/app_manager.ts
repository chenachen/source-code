import { appInstanceMap } from './create_app'
import { AppInterface } from '@micro-app/types'

/** 定义应用实例注册表对外提供的查询、写入与清理能力。 */
export interface IAppManager {
  /** 按注册表键读取实例，不在此处规范化名称；不存在时返回 `undefined`。 */
  get(appName: string): AppInterface | void
  /** 以应用名为键登记或覆盖应用实例。 */
  set(appName: string, app: AppInterface): void
  /** 复制当前 Map 的值序列；数组是快照，内部仍引用原实例，不克隆运行状态。 */
  getAll(): AppInterface[]
  /** 清空全部实例索引，不触发实例卸载或资源清理。 */
  clear(): void
}

/**
 * 以当前框架 bundle 的单例门面管理 `create_app` 持有的应用实例表。
 *
 * @remarks
 * 当前类不拥有独立存储；所有读写仍落到共享的 `appInstanceMap`，因此通过本类与直接访问该 Map 可见同一状态。
 * 嵌套子应用重新加载框架 bundle 时可拥有另一份 Map；这里的单例不跨 bundle 合并实例。
 */
export class AppManager implements IAppManager {
  /** 首次调用时创建，随后在当前模块中复用的管理器单例。 */
  private static instance: AppManager;
  /** 当前应用实例注册表；暂时复用 `create_app` 导出的共享 Map。 */
  // TODO: appInstanceMap 由 AppManager 来创建，不再由 create_app 管理
  private appInstanceMap = appInstanceMap;

  /** 获取当前模块复用的管理器，并在首次调用时创建它；不同框架bundle不共用此静态字段。 */
  public static getInstance (): AppManager {
    if (!this.instance) {
      this.instance = new AppManager()
    }
    return this.instance
  }

  /** 按调用方提供的键读取共享注册表，不另做名称规范化。 */
  public get (appName: string): AppInterface | void {
    return this.appInstanceMap.get(appName)
  }

  /** 将应用实例写入共享注册表，同名记录会被覆盖。 */
  public set (appName: string, app: AppInterface): void {
    this.appInstanceMap.set(appName, app)
  }

  /** 返回当前 Map 的插入顺序快照，供嵌套卸载遍历；数组变化不改 Map，实例对象仍共享。 */
  public getAll (): AppInterface[] {
    return Array.from(this.appInstanceMap.values())
  }

  /** 清空索引而不调用 unmount/stop；嵌套卸载先逐个调用宿主断开回调，异步清理可能仍在继续。 */
  public clear (): void {
    this.appInstanceMap.clear()
  }
}
