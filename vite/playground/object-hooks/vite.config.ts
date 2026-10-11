/* eslint-disable n/prefer-node-protocol */
import assert from 'assert'
import { defineConfig } from 'vite'

let count = 0
export default defineConfig({
  plugins: [
    {
      name: 'plugin1',
      buildStart: {
        /** 第一个 buildStart 等待后把计数加一；后续 sequential hook 必须等此 Promise 完成。 */
        async handler() {
          await new Promise((r) => setTimeout(r, 100))
          count += 1
        },
      },
      transform: {
        order: 'post',
        /** post transform 处理最后一个阶段占位符，验证 hook.order 比插件声明顺序优先。 */
        handler(code) {
          return code.replace('__TRANSFORM3__', 'ok')
        },
      },
    },
    {
      name: 'plugin2',
      buildStart: {
        sequential: true,
        /** sequential buildStart 先断言前一个完成，再等待并加计数；其完成前不启动后续 buildStart。 */
        async handler() {
          assert(count === 1)
          await new Promise((r) => setTimeout(r, 100))
          count += 1
        },
      },
      transform: {
        /** 普通 transform 将第一阶段占位符转到第二阶段，位于 pre 之后与 post 之前。 */
        handler(code) {
          return code.replace('__TRANSFORM1__', '__TRANSFORM2__')
        },
      },
    },
    {
      name: 'plugin3',
      buildStart: {
        /** sequential 屏障后启动的异步 buildStart，先断言计数为二，再延迟增加计数。 */
        async handler() {
          assert(count === 2)
          await new Promise((r) => setTimeout(r, 100))
          count += 1
        },
      },
      transform: {
        order: 'pre',
        /** pre transform 首先处理源码占位符，使普通 hook 获得第一阶段内容。 */
        handler(code) {
          return code.replace('__TRANSFORM__', '__TRANSFORM1__')
        },
      },
    },
    {
      name: 'plugin4',
      buildStart: {
        /** 与第三个 buildStart 并行启动，立即断言计数仍为二，验证屏障后的 hook 不互相串行等待。 */
        async handler() {
          assert(count === 2)
        },
      },
      transform: {
        /** 第二个普通 transform 将占位符推进到 post 阶段的输入。 */
        handler(code) {
          return code.replace('__TRANSFORM2__', '__TRANSFORM3__')
        },
      },
    },
  ],
})
