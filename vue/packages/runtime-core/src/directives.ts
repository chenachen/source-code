/**
 * 自定义指令运行时。
 *
 * 编译器通过 `withDirectives()` 把指令绑定记录挂到 VNode，渲染器再在元素创建、挂载、
 * 更新、卸载各阶段调用 `invokeDirectiveHook()`。例如：

const comp = resolveComponent('comp')
const foo = resolveDirective('foo')
const bar = resolveDirective('bar')

return withDirectives(h(comp), [
  [foo, this.x],
  [bar, this.y]
])
 */

import type { VNode } from './vnode'
import { EMPTY_OBJ, isBuiltInDirective, isFunction } from '@vue/shared'
import { warn } from './warning'
import {
  type ComponentInternalInstance,
  type Data,
  getComponentPublicInstance,
} from './component'
import { currentRenderingInstance } from './componentRenderContext'
import { ErrorCodes, callWithAsyncErrorHandling } from './errorHandling'
import type { ComponentPublicInstance } from './componentPublicInstance'
import { mapCompatDirectiveHook } from './compat/customDirective'
import { pauseTracking, resetTracking, traverse } from '@vue/reactivity'

/** 传给指令钩子的当前绑定快照。 */
export interface DirectiveBinding<
  Value = any,
  Modifiers extends string = string,
  Arg = any,
> {
  /** 使用该指令的组件公开实例；无组件上下文时为 `null`。 */
  instance: ComponentPublicInstance | Record<string, any> | null
  /** 本次渲染计算出的绑定值。 */
  value: Value
  /** 更新前的绑定值；首次创建时为 `undefined`，类型保留 `null` 兼容公开声明。 */
  oldValue: Value | null
  /** 指令参数，如 `v-demo:foo` 中的 `foo`。 */
  arg?: Arg
  /** 指令修饰符集合，如 `v-demo.stop` 对应 `{ stop: true }`。 */
  modifiers: DirectiveModifiers<Modifiers>
  /** 实际指令定义，供内部选择当前阶段钩子。 */
  dir: ObjectDirective<any, Value, Modifiers, Arg>
}

/**
 * 客户端指令生命周期钩子的统一签名。
 * `Prev` 让创建阶段声明“没有旧 VNode”，更新阶段则能访问上一次绑定所在 VNode。
 */
export type DirectiveHook<
  HostElement = any,
  Prev = VNode<any, HostElement> | null,
  Value = any,
  Modifiers extends string = string,
  Arg = any,
> = (
  el: HostElement,
  binding: DirectiveBinding<Value, Modifiers, Arg>,
  vnode: VNode<any, HostElement>,
  prevVNode: Prev,
) => void

/** SSR 指令钩子签名；返回需要合并到服务端元素上的 props。 */
export type SSRDirectiveHook<
  Value = any,
  Modifiers extends string = string,
  Arg = any,
> = (
  binding: DirectiveBinding<Value, Modifiers, Arg>,
  vnode: VNode,
) => Data | undefined

/** 对象形式的自定义指令定义，钩子时机与元素 patch 生命周期对应。 */
export interface ObjectDirective<
  HostElement = any,
  Value = any,
  Modifiers extends string = string,
  Arg = any,
> {
  /**
   * 仅用于让 TypeScript 保留 `Modifiers` 泛型的内部占位字段。
   *
   * 缺少它时，`directives.test-d.ts` 中一处 `@ts-expect-error` 在 `tsc` 下会失效，
   * 但 IDE 与构建后的 d.ts 测试正常，属于 TypeScript 推导差异；运行时不会读取此字段。
   * @internal
   */
  __mod?: Modifiers
  /** 元素创建且 props/事件尚未应用前调用。 */
  created?: DirectiveHook<HostElement, null, Value, Modifiers, Arg>
  /** 元素即将插入宿主容器前调用。 */
  beforeMount?: DirectiveHook<HostElement, null, Value, Modifiers, Arg>
  /** 元素插入宿主容器后调用。 */
  mounted?: DirectiveHook<HostElement, null, Value, Modifiers, Arg>
  /** 元素更新前调用，可读取旧 VNode。 */
  beforeUpdate?: DirectiveHook<
    HostElement,
    VNode<any, HostElement>,
    Value,
    Modifiers,
    Arg
  >
  /** 元素及其子树更新完成后调用。 */
  updated?: DirectiveHook<
    HostElement,
    VNode<any, HostElement>,
    Value,
    Modifiers,
    Arg
  >
  /** 元素卸载前调用。 */
  beforeUnmount?: DirectiveHook<HostElement, null, Value, Modifiers, Arg>
  /** 逻辑卸载后的 post 阶段调用；若 leave 延迟物理删除，此钩子不等待动画完成。 */
  unmounted?: DirectiveHook<HostElement, null, Value, Modifiers, Arg>
  /** SSR 时生成额外元素 props；客户端生命周期钩子不会在服务端运行。 */
  getSSRProps?: SSRDirectiveHook<Value, Modifiers, Arg>
  /** 是否在绑定时深度遍历 value，使内部嵌套响应式变化也能触发组件更新。 */
  deep?: boolean
}

/**
 * 函数简写指令类型；同一函数会同时作为 `mounted` 与 `updated` 钩子。
 */
export type FunctionDirective<
  HostElement = any,
  V = any,
  Modifiers extends string = string,
  Arg = any,
> = DirectiveHook<HostElement, any, V, Modifiers, Arg>

/** 自定义指令既可使用完整对象，也可使用只关心挂载/更新的函数简写。 */
export type Directive<
  HostElement = any,
  Value = any,
  Modifiers extends string = string,
  Arg = any,
> =
  | ObjectDirective<HostElement, Value, Modifiers, Arg>
  | FunctionDirective<HostElement, Value, Modifiers, Arg>

/** 指令修饰符名到布尔值的映射。只出现模板中实际使用的修饰符。 */
export type DirectiveModifiers<K extends string = string> = Partial<
  Record<K, boolean>
>

/** 开发环境检查自定义指令名是否占用了 Vue 内置指令标识。 */
export function validateDirectiveName(name: string): void {
  if (isBuiltInDirective(name)) {
    warn('Do not use built-in directive ids as custom directive id: ' + name)
  }
}

/**
 * 编译器传给 `withDirectives()` 的紧凑元组列表：
 * `[指令, 绑定值?, 参数?, 修饰符?]`。尾部可选项允许生成代码省略无用占位。
 */
export type DirectiveArguments = Array<
  | [Directive | undefined]
  | [Directive | undefined, any]
  | [Directive | undefined, any, any]
  | [Directive | undefined, any, any, DirectiveModifiers]
>

/**
 * 把当前渲染中的指令绑定附加到 VNode。
 *
 * 函数简写会标准化为 mounted/updated 两个钩子；`deep` 指令会立即遍历绑定值，以便
 * 当前组件渲染 effect 收集所有嵌套依赖。这里只记录元数据，不执行生命周期钩子。
 */
export function withDirectives<T extends VNode>(
  vnode: T,
  directives: DirectiveArguments,
): T {
  if (currentRenderingInstance === null) {
    __DEV__ && warn(`withDirectives can only be used inside render functions.`)
    return vnode
  }
  const instance = getComponentPublicInstance(currentRenderingInstance)
  const bindings: DirectiveBinding[] = vnode.dirs || (vnode.dirs = [])
  for (let i = 0; i < directives.length; i++) {
    let [dir, value, arg, modifiers = EMPTY_OBJ] = directives[i]
    if (dir) {
      if (isFunction(dir)) {
        dir = {
          mounted: dir,
          updated: dir,
        } as ObjectDirective
      }
      if (dir.deep) {
        traverse(value)
      }
      bindings.push({
        dir,
        instance,
        value,
        oldValue: void 0,
        arg,
        modifiers,
      })
    }
  }
  return vnode
}

/**
 * 执行 VNode 上指定阶段的全部指令钩子。
 *
 * 更新时按相同索引从旧 VNode 复制 `oldValue`；编译器保证指令绑定顺序稳定。钩子执行
 * 期间暂停依赖追踪，防止指令读取状态时污染组件渲染依赖，并统一捕获异步错误。
 */
export function invokeDirectiveHook(
  vnode: VNode,
  prevVNode: VNode | null,
  instance: ComponentInternalInstance | null,
  name: keyof ObjectDirective,
): void {
  const bindings = vnode.dirs!
  const oldBindings = prevVNode && prevVNode.dirs!
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]
    if (oldBindings) {
      binding.oldValue = oldBindings[i].value
    }
    let hook = binding.dir[name] as DirectiveHook | DirectiveHook[] | undefined
    if (__COMPAT__ && !hook) {
      hook = mapCompatDirectiveHook(name, binding.dir, instance)
    }
    if (hook) {
      // 指令钩子可能运行在渲染 effect 内，暂停追踪以免把钩子读取误记为渲染依赖。
      pauseTracking()
      callWithAsyncErrorHandling(hook, instance, ErrorCodes.DIRECTIVE_HOOK, [
        vnode.el,
        binding,
        vnode,
        prevVNode,
      ])
      resetTracking()
    }
  }
}
