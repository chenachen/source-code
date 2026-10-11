import { watchEffect } from 'vue'
import { useCounter } from './counter'

/** 同一个计数器实例的 ref 和更新函数，供 effect 与定时器共享。 */
const { count, increment, decrement } = useCounter()

watchEffect(() => {
  document.querySelector('#app')!.textContent = `${count.value}`
})

/** 每秒增加到 6，再减一次并 clearInterval；手工示例的状态变化有限。 */
const timer = setInterval(() => {
  if (count.value < 6) {
    increment()
  } else {
    decrement()
    clearInterval(timer)
  }
}, 1000)
