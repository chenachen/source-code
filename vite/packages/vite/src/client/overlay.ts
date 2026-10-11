import type { ErrorPayload } from '#types/hmrPayload'

/** 服务端注入的公开 base，用于定位 overlay 的 open-in-editor 请求。 */
declare const __BASE__: string
/** 配置文件显示名，例如 `vite.config.ts`，用于 overlay 的关闭提示。 */
declare const __HMR_CONFIG_NAME__: string

/** 避免直接引用未替换的编译期常量，并供模板闭包读取。 */
const hmrConfigName = __HMR_CONFIG_NAME__
/** open-in-editor 请求使用的已解析 base；空值回退根路径。 */
const base = __BASE__ || '/'

/**
 * 从 meta[property=csp-nonce] 继承 nonce，使 Shadow DOM 内联样式通过严格 CSP（#20791）。
 * Worker 等无 document 环境返回 undefined，避免仅导入 client 就抛错（#16318）。
 */
export const cspNonce =
  'document' in globalThis
    ? document.querySelector<HTMLMetaElement>('meta[property=csp-nonce]')?.nonce
    : undefined

/** 创建带属性与子节点的 DOM 元素，模板全程不用 innerHTML，避免错误文本注入标记。 */
function h(
  e: string,
  attrs: Record<string, string | undefined> = {},
  ...children: (string | Node)[]
) {
  const elem = document.createElement(e)
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) {
      elem.setAttribute(k, v)
    }
  }
  elem.append(...children)
  return elem
}

/** Shadow DOM 的完整浮层样式；:host 显式占满窗口以保证背景覆盖和可见性检测。 */
const templateStyle = /*css*/ `
:host {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99999;
  --monospace: 'SFMono-Regular', Consolas,
  'Liberation Mono', Menlo, Courier, monospace;
  --red: #ff5555;
  --yellow: #e2aa53;
  --purple: #cfa4ff;
  --cyan: #2dd9da;
  --dim: #c9c9c9;

  --window-background: #181818;
  --window-color: #d8d8d8;
}

.backdrop {
  position: fixed;
  z-index: 99999;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: scroll;
  margin: 0;
  background: rgba(0, 0, 0, 0.66);
}

.window {
  font-family: var(--monospace);
  line-height: 1.5;
  max-width: 80vw;
  color: var(--window-color);
  box-sizing: border-box;
  margin: 30px auto;
  padding: 2.5vh 4vw;
  position: relative;
  background: var(--window-background);
  border-radius: 6px 6px 8px 8px;
  box-shadow: 0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22);
  overflow: hidden;
  border-top: 8px solid var(--red);
  direction: ltr;
  text-align: left;
}

pre {
  font-family: var(--monospace);
  font-size: 16px;
  margin-top: 0;
  margin-bottom: 1em;
  overflow-x: scroll;
  scrollbar-width: none;
}

pre::-webkit-scrollbar {
  display: none;
}

pre.frame::-webkit-scrollbar {
  display: block;
  height: 5px;
}

pre.frame::-webkit-scrollbar-thumb {
  background: #999;
  border-radius: 5px;
}

pre.frame {
  scrollbar-width: thin;
}

.message {
  line-height: 1.3;
  font-weight: 400;
  white-space: pre-wrap;
}

.message-body {
  color: var(--red);
}

.plugin {
  color: var(--purple);
}

.file {
  color: var(--cyan);
  margin-bottom: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.frame {
  color: var(--yellow);
}

.stack {
  font-size: 13px;
  color: var(--dim);
}

.tip {
  font-size: 13px;
  color: #999;
  border-top: 1px dotted #999;
  padding-top: 13px;
  line-height: 1.8;
}

code {
  font-size: 13px;
  font-family: var(--monospace);
  color: var(--yellow);
}

.file-link {
  text-decoration: underline;
  cursor: pointer;
}

kbd {
  line-height: 1.5;
  font-family: ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  font-weight: 700;
  background-color: rgb(38, 40, 44);
  color: rgb(166, 167, 171);
  padding: 0.15rem 0.3rem;
  border-radius: 0.25rem;
  border-width: 0.0625rem 0.0625rem 0.1875rem;
  border-style: solid;
  border-color: rgb(54, 57, 64);
  border-image: initial;
}
`

/** 构建每个 ErrorOverlay 独享的 Shadow DOM；Shadow boundary 防止应用 CSS 污染浮层（#9971）。 */
const createTemplate = () =>
  h(
    'div',
    { class: 'backdrop', part: 'backdrop' },
    h(
      'div',
      { class: 'window', part: 'window' },
      h(
        'pre',
        { class: 'message', part: 'message' },
        h('span', { class: 'plugin', part: 'plugin' }),
        h('span', { class: 'message-body', part: 'message-body' }),
      ),
      h('pre', { class: 'file', part: 'file' }),
      h('pre', { class: 'frame', part: 'frame' }),
      h('pre', { class: 'stack', part: 'stack' }),
      h(
        'div',
        { class: 'tip', part: 'tip' },
        'Click outside, press ',
        h('kbd', {}, 'Esc'),
        ' key, or fix the code to dismiss.',
        h('br'),
        'You can also disable this overlay by setting ',
        h('code', { part: 'config-option-name' }, 'server.hmr.overlay'),
        ' to ',
        h('code', { part: 'config-option-value' }, 'false'),
        ' in ',
        h('code', { part: 'config-file-name' }, hmrConfigName),
        '.',
      ),
    ),
    h('style', { nonce: cspNonce }, templateStyle),
  )

/** 匹配 POSIX、Windows 与 file URL 堆栈位置，转成 open-in-editor 链接（#20040）。 */
const fileRE = /(?:file:\/\/)?(?:[a-zA-Z]:\\|\/).*?:\d+:\d+/g
/** 从错误 message 中识别并剥离 code frame，避免 message 与 frame 区域重复展示。 */
const codeframeRE = /^(?:>?\s*\d+\s+\|.*|\s+\|\s*\^.*)\r?\n/gm

// Worker/SSR 等环境可能没有 HTMLElement；空基类让类声明可求值；元素注册另由下方 customElements 是否存在决定。
const { HTMLElement = class {} as typeof globalThis.HTMLElement } = globalThis

/**
 * Vite 开发错误浮层：在隔离的 Shadow DOM 中展示插件、消息、位置、code frame 与堆栈，
 * 并支持点击文件打开编辑器、点击背景或按 Escape 关闭。
 */
export class ErrorOverlay extends HTMLElement {
  /** 浮层的 Shadow DOM 根，避免应用样式与选择器干扰。 */
  root: ShadowRoot
  /** 保存稳定 listener 引用，close 时可正确从 document 移除。 */
  closeOnEsc: (e: KeyboardEvent) => void

  /** 把 HMR ErrorPayload 渲染为浮层；`links=false` 可禁用本地文件跳转。 */
  constructor(err: ErrorPayload['err'], links = true) {
    super()
    this.root = this.attachShadow({ mode: 'open' })
    this.root.appendChild(createTemplate())

    // 全局正则会保留 lastIndex，每次新错误都必须归零，避免第二个浮层漏判 frame（#11132）。
    codeframeRE.lastIndex = 0
    const hasFrame = err.frame && codeframeRE.test(err.frame)
    const message = hasFrame
      ? err.message.replace(codeframeRE, '')
      : err.message
    if (err.plugin) {
      this.text('.plugin', `[plugin:${err.plugin}] `)
    }
    this.text('.message-body', message.trim())

    const [file] = (err.loc?.file || err.id || 'unknown file').split(`?`)
    if (err.loc) {
      this.text('.file', `${file}:${err.loc.line}:${err.loc.column}`, links)
    } else if (err.id) {
      this.text('.file', file)
    }

    if (hasFrame) {
      this.text('.frame', err.frame!.trim())
    }
    // 独立写入完整 stack，避免多次错误累积或丢失末尾帧（#16393、#20039）。
    this.text('.stack', err.stack, links)

    this.root.querySelector('.window')!.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    this.addEventListener('click', () => {
      this.close()
    })

    /** 以稳定引用监听 Escape，关闭后可从 document 注销同一个处理器。 */
    this.closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        this.close()
      }
    }

    document.addEventListener('keydown', this.closeOnEsc)
  }

  /**
   * 安全文本写入；启用 linkFiles 时只把可识别的文件位置拆成 `<a>`，其余仍是 TextNode。
   * 编辑器 URL 同时尊重 base 与当前 client URL，兼容自定义后端路径（#11337、#14879）。
   */
  text(selector: string, text: string, linkFiles = false): void {
    const el = this.root.querySelector(selector)!
    if (!linkFiles) {
      el.textContent = text
    } else {
      let curIndex = 0
      let match: RegExpExecArray | null
      fileRE.lastIndex = 0
      while ((match = fileRE.exec(text))) {
        const { 0: file, index } = match
        const frag = text.slice(curIndex, index)
        el.appendChild(document.createTextNode(frag))
        const link = document.createElement('a')
        link.textContent = file
        link.className = 'file-link'
        /** 把编码后的本地文件位置发给 open-in-editor 中间件，由服务端打开编辑器。 */
        link.onclick = () => {
          fetch(
            new URL(
              `${base}__open-in-editor?file=${encodeURIComponent(file)}`,
              import.meta.url,
            ),
          )
        }
        el.appendChild(link)
        curIndex += frag.length + file.length
      }
      if (curIndex < text.length) {
        el.appendChild(document.createTextNode(text.slice(curIndex)))
      }
    }
  }

  /** 从 DOM 移除浮层并注销全局键盘监听，防止后续错误累积 listener。 */
  close(): void {
    this.parentNode?.removeChild(this)
    document.removeEventListener('keydown', this.closeOnEsc)
  }
}

/** 自定义元素稳定标签名；client.ts 用它查找、替换与清除现有浮层。 */
export const overlayId = 'vite-error-overlay'
// 先从 globalThis 解构；旧浏览器/worker 没有 customElements 时跳过注册（#4856），重复载入
// client 时通过 get() 防止同名元素二次定义（#4475）。
const { customElements } = globalThis
if (customElements && !customElements.get(overlayId)) {
  customElements.define(overlayId, ErrorOverlay)
}
