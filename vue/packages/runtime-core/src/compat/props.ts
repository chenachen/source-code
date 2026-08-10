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
 * Vue 3 默认值函数不再绑定组件实例；兼容 Proxy 仅按需暴露 `$options`、原始 props 和
 * inject，访问任何字段时发出弃用警告，避免为了兼容而创建完整公共实例。
 */
export function createPropsDefaultThis(
  instance: ComponentInternalInstance,
  rawProps: Data,
  propKey: string,
): object {
  return new Proxy(
    {},
    {
      get(_, key: string) {
        __DEV__ &&
          warnDeprecation(DeprecationTypes.PROPS_DEFAULT_THIS, null, propKey)
        // `$options`：返回当前应用/mixin 合并后的组件选项。
        if (key === '$options') {
          return resolveMergedOptions(instance)
        }
        // 允许读取同一组件的其他原始 props。
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
