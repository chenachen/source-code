import { isFunction } from '@vue/shared'
import { currentInstance, getCurrentInstance } from './component'
import { currentApp } from './apiCreateApp'
import { warn } from './warning'

/**
 * `InjectionKey` 的类型占位约束。
 *
 * 该接口在运行时不会生成任何代码；泛型 `T` 只用于把“键”和“值类型”绑定起来，
 * 使 `provide(key, value)` 与 `inject(key)` 能在 TypeScript 中共享同一份类型信息。
 */
interface InjectionConstraint<T> {}

/**
 * 具有值类型信息的依赖注入键。
 *
 * 建议库作者使用 `Symbol` 创建此键，既可避免字符串重名，也能让 TypeScript 从键中
 * 推导注入值的类型。
 */
export type InjectionKey<T> = symbol & InjectionConstraint<T>

/**
 * 在当前组件的后代组件中提供一个值。
 *
 * 每个组件最初直接复用父组件的 `provides`；只有第一次调用 `provide` 时才创建一个
 * 以父级 `provides` 为原型的新对象。这样既避免为所有组件都分配对象，又能让同名键
 * 自然覆盖父级值，而其他键继续沿原型链向上查找。
 *
 * 必须在 `setup()` 同步执行期间调用。组件挂载后再调用无法保证后代初始化顺序，
 * 因而开发环境会给出警告。
 */
export function provide<T, K = InjectionKey<T> | string | number>(
  key: K,
  value: K extends InjectionKey<infer V> ? V : T,
): void {
  if (__DEV__) {
    if (!currentInstance || currentInstance.isMounted) {
      warn(`provide() can only be used inside setup().`)
    }
  }
  if (currentInstance) {
    let provides = currentInstance.provides
    // 实例默认与父实例共用 `provides`。首次提供自己的值时才以父级对象为原型
    // 创建新对象。`inject` 因此只需查询离当前实例最近的 `provides`，剩余查找
    // 交给 JavaScript 原型链，并且子级覆盖不会污染父级。
    const parentProvides =
      currentInstance.parent && currentInstance.parent.provides
    if (parentProvides === provides) {
      provides = currentInstance.provides = Object.create(parentProvides)
    }
    // TypeScript 不允许直接以泛型 symbol 作为索引；运行时对象本身支持 symbol 键。
    provides[key as string] = value
  }
}

/**
 * 从当前组件的祖先链或应用级上下文中读取依赖。
 *
 * 查找顺序会根据调用场景调整：普通组件从父组件开始；根组件和自定义元素从自身
 * `appContext` 开始；`app.runWithContext()` 中则使用当前应用。未找到键时，可返回
 * 默认值；`treatDefaultAsFactory` 为 `true` 时函数默认值会延迟执行，并以组件公开
 * 代理作为 `this`，以兼容 Options API 的使用方式。
 */
export function inject<T>(key: InjectionKey<T> | string): T | undefined
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T,
  treatDefaultAsFactory?: false,
): T
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T | (() => T),
  treatDefaultAsFactory: true,
): T
export function inject(
  key: InjectionKey<any> | string,
  defaultValue?: unknown,
  treatDefaultAsFactory = false,
) {
  // `getCurrentInstance()` 也会回退到 `currentRenderingInstance`，因此没有普通组件
  // 实例代理的函数式组件也能在渲染期间调用 `inject()`。
  const instance = getCurrentInstance()

  // `app.runWithContext()` 没有组件实例，但会设置 `currentApp`，所以也允许读取
  // 通过 `app.provide()` 注册的应用级依赖。
  if (instance || currentApp) {
    // #2400：根组件没有父实例；为支持插件通过 `app.provide()` 注入，需回退到
    // `appContext.provides`。
    // #11488：嵌套调用 `createApp()` 时，优先读取 `runWithContext()` 设置的当前应用，
    // 否则可能误取外层组件所属应用的依赖。
    // #13212：自定义元素的 appContext 已继承父元素的 provides，必须从该上下文取值；
    // 若按普通组件只查 parent，会漏掉跨自定义元素边界传递的依赖。
    let provides = currentApp
      ? currentApp._context.provides
      : instance
        ? instance.parent == null || instance.ce
          ? instance.vnode.appContext && instance.vnode.appContext.provides
          : instance.parent.provides
        : undefined

    if (provides && (key as string | symbol) in provides) {
      // 类型断言只为绕过 TypeScript 的 symbol 索引限制，不会把 symbol 转成字符串。
      return provides[key as string]
    } else if (arguments.length > 1) {
      return treatDefaultAsFactory && isFunction(defaultValue)
        ? defaultValue.call(instance && instance.proxy)
        : defaultValue
    } else if (__DEV__) {
      warn(`injection "${String(key)}" not found.`)
    }
  } else if (__DEV__) {
    warn(`inject() can only be used inside setup() or functional components.`)
  }
}

/**
 * 当前是否存在合法的依赖注入上下文。
 *
 * 库可在内部调用 `inject()` 前用它探测环境，避免因用户在 `setup()` 外调用组合式 API
 * 而产生一条来自库内部的误导警告。例如 `vue-router` 的 `useRoute()` 可据此决定是否
 * 尝试注入路由实例。
 */
export function hasInjectionContext(): boolean {
  return !!(getCurrentInstance() || currentApp)
}
