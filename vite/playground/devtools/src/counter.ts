import { ref } from 'vue'

/** 创建独立的 Vue 响应式计数器，返回 ref 与修改函数供手工 DevTools 示例观察。 */
export function useCounter() {
  const count = ref(0)

  /** 增加当前实例的 ref 值，触发页面 watchEffect 更新。 */
  function increment() {
    count.value++
  }

  /** 减少当前实例的 ref 值，作为定时器结束前的最后一次变化。 */
  function decrement() {
    count.value--
  }

  return {
    count,
    increment,
    decrement,
  }
}
