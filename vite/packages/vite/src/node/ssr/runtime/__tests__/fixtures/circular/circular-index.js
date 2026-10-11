export { a } from './circular-a'
export { b } from './circular-b'

// 此入口未声明 accept，循环模块更新会退化为整页重载。
import.meta.hot.on('vite:beforeFullReload', () => {
  console.log('full reload')
})
