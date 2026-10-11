let state = {}

/** 用新对象替换本模块 state 后应用输出，作为入口首轮渲染。
 * @param newState 包含父/子值的完整状态。 */
export const render = (newState) => {
  state = newState
  apply()
}

/** 浅合并更新到现有 state 再应用输出，作为接受回调的局部渲染。
 * @param updates 新模块提供的父/子字段。 */
export const rerender = (updates) => {
  state = { ...state, ...updates }
  apply()
}

/** 按 state 属性插入顺序以冒号拼接值；浏览器写 DOM，SSR 写共享状态槽位，供删除/恢复测试读取。 */
const apply = () => {
  globalThis.__HMR__['.file-delete-restore'] = Object.values(state).join(':')
}
