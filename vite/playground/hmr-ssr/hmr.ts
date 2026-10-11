import { virtual } from 'virtual:file'
import { foo as depFoo, nestedFoo } from './hmrDep'
import './hotData'
import './importing-updated'
import './invalidation-circular-deps'
import './invalidation/parent'
import './file-delete-restore'
import './optional-chaining/parent'
import './intermediate-file-delete'
import './circular'
import './queries'
import logo from './logo.svg'
import logoNoInline from './logo-no-inline.svg'
import { msg as softInvalidationMsg } from './soft-invalidation'

/** 入口初始导出数值一；两个自身接受回调消费新实例的导出，dispose 记录旧值。 */
export const foo = 1
text('.app', foo)
text('.dep', depFoo)
text('.nested', nestedFoo)
text('.virtual', virtual)
text('.soft-invalidation', softInvalidationMsg)
setImgSrc('#logo', logo)
setImgSrc('#logo-no-inline', logoNoInline)

/** 把触发虚拟计数事件的函数放入共享状态，runner 测试可直接调用。 */
globalThis.__HMR__['virtual:increment'] = () => {
  if (import.meta.hot) {
    import.meta.hot.send('virtual:increment')
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(({ foo }) => {
    log('(self-accepting 1) foo is now:', foo)
  })

  import.meta.hot.accept(({ foo }) => {
    log('(self-accepting 2) foo is now:', foo)
  })

  /** 打印单/多依赖接受回调收到的新值，并更新直接与嵌套依赖的输出。
   * @param type 回调种类的日志标签。
   * @param newFoo 新直接依赖值。
   * @param newNestedFoo 新嵌套依赖值。 */
  const handleDep = (type, newFoo, newNestedFoo) => {
    log(`(${type}) foo is now: ${newFoo}`)
    log(`(${type}) nested foo is now: ${newNestedFoo}`)
    text('.dep', newFoo)
    text('.nested', newNestedFoo)
  }

  import.meta.hot.accept('./logo.svg', (newUrl) => {
    setImgSrc('#logo', newUrl.default)
    log('Logo updated', newUrl.default)
  })

  import.meta.hot.accept('./logo-no-inline.svg', (newUrl) => {
    setImgSrc('#logo-no-inline', newUrl.default)
    log('Logo-no-inline updated', newUrl.default)
  })

  import.meta.hot.accept('./hmrDep', ({ foo, nestedFoo }) => {
    handleDep('single dep', foo, nestedFoo)
  })

  import.meta.hot.accept(['./hmrDep'], ([{ foo, nestedFoo }]) => {
    handleDep('multi deps', foo, nestedFoo)
  })

  import.meta.hot.dispose(() => {
    log(`foo was:`, foo)
  })

  import.meta.hot.on('vite:afterUpdate', (event) => {
    log(`>>> vite:afterUpdate -- ${event.type}`)
  })

  import.meta.hot.on('vite:beforeUpdate', (event) => {
    log(`>>> vite:beforeUpdate -- ${event.type}`)

    const cssUpdate = event.updates.find(
      (update) =>
        update.type === 'css-update' && update.path.includes('global.css'),
    )
    if (cssUpdate) {
      log('CSS updates are not supported in SSR')
    }
  })

  import.meta.hot.on('vite:error', (event) => {
    log(`>>> vite:error -- ${event.err.message}`)
  })

  import.meta.hot.on('vite:invalidate', ({ path }) => {
    log(`>>> vite:invalidate -- ${path}`)
  })

  import.meta.hot.on('custom:foo', ({ msg }) => {
    text('.custom', msg)
  })

  import.meta.hot.on('custom:remove', removeCb)

  // 发出自定义事件，让服务端计算 1 + 2 并返回结果。
  import.meta.hot.send('custom:remote-add', { a: 1, b: 2 })
  import.meta.hot.on('custom:remote-add-result', ({ result }) => {
    text('.custom-communication', result)
  })
}

/** 写入给定输出位置；浏览器版本查 DOM 设置 textContent，SSR 版本委托共享状态写入函数。
 * @param el 选择器或共享状态键。
 * @param text 待显示值。 */
function text(el, text) {
  hmr(el, text)
}

/** 更新图片来源；浏览器设置 img.src，SSR 只在共享槽位记录 URL。
 * @param el 图片选择器或槽位。
 * @param src 新资源 URL。 */
function setImgSrc(el, src) {
  hmr(el, src)
}

/** 把首次自定义移除事件的消息写到输出，再用同一函数身份 off 退订。
 * @param payload 事件消息对象。 */
function removeCb({ msg }) {
  text('.toRemove', msg)
  import.meta.hot.off('custom:remove', removeCb)
}

/** 把输入值转成字符串并写到共享状态，让 runner 测试在无 DOM 的环境读输出。
 * @param key 状态键。
 * @param value 待序列化值。 */
function hmr(key: string, value: unknown) {
  ;(globalThis.__HMR__ as any)[key] = String(value)
}
