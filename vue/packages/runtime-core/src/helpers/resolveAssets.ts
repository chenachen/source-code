import {
  type ComponentOptions,
  type ConcreteComponent,
  currentInstance,
  getComponentName,
} from '../component'
import { currentRenderingInstance } from '../componentRenderContext'
import type { Directive } from '../directives'
import { camelize, capitalize, isString } from '@vue/shared'
import { warn } from '../warning'
import type { VNodeTypes } from '../vnode'

/** AppContext/组件选项中组件注册表的字段名。 */
export const COMPONENTS = 'components'
/** AppContext/组件选项中指令注册表的字段名。 */
export const DIRECTIVES = 'directives'
/** Vue 2 兼容构建中过滤器注册表的字段名。 */
export const FILTERS = 'filters'

/** 可通过运行时名称解析的资源种类。 */
export type AssetTypes = typeof COMPONENTS | typeof DIRECTIVES | typeof FILTERS

/**
 * @private 解析模板/渲染函数中的组件名；找不到时返回原字符串，让 renderer 按
 * 原生/自定义元素继续创建，而不是直接中断渲染。
 *
 * @private
 */
export function resolveComponent(
  name: string,
  maybeSelfReference?: boolean,
): ConcreteComponent | string {
  return resolveAsset(COMPONENTS, name, true, maybeSelfReference) || name
}

/** 动态组件值为空时的内部占位类型，createVNode 会将其规范化为注释节点。 */
export const NULL_DYNAMIC_COMPONENT: unique symbol = Symbol.for('v-ndc')

/**
 * @private 解析 `<component :is>` 的动态值。字符串尝试查组件注册表，非字符串直接
 * 作为 VNode 类型；null/undefined 使用专用空组件标记。
 */
export function resolveDynamicComponent(component: unknown): VNodeTypes {
  if (isString(component)) {
    return resolveAsset(COMPONENTS, component, false) || component
  } else {
    // 其他非法类型交由 createVNode 统一发出 VNode 类型警告。
    return (component || NULL_DYNAMIC_COMPONENT) as any
  }
}

/**
 * @private 从当前组件的局部/全局注册表解析指令。
 */
export function resolveDirective(name: string): Directive | undefined {
  return resolveAsset(DIRECTIVES, name)
}

/**
 * @internal 仅 Vue 2 兼容构建：解析过滤器。
 */
export function resolveFilter(name: string): Function | undefined {
  return resolveAsset(FILTERS, name)
}

/**
 * @private 资源解析的组件重载。
 */
function resolveAsset(
  type: typeof COMPONENTS,
  name: string,
  warnMissing?: boolean,
  maybeSelfReference?: boolean,
): ConcreteComponent | undefined
// 重载 2：指令。
function resolveAsset(
  type: typeof DIRECTIVES,
  name: string,
): Directive | undefined
// 重载 3：仅兼容构建的过滤器。
function resolveAsset(type: typeof FILTERS, name: string): Function | undefined
/**
 * 按名称解析当前渲染实例可见的组件、指令或过滤器。
 * 优先级为显式组件自引用 -> 局部注册 -> 应用全局注册 -> 可选隐式自引用；每层都
 * 兼容原名、camelCase、PascalCase，覆盖模板 kebab-case 与 JS 注册名的差异。
 */
function resolveAsset(
  type: AssetTypes,
  name: string,
  warnMissing = true,
  maybeSelfReference = false,
) {
  const instance = currentRenderingInstance || currentInstance
  if (instance) {
    const Component = instance.type

    // 显式组件 name 的自引用优先级最高，使递归组件无需在 components 中注册自己。
    if (type === COMPONENTS) {
      const selfName = getComponentName(
        Component,
        false /* 不使用文件名推断名称，避免改变既有解析优先级 */,
      )
      if (
        selfName &&
        (selfName === name ||
          selfName === camelize(name) ||
          selfName === capitalize(camelize(name)))
      ) {
        return Component
      }
    }

    const res =
      // 先查实例上经过 Options API 合并的注册表，再查组件定义自身的局部注册表。
      resolve(instance[type] || (Component as ComponentOptions)[type], name) ||
      // 最后查当前 App 的全局注册表。
      resolve(instance.appContext[type], name)

    if (!res && maybeSelfReference) {
      // 编译器确认可能是自引用时，未注册名称可回退到当前组件定义。
      return Component
    }

    if (__DEV__ && warnMissing && !res) {
      const extra =
        type === COMPONENTS
          ? `\nIf this is a native custom element, make sure to exclude it from ` +
            `component resolution via compilerOptions.isCustomElement.`
          : ``
      warn(`Failed to resolve ${type.slice(0, -1)}: ${name}${extra}`)
    }

    return res
  } else if (__DEV__) {
    warn(
      `resolve${capitalize(type.slice(0, -1))} ` +
        `can only be used in render() or setup().`,
    )
  }
}

/** 在注册表中依次尝试原名、camelCase 与 PascalCase。 */
function resolve(registry: Record<string, any> | undefined, name: string) {
  return (
    registry &&
    (registry[name] ||
      registry[camelize(name)] ||
      registry[capitalize(camelize(name))])
  )
}
