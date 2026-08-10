import type { ErrorPayload, HotPayload } from '#types/hmrPayload'
import type { ViteHotContext } from '#types/hot'
import { HMRClient, HMRContext } from '../shared/hmr'
import {
  createWebSocketModuleRunnerTransport,
  normalizeModuleRunnerTransport,
} from '../shared/moduleRunnerTransport'
import { createHMRHandler } from '../shared/hmrHandler'
import { setupForwardConsoleHandler } from '../shared/forwardConsole'
import type { BundledDevHMRClient } from './bundledDevHmrClient'
import { ErrorOverlay, cspNonce, overlayId } from './overlay'
// @ts-expect-error 这是 Vite 内部虚拟模块，由服务端注入。
import '@vite/env'

// 下列常量由 HMR 插件在提供 client runtime 时注入。
declare const __BASE__: string
/** 服务端日志展示的 HTTP host，用于连接失败诊断。 */
declare const __SERVER_HOST__: string
/** 用户配置或按页面协议推断的 HMR WebSocket 协议。 */
declare const __HMR_PROTOCOL__: string | null
/** 用户覆盖的 HMR WebSocket 主机名。 */
declare const __HMR_HOSTNAME__: string | null
/** 用户覆盖的 HMR WebSocket 端口。 */
declare const __HMR_PORT__: number | null
/** 代理握手失败时直连 Vite server 的目标。 */
declare const __HMR_DIRECT_TARGET__: string
/** HMR WebSocket 路径前缀。 */
declare const __HMR_BASE__: string
/** WebSocket 保活与断线判断使用的毫秒间隔。 */
declare const __HMR_TIMEOUT__: number
/** 是否在浏览器中展示编译错误 overlay。 */
declare const __HMR_ENABLE_OVERLAY__: boolean
/** 防止任意网页连接本机 HMR 服务的会话 token。 */
declare const __WS_TOKEN__: string
/** 服务端解析后的浏览器 console 转发配置。 */
declare const __SERVER_FORWARD_CONSOLE__: any

console.debug('[vite] connecting...')

/** 当前 client runtime URL，用于推导未显式配置的连接地址。 */
const importMetaUrl = new URL(import.meta.url)

// 优先使用服务端显式配置，缺省值再从当前 client URL 推断。
const serverHost = __SERVER_HOST__
/** 最终 HMR WebSocket 协议。 */
const socketProtocol =
  __HMR_PROTOCOL__ || (importMetaUrl.protocol === 'https:' ? 'wss' : 'ws')
/** 显式 HMR 端口；为空时允许代理失败后的直连回退。 */
const hmrPort = __HMR_PORT__
/** 首次连接使用的代理可见 WebSocket host/path。 */
const socketHost = `${__HMR_HOSTNAME__ || importMetaUrl.hostname}:${
  hmrPort || importMetaUrl.port
}${__HMR_BASE__}`
/** 代理失败后的 Vite WebSocket 直连地址。 */
const directSocketHost = __HMR_DIRECT_TARGET__
/** 浏览器模块与资源 URL 的公开 base。 */
export const base = __BASE__ || '/'
/** WebSocket ping 间隔，单位毫秒。 */
const hmrTimeout = __HMR_TIMEOUT__
/** HMR WebSocket 鉴权 token。 */
const wsToken = __WS_TOKEN__
/** 浏览器 console 转发的解析后配置。 */
const forwardConsole = __SERVER_FORWARD_CONSOLE__

/** 浏览器与 HMR server 的标准 transport；首选代理后的地址，必要时回退直连 Vite server。 */
export const transport = normalizeModuleRunnerTransport(
  (() => {
    let wsTransport = createWebSocketModuleRunnerTransport({
      createConnection: () =>
        new WebSocket(
          `${socketProtocol}://${socketHost}?token=${wsToken}`,
          'vite-hmr',
        ),
      pingInterval: hmrTimeout,
    })

    return {
      /** 首连失败且未显式配置端口时，尝试绕过代理直连开发服务器。 */
      async connect(handlers) {
        try {
          await wsTransport.connect(handlers)
        } catch (e) {
          // 仅端口来自推断且从未连通时尝试直连，避免显式配置出错后静默连接到另一地址。
          if (!hmrPort) {
            wsTransport = createWebSocketModuleRunnerTransport({
              createConnection: () =>
                new WebSocket(
                  `${socketProtocol}://${directSocketHost}?token=${wsToken}`,
                  'vite-hmr',
                ),
              pingInterval: hmrTimeout,
            })
            try {
              await wsTransport.connect(handlers)
              console.info(
                '[vite] Direct websocket connection fallback. Check out https://vite.dev/config/server-options.html#server-hmr to remove the previous connection error.',
              )
            } catch (e) {
              if (
                e instanceof Error &&
                e.message.includes('WebSocket closed without opened.')
              ) {
                const currentScriptHostURL = new URL(import.meta.url)
                const currentScriptHost =
                  currentScriptHostURL.host +
                  currentScriptHostURL.pathname.replace(/@vite\/client$/, '')
                console.error(
                  '[vite] failed to connect to websocket.\n' +
                    'your current setup:\n' +
                    `  (browser) ${currentScriptHost} <--[HTTP]--> ${serverHost} (server)\n` +
                    `  (browser) ${socketHost} <--[WebSocket (failing)]--> ${directSocketHost} (server)\n` +
                    'Check out your Vite / network configuration and https://vite.dev/config/server-options.html#server-hmr .',
                )
              }
            }
            return
          }
          console.error(`[vite] failed to connect to websocket (${e}). `)
          throw e
        }
      },
      /** 关闭当前代理或直连 WebSocket。 */
      async disconnect() {
        await wsTransport.disconnect()
      },
      /** 通过当前有效 WebSocket 发送 HMR payload。 */
      send(data) {
        wsTransport.send(data)
      },
    }
  })(),
)

let willUnload = false
if (typeof window !== 'undefined') {
  // define 可能在 worker 中伪造 window；可选链避免访问不存在的 DOM API（#19307）。
  window.addEventListener?.('beforeunload', () => {
    willUnload = true
  })
}

/** 去掉 CSS direct 请求身份，只保留用于匹配 link 的 pathname/search。 */
function cleanUrl(pathname: string): string {
  const url = new URL(pathname, 'http://vite.dev')
  url.searchParams.delete('direct')
  return url.pathname + url.search
}

let isFirstUpdate = true
/** 正等待替代资源加载完成的旧 stylesheet link 集合。 */
const outdatedLinkTags = new WeakSet<HTMLLinkElement>()

/** 把同一批传播产生的多次整页刷新折叠成一次。 */
const debounceReload = (time: number) => {
  let timer: ReturnType<typeof setTimeout> | null
  return () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    timer = setTimeout(() => {
      location.reload()
    }, time)
  }
}
/** 在 20ms 内合并同一传播批次触发的整页刷新。 */
export const pageReload = debounceReload(20)

/** 普通按模块 HMR 的共享客户端状态机。 */
const hmrClient = new HMRClient(
  {
    error: (err) => console.error('[vite]', err),
    debug: (...msg) => console.debug('[vite]', ...msg),
  },
  transport,
  async function importUpdatedModule({
    acceptedPath,
    timestamp,
    explicitImportRequired,
    isWithinCircularImport,
  }) {
    const [acceptedPathWithoutQuery, query] = acceptedPath.split(`?`)
    const importPromise = import(
      /* @vite-ignore */
      base +
        acceptedPathWithoutQuery.slice(1) +
        `?${explicitImportRequired ? 'import&' : ''}t=${timestamp}${
          query ? `&${query}` : ''
        }`
    )
    if (isWithinCircularImport) {
      importPromise.catch(() => {
        console.info(
          `[hmr] ${acceptedPath} failed to apply HMR as it's within a circular import. Reloading page to reset the execution order. ` +
            `To debug and break the circular import, you can run \`vite --debug hmr\` to log the circular dependency path if a file change triggered it.`,
        )
        pageReload()
      })
    }
    return await importPromise
  },
)
// full-bundle-mode 入口（bundledDevClient.ts）会设置它。上方使用 import type，确保普通 client.mjs
// 不会把 bundled-dev 实现打进来。
let bundledDevClient: BundledDevHMRClient | undefined
/** 注册 full-bundle runtime，使后续协议消息改由其客户端图处理。 */
export function registerBundledDevClient(client: BundledDevHMRClient): void {
  bundledDevClient = client
}
transport.connect!(createHMRHandler(handleMessage))

setupForwardConsoleHandler(transport, forwardConsole)

/**
 * 首次更新前清理旧 overlay；若页面初载已失败，则改为整页重载以重建未执行的模块图。
 */
export function clearOverlayOrReloadOnFirstUpdate(): 'reload' | 'continue' {
  if (hasDocument) {
    if (isFirstUpdate && hasErrorOverlay()) {
      location.reload()
      return 'reload'
    }
    if (enableOverlay) {
      clearErrorOverlay()
    }
    isFirstUpdate = false
  }
  return 'continue'
}

/** 按协议顺序处理 server payload，并把模块执行委托给普通或 full-bundle HMR client。 */
async function handleMessage(payload: HotPayload) {
  const activeHmrClient = bundledDevClient ?? hmrClient
  switch (payload.type) {
    case 'connected':
      console.debug(`[vite] connected.`)
      break
    case 'bundled-dev-update':
      bundledDevClient!.handlePush(payload)
      break
    case 'update':
      await activeHmrClient.notifyListeners('vite:beforeUpdate', payload)
      if (clearOverlayOrReloadOnFirstUpdate() === 'reload') {
        return
      }
      await Promise.all(
        payload.updates.map(async (update): Promise<void> => {
          if (update.type === 'js-update') {
            return hmrClient.queueUpdate(update)
          }

          // css-update 只用于 `<link>` 直接引用的 CSS；JS import 的 CSS 走模块自接受。
          const { path, timestamp } = update
          const searchUrl = cleanUrl(path)
          // link 可能写相对 href，不能直接用 `[href*=]`；读取 el.href 的绝对 URL 后再匹配。
          const el = Array.from(
            document.querySelectorAll<HTMLLinkElement>('link'),
          ).find(
            (e) =>
              !outdatedLinkTags.has(e) && cleanUrl(e.href).includes(searchUrl),
          )

          if (!el) {
            return
          }

          const newPath = `${base}${searchUrl.slice(1)}${
            searchUrl.includes('?') ? '&' : '?'
          }t=${timestamp}`

          // 克隆新 link 并等 load/error 后才移除旧节点。若直接替换旧 href，旧样式会先失效，而新样式
          // 尚未加载，造成 FOUC。
          return new Promise((resolve) => {
            const newLinkTag = el.cloneNode() as HTMLLinkElement
            newLinkTag.href = new URL(newPath, el.href).href
            /** 新 link 无论成功或失败都结束替换，避免旧节点永久滞留。 */
            const removeOldEl = () => {
              el.remove()
              console.debug(`[vite] css hot updated: ${searchUrl}`)
              resolve()
            }
            newLinkTag.addEventListener('load', removeOldEl)
            newLinkTag.addEventListener('error', removeOldEl)
            outdatedLinkTags.add(el)
            el.after(newLinkTag)
          })
        }),
      )
      await activeHmrClient.notifyListeners('vite:afterUpdate', payload)
      break
    case 'custom': {
      await activeHmrClient.notifyListeners(payload.event, payload.data)
      if (payload.event === 'vite:ws:disconnect') {
        if (hasDocument && !willUnload) {
          console.log(`[vite] server connection lost. Polling for restart...`)
          const socket = payload.data.webSocket as WebSocket
          const url = new URL(socket.url)
          url.search = '' // ping 不复用含 token 的原 query；vite-ping 本身无需凭据。
          await waitForSuccessfulPing(url.href)
          location.reload()
        }
      }
      break
    }
    case 'full-reload':
      // `ifFallback` 只发给 bundling fallback 页面；该页面由 generateFallbackHtml 设置全局标记。
      if (
        payload.ifFallback &&
        !(globalThis as any).__vite_is_fallback_page__
      ) {
        break
      }
      await activeHmrClient.notifyListeners('vite:beforeFullReload', payload)
      if (hasDocument) {
        if (payload.path && payload.path.endsWith('.html')) {
          // HTML 变化只重载当前正在展示该 HTML 的页面，避免多页面应用互相干扰。
          const pagePath = decodeURI(location.pathname)
          const payloadPath = base + payload.path.slice(1)
          if (
            pagePath === payloadPath ||
            payload.path === '/index.html' ||
            (pagePath.endsWith('/') && pagePath + 'index.html' === payloadPath)
          ) {
            pageReload()
          }
          return
        } else {
          pageReload()
        }
      }
      break
    case 'prune':
      await activeHmrClient.notifyListeners('vite:beforePrune', payload)
      await activeHmrClient.prunePaths(payload.paths)
      break
    case 'error': {
      await activeHmrClient.notifyListeners('vite:error', payload)
      if (hasDocument) {
        const err = payload.err
        if (enableOverlay) {
          createErrorOverlay(err)
        } else {
          console.error(
            `[vite] Internal Server Error\n${err.message}\n${err.stack}`,
          )
        }
      }
      break
    }
    case 'ping': // 协议保活包，无需业务处理。
      break
    default: {
      const check: never = payload
      return check
    }
  }
}

/** 当前 client 是否允许创建错误 overlay。 */
const enableOverlay = __HMR_ENABLE_OVERLAY__
/** runtime 是否运行在具有 DOM 的窗口环境。 */
const hasDocument = 'document' in globalThis

/** 用最新服务端错误替换页面中已有的 overlay。 */
function createErrorOverlay(err: ErrorPayload['err']) {
  clearErrorOverlay()
  const { customElements } = globalThis
  if (customElements) {
    const ErrorOverlayConstructor = customElements.get(overlayId)!
    document.body.appendChild(new ErrorOverlayConstructor(err))
  }
}

/** 关闭页面中的全部 Vite 错误 overlay。 */
function clearErrorOverlay() {
  document.querySelectorAll<ErrorOverlay>(overlayId).forEach((n) => n.close())
}

/** 返回当前页面存在的 Vite 错误 overlay 数量。 */
function hasErrorOverlay() {
  return document.querySelectorAll(overlayId).length
}

/** 连接断开后轮询 vite-ping；可用 SharedWorker 合并同源多窗口的轮询。 */
function waitForSuccessfulPing(socketUrl: string) {
  if (typeof SharedWorker === 'undefined') {
    const visibilityManager: VisibilityManager = {
      currentState: document.visibilityState,
      listeners: new Set(),
    }
    /** 把 document 可见性变化广播给本窗口轮询器。 */
    const onVisibilityChange = () => {
      visibilityManager.currentState = document.visibilityState
      for (const listener of visibilityManager.listeners) {
        listener(visibilityManager.currentState)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return waitForSuccessfulPingInternal(socketUrl, visibilityManager)
  }

  // worker 代码必须内联：server 已关闭后仍可创建，并且不依赖后端集成是否能提供额外 worker 文件。
  const blob = new Blob(
    [
      '"use strict";',
      `const waitForSuccessfulPingInternal = ${waitForSuccessfulPingInternal.toString()};`,
      `const fn = ${pingWorkerContentMain.toString()};`,
      `fn(${JSON.stringify(socketUrl)})`,
    ],
    { type: 'application/javascript' },
  )
  const objURL = URL.createObjectURL(blob)
  const sharedWorker = new SharedWorker(objURL)
  return new Promise<void>((resolve, reject) => {
    /** 把当前窗口可见性同步给共享 worker。 */
    const onVisibilityChange = () => {
      sharedWorker.port.postMessage({ visibility: document.visibilityState })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    sharedWorker.port.addEventListener('message', (event) => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sharedWorker.port.close()

      const data:
        | {
            /** 共享轮询已经重新连接。 */
            type: 'success'
          }
        | {
            /** 共享轮询终止于错误。 */
            type: 'error'
            /** 无法继续轮询的原因。 */
            error: Error
          } = event.data
      if (data.type === 'error') {
        reject(data.error)
        return
      }
      resolve()
    })

    onVisibilityChange()
    sharedWorker.port.start()
  })
}

/** 页面与 SharedWorker 共用的可见性状态及等待者集合。 */
type VisibilityManager = {
  /** 最近一次 document visibilityState。 */
  currentState: DocumentVisibilityState
  /** 等待可见性变化的回调。 */
  listeners: Set<(newVisibility: DocumentVisibilityState) => void>
}

/** SharedWorker 主函数：共享重连探测，并由可见窗口状态控制轮询频率。 */
function pingWorkerContentMain(socketUrl: string) {
  self.addEventListener('connect', (_event) => {
    const event = _event as MessageEvent
    const port = event.ports[0]

    if (!socketUrl) {
      port.postMessage({
        type: 'error',
        error: new Error('socketUrl not found'),
      })
      return
    }

    const visibilityManager: VisibilityManager = {
      currentState: 'visible',
      listeners: new Set(),
    }
    port.addEventListener('message', (event) => {
      const { visibility } = event.data
      visibilityManager.currentState = visibility
      console.debug('[vite] new window visibility', visibility)
      for (const listener of visibilityManager.listeners) {
        listener(visibility)
      }
    })
    port.start()

    console.debug('[vite] connected from window')
    waitForSuccessfulPingInternal(socketUrl, visibilityManager).then(
      () => {
        console.debug('[vite] ping successful')
        try {
          port.postMessage({ type: 'success' })
        } catch (error) {
          port.postMessage({ type: 'error', error })
        }
      },
      (error) => {
        console.debug('[vite] error happened', error)
        try {
          port.postMessage({ type: 'error', error })
        } catch (error) {
          port.postMessage({ type: 'error', error })
        }
      },
    )
  })
}

/** 页面可见时按间隔探测；隐藏时暂停网络轮询，恢复可见后再继续。 */
async function waitForSuccessfulPingInternal(
  socketUrl: string,
  visibilityManager: VisibilityManager,
  ms = 1000,
) {
  /** 等待下一次重连尝试的固定间隔。 */
  function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** 建立一次 vite-ping WebSocket 并返回是否握手成功。 */
  async function ping() {
    try {
      const socket = new WebSocket(socketUrl, 'vite-ping')
      return new Promise<boolean>((resolve) => {
        /** 握手成功后完成探测并清理 socket。 */
        function onOpen() {
          resolve(true)
          close()
        }
        /** 握手失败后完成探测并清理 socket。 */
        function onError() {
          resolve(false)
          close()
        }
        /** 移除一次性监听器并关闭探测 socket。 */
        function close() {
          socket.removeEventListener('open', onOpen)
          socket.removeEventListener('error', onError)
          socket.close()
        }
        socket.addEventListener('open', onOpen)
        socket.addEventListener('error', onError)
      })
    } catch {
      return false
    }
  }

  /** 页面隐藏时暂停轮询，直到任一可见性监听器观察到 visible。 */
  function waitForWindowShow(visibilityManager: VisibilityManager) {
    return new Promise<void>((resolve) => {
      /** 首次恢复可见时解除等待并自行注销。 */
      const onChange = (newVisibility: DocumentVisibilityState) => {
        if (newVisibility === 'visible') {
          resolve()
          visibilityManager.listeners.delete(onChange)
        }
      }
      visibilityManager.listeners.add(onChange)
    })
  }

  if (await ping()) {
    return
  }
  await wait(ms)

  while (true) {
    if (visibilityManager.currentState === 'visible') {
      if (await ping()) {
        break
      }
      await wait(ms)
    } else {
      await waitForWindowShow(visibilityManager)
    }
  }
}

/** 开发态 CSS 模块 ID 到动态 style 节点的索引。 */
const sheetsMap = new Map<string, HTMLStyleElement>()
/** SSR 已注入 CSS 模块 ID 到 stylesheet link 的索引。 */
const linkSheetsMap = new Map<string, HTMLLinkElement>()

// 收集 SSR 阶段已经插入的 style/link，HMR 首次更新时复用它们，避免重复样式或 FOUC。
if ('document' in globalThis) {
  document
    .querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id]')
    .forEach((el) => {
      sheetsMap.set(el.getAttribute('data-vite-dev-id')!, el)
    })
  document
    .querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"][data-vite-dev-id]',
    )
    .forEach((el) => {
      linkSheetsMap.set(el.getAttribute('data-vite-dev-id')!, el)
    })
}

// 同一同步 import 批次的 CSS 应相邻插入；生产构建后它们通常会合并成单个 CSS 文件。
let lastInsertedStyle: HTMLStyleElement | undefined

/** 新建或更新由 JS CSS 模块管理的 `<style data-vite-dev-id>`。 */
export function updateStyle(id: string, content: string): void {
  if (linkSheetsMap.has(id)) return

  let style = sheetsMap.get(id)
  if (!style) {
    style = document.createElement('style')
    style.setAttribute('type', 'text/css')
    style.setAttribute('data-vite-dev-id', id)
    style.textContent = content
    if (cspNonce) {
      style.setAttribute('nonce', cspNonce)
    }

    if (!lastInsertedStyle) {
      document.head.appendChild(style)

      // 下一 macrotask 清空位置锚点；动态 import 的 CSS 在构建后属于另一个异步 chunk。
      setTimeout(() => {
        lastInsertedStyle = undefined
      }, 0)
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style)
    }
    lastInsertedStyle = style
  } else {
    style.textContent = content
  }
  sheetsMap.set(id, style)
}

/** 清除模块对应的 SSR link 或开发态 style；prune/dispose 时用于撤销样式副作用。 */
export function removeStyle(id: string): void {
  if (linkSheetsMap.has(id)) {
    // HMR 可能替换 link 节点，不能只保存旧引用，按 data 属性重新选择。
    document
      .querySelectorAll<HTMLLinkElement>(
        `link[rel="stylesheet"][data-vite-dev-id="${CSS.escape(id)}"]`,
      )
      .forEach((el) => el.remove())
    linkSheetsMap.delete(id)
  }
  const style = sheetsMap.get(id)
  if (style) {
    document.head.removeChild(style)
    sheetsMap.delete(id)
  }
}

/** 为当前模块创建新一代 import.meta.hot 上下文。 */
export function createHotContext(ownerPath: string): ViteHotContext {
  return new HMRContext(hmrClient, ownerPath)
}

/**
 * 给无法静态分析的 dynamic import URL 注入 Vite query；协议 URL/裸包不归 Vite 文件管线处理。
 */
export function injectQuery(url: string, queryToInject: string): string {
  // 跳过不会交给 Vite 文件服务处理的 URL。
  if (url[0] !== '.' && url[0] !== '/') {
    return url
  }

  // URL.pathname 会把 `../` 等相对语义归一化，必须从原字符串切 pathname。
  const pathname = url.replace(/[?#].*$/, '')
  const { search, hash } = new URL(url, 'http://vite.dev')

  return `${pathname}?${queryToInject}${search ? `&` + search.slice(1) : ''}${
    hash || ''
  }`
}

export { ErrorOverlay }
