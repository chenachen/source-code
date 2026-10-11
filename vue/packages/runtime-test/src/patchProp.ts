import { NodeOpTypes, type TestElement, logNodeOp } from './nodeOps'
import { isOn } from '@vue/shared'

/**
 * 记录 PATCH 后保存原始 prop；事件键另写入 eventListeners，供 triggerEvent 调用。
 * on: 保留冒号后的事件名，普通 onX 转小写；它是内存测试宿主，不执行 DOM 的 attribute/property 转换。
 */
export function patchProp(
  el: TestElement,
  key: string,
  prevValue: any,
  nextValue: any,
): void {
  logNodeOp({
    type: NodeOpTypes.PATCH,
    targetNode: el,
    propKey: key,
    propPrevValue: prevValue,
    propNextValue: nextValue,
  })
  el.props[key] = nextValue
  if (isOn(key)) {
    const event = key[2] === ':' ? key.slice(3) : key.slice(2).toLowerCase()
    ;(el.eventListeners || (el.eventListeners = {}))[event] = nextValue
  }
}
