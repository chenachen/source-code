/** 声明 'virtual:file' 虚拟请求的模块类型，供静态类型检查识别插件生成的默认或命名字符串导出。 */
declare module 'virtual:file' {
  /** 该虚拟请求导出的字符串类型；运行时值由虚拟/query插件生成，无磁盘初始化器。 */
  export const virtual: string
}

/** 声明 'virtual:file-dep' 虚拟请求的模块类型，供静态类型检查识别插件生成的默认或命名字符串导出。 */
declare module 'virtual:file-dep' {
  /** 该虚拟请求导出的字符串类型；运行时值由虚拟/query插件生成，无磁盘初始化器。 */
  export const virtual: string
}
