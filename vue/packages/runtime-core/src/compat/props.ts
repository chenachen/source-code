import { isArray } from '@vue/shared'
import { inject } from '../apiInject'
import type { ComponentInternalInstance, Data } from '../component'
import {
  type ComponentOptions,
  resolveMergedOptions,
} from '../componentOptions'
import { DeprecationTypes, warnDeprecation } from './compatConfig'

/**
 * 为 Vue 2 prop 默认值工厂模拟 `this`。
 * Vue 3 默认值函数不再绑定组件实例；兼容 Proxy 仅按需暴露 `$options`、当前 props
 * 对象和组件自身声明的 inject，开发环境访问字段时发出弃用警告。
 * 传入的 props 已规范化键名，部分值可能已经完成默认值/Boolean 转换，并非 VNode rawProps。
 */
export function createPropsDefaultThis(
  instance: ComponentInternalInstance,
  rawProps: Data,
  propKey: string,
): object {
  return new Proxy(
    {},
    {
      /** 按 $options、当前已写入 props、组件自身 inject 的顺序模拟默认值工厂 this；未知键返回 undefined。 */
      get(_, key: string) {
        __DEV__ &&
          warnDeprecation(DeprecationTypes.PROPS_DEFAULT_THIS, null, propKey)
        // `$options`：返回当前应用/mixin 合并后的组件选项。
        if (key === '$options') {
          return resolveMergedOptions(instance)
        }
        // 读取此时已写入 props 对象的值，初始化时部分键可能仍待转换。
        if (key in rawProps) {
          return rawProps[key]
        }
        // 兼容读取组件声明的 inject。
        const injections = (instance.type as ComponentOptions).inject
        if (injections) {
          if (isArray(injections)) {
            if (injections.includes(key)) {
              return inject(key)
            }
          } else if (key in injections) {
            return inject(key)
          }
        }
      },
    },
  )
}
