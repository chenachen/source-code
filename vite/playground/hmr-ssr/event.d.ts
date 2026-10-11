import 'vite/types/customEvent'

/** 扩展 Vite 自定义事件映射，使消息收发获得本 fixture 的负载类型。 */
declare module 'vite/types/customEvent' {
  /** 插件与客户端之间的消息协议；运行时事件名与本接口键对应。 */
  interface CustomEventMap {
    /** 插件推送从消息源提取的字符串。 */
    'custom:foo': {
      /** 本次源文件导出的消息。 */
      msg: string
    }
    /** 客户端发送两个加数，请服务器计算。 */
    'custom:remote-add': {
      /** 第一个加数。 */
      a: number;
      /** 第二个加数。 */
      b: number
    }
    /** 服务器回复计算结果；现有类型为 string，插件实际发送数值供页面字符串化。 */
    'custom:remote-add-result': {
      /** 加法结果的声明类型。 */
      result: string
    }
  }
}

/** 声明 runner fixture 在全局使用的日志入口，实际实现由测试 setup 安装。 */
declare global {
  let log: (...msg: unknown[]) => void
  let logger: {
    /** 接收错误值的全局日志接口声明。 */
    error: (msg: string | Error) => void
    /** 接收多个调试参数的全局日志接口声明。 */
    debug: (...msg: unknown[]) => void
  }
}
