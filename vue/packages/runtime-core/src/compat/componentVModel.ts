import { ShapeFlags, extend } from '@vue/shared'
import type { ComponentInternalInstance, ComponentOptions } from '../component'
import { createAppContext } from '../apiCreateApp'
import { ErrorCodes, callWithErrorHandling } from '../errorHandling'
import type { VNode } from '../vnode'
import { popWarningContext, pushWarningContext } from '../warning'
import {
  DeprecationTypes,
  isCompatEnabled,
  warnDeprecation,
} from './compatConfig'

/** 存放 Vue 2 model 事件监听器的内部 props 前缀，避免被普通 onXxx 解析提前消费。 */
export const compatModelEventPrefix = `onModelCompat:`

/** 已提示过 v-model 迁移警告的组件类型，确保每种组件只警告一次。 */
const warnedTypes = new WeakSet()

/**
 * 将编译器产生的 Vue 3 `modelValue`/`onUpdate:modelValue` 改写为组件声明的 Vue 2
 * `model.prop`/`model.event`。同时更新 dynamicProps，确保优化 patch 仍检查改名后的 prop。
 */
export function convertLegacyVModelProps(vnode: VNode): void {
  const { type, shapeFlag, props, dynamicProps } = vnode
  const comp = type as ComponentOptions
  if (shapeFlag & ShapeFlags.COMPONENT && props && 'modelValue' in props) {
    if (
      !isCompatEnabled(
        DeprecationTypes.COMPONENT_V_MODEL,
        // 此处要检查目标子组件自身的 compatConfig；当前渲染实例是使用 v-model 的父级，
        // 用父配置会让同一旧组件在不同调用方下转换结果不一致。
        { type } as any,
      )
    ) {
      return
    }

    if (__DEV__ && !warnedTypes.has(comp)) {
      pushWarningContext(vnode)
      warnDeprecation(
        DeprecationTypes.COMPONENT_V_MODEL,
        {
          type,
          appContext: (vnode.ctx && vnode.ctx.appContext) || createAppContext(),
        } as any,
        comp,
      )
      popWarningContext()
      warnedTypes.add(comp)
    }

    // Vue 3 编译结果 -> Vue 2 兼容 props：modelValue -> value（或 model.prop），
    // onUpdate:modelValue -> onModelCompat:input（或 model.event）。
    const model = comp.model || {}
    applyModelFromMixins(model, comp.mixins)
    const { prop = 'value', event = 'input' } = model
    if (prop !== 'modelValue') {
      props[prop] = props.modelValue
      delete props.modelValue
    }
    // 动态 props 快路径只 patch 列表中的键，必须同步改名，否则 model 更新会被跳过。
    if (dynamicProps) {
      dynamicProps[dynamicProps.indexOf('modelValue')] = prop
    }
    props[compatModelEventPrefix + event] = props['onUpdate:modelValue']
    delete props['onUpdate:modelValue']
  }
}

/** 递归应用 mixin 中的 model 选项，复现 Vue 2 选项合并后的最终 prop/event。 */
function applyModelFromMixins(model: any, mixins?: ComponentOptions[]) {
  if (mixins) {
    mixins.forEach(m => {
      if (m.model) extend(model, m.model)
      if (m.mixins) applyModelFromMixins(model, m.mixins)
    })
  }
}

/** 在组件 `$emit(event)` 时调用前面改写保存的 Vue 2 v-model 监听器。 */
export function compatModelEmit(
  instance: ComponentInternalInstance,
  event: string,
  args: any[],
): void {
  if (!isCompatEnabled(DeprecationTypes.COMPONENT_V_MODEL, instance)) {
    return
  }
  const props = instance.vnode.props
  const modelHandler = props && props[compatModelEventPrefix + event]
  if (modelHandler) {
    callWithErrorHandling(
      modelHandler,
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args,
    )
  }
}
