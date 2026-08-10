import { appInstanceMap } from './create_app'
import { AppInterface } from '@micro-app/types'

/** 定义应用实例注册表对外提供的查询、写入与清理能力。 */
export interface IAppManager {
  /** 按格式化后的应用名读取实例；不存在时返回 `void`。 */
  get(appName: string): AppInterface | void
  /** 以应用名为键登记或覆盖应用实例。 */
  set(appName: string, app: AppInterface): void
  /** 返回注册表中全部应用实例的当前快照。 */
  getAll(): AppInterface[]
  /** 清空全部应用实例记录。 */
  clear(): void
}

/**
 * 以单例门面管理 `create_app` 持有的全局应用实例表。
 *
 * @remarks
 * 当前类不拥有独立存储；所有读写仍落到共享的 `appInstanceMap`，因此通过本类与直接访问该 Map 可见同一状态。
 */
export class AppManager implements IAppManager {
  /** 延迟创建并在进程内复用的管理器单例。 */
  private static instance: AppManager;
  /** 当前应用实例注册表；暂时复用 `create_app` 导出的共享 Map。 */
  // TODO: appInstanceMap 由 AppManager 来创建，不再由 create_app 管理
  private appInstanceMap = appInstanceMap;

  /** 获取全局唯一管理器，并在首次调用时创建它。 */
  public static getInstance (): AppManager {
    if (!this.instance) {
      this.instance = new AppManager()
    }
    return this.instance
  }

  /** 按应用名读取共享注册表中的实例。 */
  public get (appName: string): AppInterface | void {
    return this.appInstanceMap.get(appName)
  }

  /** 将应用实例写入共享注册表，同名记录会被覆盖。 */
  public set (appName: string, app: AppInterface): void {
    this.appInstanceMap.set(appName, app)
  }

  /** 把共享注册表当前值复制为数组返回。 */
  public getAll (): AppInterface[] {
    return Array.from(this.appInstanceMap.values())
  }

  /** 清空共享注册表，使所有已登记实例失去索引。 */
  public clear (): void {
    this.appInstanceMap.clear()
  }
}
