import { virtual } from 'virtual:file'
import { virtual as virtualDep } from 'virtual:file-dep'
import { foo as depFoo, nestedFoo } from './hmrDep'
import './hotData'
import './importing-updated'
import './invalidation-circular-deps'
import './file-delete-restore'
import './optional-chaining/parent'
import './intermediate-file-delete'
import './circular'
import './prune'
import logo from './logo.svg'
import logoNoInline from './logo-no-inline.svg'
import { msg as softInvalidationMsg } from './soft-invalidation'

/** 入口初始导出数值一；两个自身接受回调消费新实例的导出，dispose 记录旧值。 */
export const foo = 1
text('.app', foo)
text('.dep', depFoo)
text('.nested', nestedFoo)
text('.virtual', virtual)
text('.virtual-dep', virtualDep)
text('.soft-invalidation', softInvalidationMsg)
setImgSrc('#logo', logo)
setImgSrc('#logo-no-inline', logoNoInline)

text('.virtual-dep', 0)

/** 触发主虚拟模块计数事件的按钮节点。 */
const btn = document.querySelector('.virtual-update') as HTMLButtonElement
/** 存在 hot 时发送主虚拟模块的 increment 事件，插件递增计数并重新加载节点。 */
btn.onclick = () => {
  if (import.meta.hot) {
    import.meta.hot.send('virtual:increment')
  }
}

/** 触发带依赖后缀虚拟模块事件的按钮节点。 */
const btnDep = document.querySelector(
  '.virtual-update-dep',
) as HTMLButtonElement
/** 存在 hot 时发送带 -dep 负载的 increment 事件，让插件选择依赖虚拟节点。 */
btnDep.onclick = () => {
  if (import.meta.hot) {
    import.meta.hot.send('virtual:increment', '-dep')
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(({ foo }) => {
    console.log('(self-accepting 1) foo is now:', foo)
  })

  import.meta.hot.accept(({ foo }) => {
    console.log('(self-accepting 2) foo is now:', foo)
  })

  /** 打印单/多依赖接受回调收到的新值，并更新直接与嵌套依赖的输出。
   * @param type 回调种类的日志标签。
   * @param newFoo 新直接依赖值。
   * @param newNestedFoo 新嵌套依赖值。 */
  const handleDep = (type, newFoo, newNestedFoo) => {
    console.log(`(${type}) foo is now: ${newFoo}`)
    console.log(`(${type}) nested foo is now: ${newNestedFoo}`)
    text('.dep', newFoo)
    text('.nested', newNestedFoo)
  }

  import.meta.hot.accept('./logo.svg', (newUrl) => {
    setImgSrc('#logo', newUrl.default)
    console.log('Logo updated', newUrl.default)
  })

  import.meta.hot.accept('./logo-no-inline.svg', (newUrl) => {
    setImgSrc('#logo-no-inline', newUrl.default)
    console.log('Logo-no-inline updated', newUrl.default)
  })

  import.meta.hot.accept('./hmrDep', ({ foo, nestedFoo }) => {
    handleDep('single dep', foo, nestedFoo)
  })

  import.meta.hot.accept('virtual:file-dep', ({ virtual }) => {
    text('.virtual-dep', virtual)
  })

  import.meta.hot.accept(['./hmrDep'], ([{ foo, nestedFoo }]) => {
    handleDep('multi deps', foo, nestedFoo)
  })

  import.meta.hot.dispose(() => {
    console.log(`foo was:`, foo)
  })

  import.meta.hot.on('vite:afterUpdate', (event) => {
    console.log(`>>> vite:afterUpdate -- ${event.type}`)
  })

  import.meta.hot.on('vite:beforeUpdate', (event) => {
    console.log(`>>> vite:beforeUpdate -- ${event.type}`)

    const cssUpdate = event.updates.find(
      (update) =>
        update.type === 'css-update' && update.path.includes('global.css'),
    )
    if (cssUpdate) {
      text(
        '.css-prev',
        (document.querySelector('.global-css') as HTMLLinkElement).href,
      )

      // 等待旧标签被替换；该过程包含新样式表的下载和解析，
      // 随后读取新 link 的属性。
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node as Element).tagName === 'LINK'
            ) {
              text('.link-tag-added', 'yes')
            }
          })
          mutation.removedNodes.forEach((node) => {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node as Element).tagName === 'LINK'
            ) {
              text('.link-tag-removed', 'yes')
              text(
                '.css-post',
                (document.querySelector('.global-css') as HTMLLinkElement).href,
              )
            }
          })
        })
      })

      observer.observe(document.querySelector('#style-tags-wrapper'), {
        childList: true,
      })
    }
  })

  import.meta.hot.on('vite:error', (event) => {
    console.log(`>>> vite:error -- ${event.err.message}`)
  })

  import.meta.hot.on('vite:invalidate', ({ path }) => {
    console.log(`>>> vite:invalidate -- ${path}`)
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
  document.querySelector(el).textContent = text
}

/** 更新图片来源；浏览器设置 img.src，SSR 只在共享槽位记录 URL。
 * @param el 图片选择器或槽位。
 * @param src 新资源 URL。 */
function setImgSrc(el, src) {
  ;(document.querySelector(el) as HTMLImageElement).src = src
}

/** 把首次自定义移除事件的消息写到输出，再用同一函数身份 off 退订。
 * @param payload 事件消息对象。 */
function removeCb({ msg }) {
  text('.toRemove', msg)
  import.meta.hot.off('custom:remove', removeCb)
}
