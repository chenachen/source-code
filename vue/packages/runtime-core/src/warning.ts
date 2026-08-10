import type { VNode } from './vnode'
import {
  type ComponentInternalInstance,
  type ConcreteComponent,
  type Data,
  formatComponentName,
} from './component'
import { isFunction, isString } from '@vue/shared'
import { isRef, pauseTracking, resetTracking, toRaw } from '@vue/reactivity'
import { ErrorCodes, callWithErrorHandling } from './errorHandling'

/** 警告栈中保证 `type` 为可格式化组件定义的 VNode。 */
type ComponentVNode = VNode & {
  type: ConcreteComponent
}

/**
 * 当前警告上下文栈。
 *
 * 渲染器进入 VNode 相关操作前压栈，离开后弹栈；警告发生时用栈顶定位来源组件。
 */
const stack: VNode[] = []

/** 格式化组件调用链所需的信息；连续递归实例会折叠并累计次数。 */
type TraceEntry = {
  vnode: ComponentVNode
  recurseCount: number
}

/** 从警告来源到根组件的标准化调用链。 */
type ComponentTraceStack = TraceEntry[]

/** 进入一个可能产生警告的 VNode 上下文。必须与 `popWarningContext()` 成对调用。 */
export function pushWarningContext(vnode: VNode): void {
  stack.push(vnode)
}

/** 离开最近压入的警告上下文。 */
export function popWarningContext(): void {
  stack.pop()
}

/** 防止自定义 warnHandler 或参数格式化再次触发 `warn()` 造成无限递归。 */
let isWarning = false

/**
 * 发出带组件调用链的 Vue 开发警告。
 *
 * 若应用配置了 `warnHandler`，则传入消息、公开实例、文本调用链和结构化调用链；
 * 否则输出到控制台。整个过程暂停响应式追踪，因为格式化 props 或自定义处理器可能
 * 读取/修改响应式值，若在 patch 期间被收集会造成递归更新。
 */
export function warn(msg: string, ...args: any[]): void {
  if (isWarning) return
  isWarning = true

  // 避免 props 格式化或 warnHandler 读取到 patch 正在修改的依赖，引发无限递归。
  pauseTracking()

  const instance = stack.length ? stack[stack.length - 1].component : null
  const appWarnHandler = instance && instance.appContext.config.warnHandler
  const trace = getComponentTrace()

  if (appWarnHandler) {
    callWithErrorHandling(
      appWarnHandler,
      instance,
      ErrorCodes.APP_WARN_HANDLER,
      [
        // eslint-disable-next-line no-restricted-syntax
        msg + args.map(a => a.toString?.() ?? JSON.stringify(a)).join(''),
        instance && instance.proxy,
        trace
          .map(
            ({ vnode }) => `at <${formatComponentName(instance, vnode.type)}>`,
          )
          .join('\n'),
        trace,
      ],
    )
  } else {
    const warnArgs = [`[Vue warn]: ${msg}`, ...args]
    if (
      trace.length &&
      // 测试环境省略组件栈，避免大量重复控制台输出干扰断言。
      !__TEST__
    ) {
      /* v8 ignore next 2 */
      warnArgs.push(`\n`, ...formatTrace(trace))
    }
    console.warn(...warnArgs)
  }

  resetTracking()
  isWarning = false
}

/**
 * 从当前警告 VNode 重建完整父组件调用链。
 *
 * 不能直接复制 `stack`：局部组件更新可能并非从根开始，栈中只有当前更新路径的一段。
 * 通过内部实例的 parent 指针向上回溯，才能得到稳定、完整的组件 trace。
 */
export function getComponentTrace(): ComponentTraceStack {
  let currentVNode: VNode | null = stack[stack.length - 1]
  if (!currentVNode) {
    return []
  }

  // 从 parent 指针重建，而非依赖可能不完整的临时渲染栈。
  const normalizedStack: ComponentTraceStack = []

  while (currentVNode) {
    const last = normalizedStack[0]
    if (last && last.vnode === currentVNode) {
      last.recurseCount++
    } else {
      normalizedStack.push({
        vnode: currentVNode as ComponentVNode,
        recurseCount: 0,
      })
    }
    const parentInstance: ComponentInternalInstance | null =
      currentVNode.component && currentVNode.component.parent
    currentVNode = parentInstance && parentInstance.vnode
  }

  return normalizedStack
}

/* v8 ignore start */
/** 把结构化调用链转换为可直接传给 `console.warn()` 的参数数组。 */
function formatTrace(trace: ComponentTraceStack): any[] {
  const logs: any[] = []
  trace.forEach((entry, i) => {
    logs.push(...(i === 0 ? [] : [`\n`]), ...formatTraceEntry(entry))
  })
  return logs
}

/** 格式化一层组件，并把连续递归折叠成次数后缀，避免调用链无限展开。 */
function formatTraceEntry({ vnode, recurseCount }: TraceEntry): any[] {
  const postfix =
    recurseCount > 0 ? `... (${recurseCount} recursive calls)` : ``
  const isRoot = vnode.component ? vnode.component.parent == null : false
  const open = ` at <${formatComponentName(
    vnode.component,
    vnode.type,
    isRoot,
  )}`
  const close = `>` + postfix
  return vnode.props
    ? [open, ...formatProps(vnode.props), close]
    : [open + close]
}

/** 最多展示前三个 props；限制长度避免大型对象淹没真正的警告信息。 */
function formatProps(props: Data): any[] {
  const res: any[] = []
  const keys = Object.keys(props)
  keys.slice(0, 3).forEach(key => {
    res.push(...formatProp(key, props[key]))
  })
  if (keys.length > 3) {
    res.push(` ...`)
  }
  return res
}

function formatProp(key: string, value: unknown): any[]
function formatProp(key: string, value: unknown, raw: true): any
/**
 * 将单个 prop 转成控制台友好的片段。
 *
 * 对 ref 解包并对对象调用 `toRaw()`，既提高可读性，也避免调试输出继续触发代理读取。
 */
function formatProp(key: string, value: unknown, raw?: boolean): any {
  if (isString(value)) {
    value = JSON.stringify(value)
    return raw ? value : [`${key}=${value}`]
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value == null
  ) {
    return raw ? value : [`${key}=${value}`]
  } else if (isRef(value)) {
    value = formatProp(key, toRaw(value.value), true)
    return raw ? value : [`${key}=Ref<`, value, `>`]
  } else if (isFunction(value)) {
    return [`${key}=fn${value.name ? `<${value.name}>` : ``}`]
  } else {
    value = toRaw(value)
    return raw ? value : [`${key}=`, value]
  }
}

/**
 * 开发环境断言过渡 duration 等值是有效数字。
 *
 * `undefined` 表示未配置，应被接受；`NaN` 单独提示表达式可能有误，比普通类型警告
 * 更能定位模板计算问题。
 *
 * @internal
 */
export function assertNumber(val: unknown, type: string): void {
  if (!__DEV__) return
  if (val === undefined) {
    return
  } else if (typeof val !== 'number') {
    warn(`${type} is not a valid number - ` + `got ${JSON.stringify(val)}.`)
  } else if (isNaN(val)) {
    warn(`${type} is NaN - ` + 'the duration expression might be incorrect.')
  }
}
/* v8 ignore stop */
