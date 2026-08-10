/* eslint-disable no-restricted-globals */
import {
  type ClassComponent,
  type ComponentInternalInstance,
  type ComponentOptions,
  type ConcreteComponent,
  type InternalRenderFunction,
  isClassComponent,
} from './component'
import { SchedulerJobFlags, queueJob, queuePostFlushCb } from './scheduler'
import { extend, getGlobalThis } from '@vue/shared'

/** HMR 可更新的普通选项组件或 class 组件。 */
type HMRComponent = ComponentOptions | ClassComponent

/** 当前 renderer 是否正在执行热更新；部分优化路径据此强制完整更新。 */
export let isHmrUpdating = false

/** 设置 HMR 状态并返回旧值，便于调用方在 finally 中恢复嵌套前状态。 */
export const setHmrUpdating = (v: boolean): boolean => {
  try {
    return isHmrUpdating
  } finally {
    isHmrUpdating = v
  }
}

/**
 * 需要在本轮 patch 中强制替换的组件定义及其实例集合。
 * renderer 看到 dirty 定义会跳过“同类型复用”，从而重新创建实例；post-flush 后清空。
 */
export const hmrDirtyComponents: Map<
  ConcreteComponent,
  Set<ComponentInternalInstance>
> = new Map<ConcreteComponent, Set<ComponentInternalInstance>>()

/** SFC 工具链通过全局对象调用的 HMR 运行时协议。 */
export interface HMRRuntime {
  createRecord: typeof createRecord
  rerender: typeof rerender
  reload: typeof reload
}

// 将 HMR runtime 放在全局对象而非公共导出中，既方便 vue-loader/Vite 注入代码调用，
// 又能让生产构建完整 tree-shake。组件还必须带编译器生成的 __hmrId，实例才会登记。
if (__DEV__) {
  getGlobalThis().__VUE_HMR_RUNTIME__ = {
    createRecord: tryWrap(createRecord),
    rerender: tryWrap(rerender),
    reload: tryWrap(reload),
  } as HMRRuntime
}

/** HMR id 到初始组件定义及当前活动实例集合的注册表。 */
const map: Map<
  string,
  {
    // 模块导入时就保存初始定义；即使当前没有活动实例，热更新也能修改定义，保证
    // 之后新挂载的实例使用最新代码。
    initialDef: ComponentOptions
    /** 当前已挂载、具有相同 __hmrId 的实例。 */
    instances: Set<ComponentInternalInstance>
  }
> = new Map()

/** 将组件实例登记到其 `__hmrId` 记录中。 */
export function registerHMR(instance: ComponentInternalInstance): void {
  const id = instance.type.__hmrId!
  let record = map.get(id)
  if (!record) {
    createRecord(id, instance.type as HMRComponent)
    record = map.get(id)!
  }
  record.instances.add(instance)
}

/** 组件卸载时从 HMR 记录移除实例，避免后续更新访问已销毁 job。 */
export function unregisterHMR(instance: ComponentInternalInstance): void {
  map.get(instance.type.__hmrId!)!.instances.delete(instance)
}

/** 为 SFC id 创建初始记录；已存在时返回 false，避免重复模块注册覆盖热状态。 */
function createRecord(id: string, initialDef: HMRComponent): boolean {
  if (map.has(id)) {
    return false
  }
  map.set(id, {
    initialDef: normalizeClassComponent(initialDef),
    instances: new Set(),
  })
  return true
}

/** class 组件的实际可变选项保存在 `__vccOpts`，普通组件直接返回。 */
function normalizeClassComponent(component: HMRComponent): ComponentOptions {
  return isClassComponent(component) ? component.__vccOpts : component
}

/**
 * 仅替换组件 render 函数，保留现有实例状态与 setup/data。
 * 清空 renderCache 后同步更新每个实例；快照遍历避免更新期间 mount/unmount 修改 Set。
 */
function rerender(id: string, newRender?: Function): void {
  const record = map.get(id)
  if (!record) {
    return
  }

  // 同步初始定义，保证之后才挂载的实例也使用新 render。
  record.initialDef.render = newRender

  // 使用快照，避免更新过程中实例注册/注销改变 Set 迭代结果。
  ;[...record.instances].forEach(instance => {
    if (newRender) {
      instance.render = newRender as InternalRenderFunction
      normalizeClassComponent(instance.type as HMRComponent).render = newRender
    }
    instance.renderCache = []
    // 标记会迫使带插槽的子组件更新，并让 Teleport 等放弃可能过期的块优化。
    isHmrUpdating = true
    // #13771：组件可能已卸载、job 标为 DISPOSED，不能再次执行其 update effect。
    if (!(instance.job.flags! & SchedulerJobFlags.DISPOSED)) {
      instance.update()
    }
    isHmrUpdating = false
  })
}

/**
 * 组件脚本/选项发生变化时完整重载实例。
 * 更新组件定义与选项缓存后，令父组件重渲染并让 renderer 将 dirty 实例卸载重建；
 * 根组件、自定义元素和手写 render 根各有独立重载退路。
 */
function reload(id: string, newComp: HMRComponent): void {
  const record = map.get(id)
  if (!record) return

  newComp = normalizeClassComponent(newComp)
  // 更新初始定义，覆盖未来实例。
  updateComponentDef(record.initialDef, newComp)

  // 更新会导致实例卸载/重建，因此必须遍历快照。
  const instances = [...record.instances]

  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i]
    const oldComp = normalizeClassComponent(instance.type as HMRComponent)

    let dirtyInstances = hmrDirtyComponents.get(oldComp)
    if (!dirtyInstances) {
      // 1. 将当前实例使用的旧定义原地同步为新定义。
      if (oldComp !== record.initialDef) {
        updateComponentDef(oldComp, newComp)
      }
      // 2. 标记定义 dirty，renderer patch 时即使 type 引用相同也会强制替换实例。
      hmrDirtyComponents.set(oldComp, (dirtyInstances = new Set()))
    }
    dirtyInstances.add(instance)

    // 3. props/emits/Options API 选项可能变化，清除应用级规范化缓存。
    instance.appContext.propsCache.delete(instance.type as any)
    instance.appContext.emitsCache.delete(instance.type as any)
    instance.appContext.optionsCache.delete(instance.type as any)

    // 4. 按宿主形态真正触发更新。
    if (instance.ceReload) {
      // 自定义元素自行重载组件与样式，无需父组件。
      dirtyInstances.add(instance)
      instance.ceReload((newComp as any).styles)
      dirtyInstances.delete(instance)
    } else if (instance.parent) {
      // 普通子组件通过父组件重渲染进入 renderer 替换流程。放入 scheduler 可把同一
      // 父级下多个热更新实例合并成一次 render。
      queueJob(() => {
        // vite-plugin-vue#599：排队期间实例可能已卸载，disposed job 不再更新。
        if (!(instance.job.flags! & SchedulerJobFlags.DISPOSED)) {
          isHmrUpdating = true
          instance.parent!.update()
          isHmrUpdating = false
          // #6930/#11248：替换完成即移除实例 dirty 标记，否则父更新会持续把新实例
          // 当作待替换对象，引发递归重载。
          dirtyInstances.delete(instance)
        }
      })
    } else if (instance.appContext.reload) {
      // createApp 挂载的根实例由 AppContext.reload 重建根 VNode。
      instance.appContext.reload()
    } else if (typeof window !== 'undefined') {
      // 手写 render() 创建的浏览器根没有 App reload 入口，只能刷新页面。
      window.location.reload()
    } else {
      console.warn(
        '[HMR] Root or manually mounted instance modified. Full reload required.',
      )
    }

    // 自定义元素根还要移除旧子组件注入的样式，避免 style 标签残留。
    if (instance.root.ce && instance !== instance.root) {
      instance.root.ce._removeChildStyle(oldComp)
    }
  }

  // 5. 所有重渲染提交后统一清除 dirty 定义。
  queuePostFlushCb(() => {
    hmrDirtyComponents.clear()
  })
}

/**
 * 原地把旧组件定义同步为新定义，同时删除新版本已不存在的选项。
 * 保留 `__file` 便于 devtools/HMR 继续显示原始文件来源。
 */
function updateComponentDef(
  oldComp: ComponentOptions,
  newComp: ComponentOptions,
) {
  extend(oldComp, newComp)
  for (const key in oldComp) {
    if (key !== '__file' && !(key in newComp)) {
      delete oldComp[key]
    }
  }
}

/**
 * 包装暴露给构建工具的 HMR 入口。热更新错误不能破坏当前页面运行，因而捕获异常并
 * 提示工具执行整页刷新，而不是让错误穿透全局回调。
 */
function tryWrap(fn: (id: string, arg: any) => any): Function {
  return (id: string, arg: any) => {
    try {
      return fn(id, arg)
    } catch (e: any) {
      console.error(e)
      console.warn(
        `[HMR] Something went wrong during Vue component hot-reload. ` +
          `Full reload required.`,
      )
    }
  }
}
