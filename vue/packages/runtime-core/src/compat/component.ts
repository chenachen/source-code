import { isFunction, isObject } from '@vue/shared'
import type { Component, ComponentInternalInstance } from '../component'
import {
  DeprecationTypes,
  checkCompatEnabled,
  softAssertCompatEnabled,
} from './compatConfig'
import { convertLegacyAsyncComponent } from './componentAsync'
import { convertLegacyFunctionalComponent } from './componentFunctional'

/**
 * 把 Vue 2 组件构造器、异步工厂和 `functional: true` 选项转换为 Vue 3 可执行组件。
 * 已标记的内置组件直接返回，避免兼容探测把函数式内置类型误判为旧异步组件。
 */
export function convertLegacyComponent(
  comp: any,
  instance: ComponentInternalInstance | null,
): Component {
  if (comp.__isBuiltIn) {
    return comp
  }

  // Vue 2 `Vue.extend()` 构造器带 cid，真实组件选项位于 `.options`。
  if (isFunction(comp) && comp.cid) {
    // #7766：SFC 编译器可能把 render 直接写在构造器而非 options 上，转换前必须迁移，
    // 否则组件只有模板元数据却没有可执行 render，最终渲染为空。
    if (comp.render) {
      // 仅 SFC 编译产物需要这次同步。
      comp.options.render = comp.render
    }
    // 同步 SFC 文件来源、HMR id 与 scoped CSS id，保留开发工具/样式能力。
    comp.options.__file = comp.__file
    comp.options.__hmrId = comp.__hmrId
    comp.options.__scopeId = comp.__scopeId
    comp = comp.options
  }

  // Vue 2 异步组件工厂也是普通函数，只有兼容开关开启时才按旧协议调用。
  if (
    isFunction(comp) &&
    checkCompatEnabled(DeprecationTypes.COMPONENT_ASYNC, instance, comp)
  ) {
    // 关闭兼容后普通函数仍是合法 Vue 3 函数组件，不能用 softAssert 后继续强制转换。
    return convertLegacyAsyncComponent(comp)
  }

  // Vue 2 `{ functional: true, render(h, ctx) }` 转为 Vue 3 FunctionalComponent。
  if (
    isObject(comp) &&
    comp.functional &&
    softAssertCompatEnabled(
      DeprecationTypes.COMPONENT_FUNCTIONAL,
      instance,
      comp,
    )
  ) {
    return convertLegacyFunctionalComponent(comp)
  }

  return comp
}
