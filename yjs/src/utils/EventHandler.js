import * as f from 'lib0/function'

/**
 * 轻量事件处理器：只保存按注册顺序调用的监听器数组。
 *
 * @template ARG0, ARG1
 *
 * @private
 */
export class EventHandler {
  /** 创建空监听器列表；列表对象后续可能由移除操作整体替换。 */
  constructor () {
    /**
     * 当前调用列表。添加原地 push，单项移除改用新数组，全量移除原地置零；调用者不应把旧数组当作长期订阅句柄。
     * @type {Array<function(ARG0, ARG1):void>}
     */
    this.l = []
  }
}

/**
 * 创建无监听器的事件处理器。
 *
 * YType 为直接 observer 与 deep observer 分别持有处理器，事件参数由事务通知阶段提供。
 *
 * @template ARG0,ARG1
 * @returns {EventHandler<ARG0,ARG1>}
 *
 * @private
 * @function
 */
export const createEventHandler = () => new EventHandler()

/**
 * 把监听器追加到调用列表；同一函数可重复注册并会被重复调用。
 *
 * @template ARG0,ARG1
 * @param {EventHandler<ARG0,ARG1>} eventHandler
 * @param {function(ARG0,ARG1):void} f - 待注册监听器。
 *
 * @private
 * @function
 */
export const addEventHandlerListener = (eventHandler, f) =>
  eventHandler.l.push(f)

/**
 * 移除与给定函数严格相等的全部监听器；不存在时输出诊断错误。
 *
 * @template ARG0,ARG1
 * @param {EventHandler<ARG0,ARG1>} eventHandler
 * @param {function(ARG0,ARG1):void} f - 先前通过 `addEventHandlerListener` 注册的监听器。
 *
 * @private
 * @function
 */
export const removeEventHandlerListener = (eventHandler, f) => {
  const l = eventHandler.l
  const len = l.length
  eventHandler.l = l.filter(g => f !== g)
  if (len === eventHandler.l.length) {
    console.error('[yjs] Tried to remove event handler that doesn\'t exist.')
  }
}

/**
 * 原地清空全部监听器，保留数组身份。
 * @template ARG0,ARG1
 * @param {EventHandler<ARG0,ARG1>} eventHandler
 *
 * @private
 * @function
 */
export const removeAllEventHandlerListeners = eventHandler => {
  eventHandler.l.length = 0
}

/**
 * 按注册顺序调用全部监听器，并把两个参数原样传入。
 *
 * `lib0/function.callAll` 保证某个监听器抛错时仍会尝试其余监听器，最后再传播错误。
 * 调用同步执行；传入的是当前数组引用，移除操作若替换了处理器数组，不会回头改动已开始调用的旧数组。
 *
 * @template ARG0,ARG1
 * @param {EventHandler<ARG0,ARG1>} eventHandler
 * @param {ARG0} arg0
 * @param {ARG1} arg1
 *
 * @private
 * @function
 */
export const callEventHandlerListeners = (eventHandler, arg0, arg1) =>
  f.callAll(eventHandler.l, [arg0, arg1])
