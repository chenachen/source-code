
import { appInstanceMap } from '../create_app'
import { CompletionPath, getCurrentAppName } from '../libs/utils'

/** 创建 Worker 时可传入的浏览器原生选项子集。 */
interface WorkerOptions {
  /** Worker 的调试名称。 */
  name?: string;
  /** 脚本按 classic 或 ES module 方式执行。 */
  type?: 'classic' | 'module';
  /** 获取 Worker 脚本时使用的凭据模式。 */
  credentials?: 'omit' | 'same-origin' | 'include';
}

/** 无需跨域包装、可直接交给原生 Worker 的特殊协议。 */
const EXCLUDE_URL_PROTOCOLS = [
  'blob:'
]

/** 框架清理和消息交互所需的 Worker 实例最小接口。 */
interface WorkerInstance extends EventTarget {
  /** 向 Worker 线程发送消息及可转移对象。 */
  postMessage(message: any, transfer?: Transferable[]): void;
  /** 立即终止 Worker。 */
  terminate(): void;
}

/** 原生 Worker 构造器的最小可代理签名。 */
interface Worker {
  /** 使用脚本地址和可选配置创建 Worker 实例。 */
  new(url: string | URL, options?: WorkerOptions): WorkerInstance;
}

/** 初始化模块时捕获的原生 Worker 构造器。 */
const originalWorker = window.Worker

/** 按应用名保存已创建的 Worker，以便沙箱销毁时成组终止。 */
const workerInstanceMap = new Map<string, Set<WorkerInstance>>()

/** 终止并移除指定应用登记的全部 Worker 实例。 */
export function releaseWorkersByApp(appName: string): void {
  workerInstanceMap.get(appName)?.forEach(w => w.terminate())
  workerInstanceMap.delete(appName)
}

/**
 * 判断 Worker 地址能否由当前页面同源直接加载。
 *
 * @remarks
 * 实现把 `blob:` 协议直接视为可用；无法解析的地址返回 false，交给跨域包装路径处理。
 */
function isSameOrigin(url: string | URL): boolean {
  try {
    // 同源由协议、主机名和端口共同决定。
    const parsedUrl = url instanceof URL ? url : new URL(url as string)
    if (EXCLUDE_URL_PROTOCOLS.includes(parsedUrl.protocol)) {
      return true
    }
    return (
      parsedUrl.protocol === window.location.protocol &&
      parsedUrl.hostname === window.location.hostname &&
      parsedUrl.port === window.location.port
    )
  } catch (error) {
    return false
  }
}

/**
 * 把一段 Worker 引导脚本转换为可传给原生构造器的 Blob URL。
 *
 * @remarks
 * 标准 `Blob` 不可用时回退到旧浏览器的厂商 BlobBuilder 实现。
 */
function urlFromScript(script: string) {
  let blob
  try {
    blob = new Blob([script], {
      type: 'application/javascript'
    })
  } catch (e) {
    const BlobBuilder =
      // @ts-ignore
      window.BlobBuilder ||
      // @ts-ignore
      window.WebKitBlobBuilder ||
      // @ts-ignore
      window.MozBlobBuilder ||
      // @ts-ignore
      window.MSBlobBuilder
    const blobBuilder = new BlobBuilder()
    blobBuilder.append(script)
    blob = blobBuilder.getBlob('application/javascript')
  }

  const URL = window.URL || window.webkitURL
  return URL.createObjectURL(blob)
}

/**
 * 代理原生 Worker 构造器，补全子应用相对地址、桥接跨域脚本并登记实例。
 *
 * @remarks
 * 同源脚本直接创建；跨域脚本先生成同源 Blob 引导文件，module 使用 `import`，classic 使用 `importScripts`。
 */
const WorkerProxy =
  // @ts-ignore
  new Proxy<Worker>(originalWorker, {
  /** 拦截构造调用并返回行为等价的原生 Worker 实例。 */
  construct(Target, args): WorkerInstance {
    let [scriptURL, options] = args
    options = options || {}
    const appName = getCurrentAppName()
    let url = scriptURL
    if (appName) {
      const app = appInstanceMap.get(appName)
      url = CompletionPath(scriptURL, app!.url)
    }

    let instance: WorkerInstance
    if (url && !isSameOrigin(url)) {
      // 跨域地址由同源 Blob 引导脚本间接加载，绕过 Worker 构造器的同源地址限制。
      const workerScriptURL = JSON.stringify(String(url))

      // 保持调用方选择的 module/classic 加载语义。
      const script = options.type === 'module'
        ? `import ${workerScriptURL};`
        : `importScripts(${workerScriptURL});`
      const workerPath = urlFromScript(script)
      instance = new Target(workerPath, options) as WorkerInstance
    } else {
      // 同源地址直接交给原生构造器，避免额外 Blob 包装。
      instance = new Target(scriptURL, options) as WorkerInstance
    }

    // 只有能归属到当前子应用的实例才参与沙箱销毁清理。
    if (appName) {
      if (!workerInstanceMap.has(appName)) {
        workerInstanceMap.set(appName, new Set())
      }
      workerInstanceMap.get(appName)!.add(instance)
    }

    return instance
  },
  })

export default WorkerProxy
