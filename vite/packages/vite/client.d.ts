/// <reference path="./types/importMeta.d.ts" />

// Vite 提供的虚拟模块。
/** 只为副作用导入提供类型入口；执行时安装 modulepreload 兼容逻辑。 */
declare module 'vite/modulepreload-polyfill' {}

// CSS Modules 的默认导出是只读类名映射。
/** CSS Modules 原始类名到变换后类名的只读映射，不代表 CSS 文本内容。 */
type CSSModuleClasses = { readonly [key: string]: string }

/** *.module.css 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.css' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.scss 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.scss' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.sass 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.sass' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.less 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.less' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.styl 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.styl' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.stylus 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.stylus' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.pcss 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.pcss' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}
/** *.module.sss 的 CSS Modules 类型入口，默认导出类名映射。 */
declare module '*.module.sss' {
  /** 当前 CSS Modules 文件的类名映射，供模板或组件选择变换后的类名。 */
  const classes: CSSModuleClasses
  export default classes
}

// 普通 CSS 导入用于加载样式副作用。
/** *.css 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.css' {}
/** *.scss 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.scss' {}
/** *.sass 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.sass' {}
/** *.less 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.less' {}
/** *.styl 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.styl' {}
/** *.stylus 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.stylus' {}
/** *.pcss 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.pcss' {}
/** *.sss 的样式副作用导入声明，不提供默认字符串导出。 */
declare module '*.sss' {}

// 内建资源扩展名与 src/node/constants.ts 的资产识别表对应。

// 图片资源默认导出可用于 DOM 或 CSS 的 URL。
/** *.apng 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.apng' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.bmp 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.bmp' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.png 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.png' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.jpg 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.jpg' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.jpeg 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.jpeg' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.jfif 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.jfif' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.pjpeg 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.pjpeg' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.pjp 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.pjp' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.gif 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.gif' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.svg 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.svg' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.ico 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.ico' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.webp 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.webp' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.avif 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.avif' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.cur 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.cur' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.jxl 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.jxl' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

// 音视频和字幕资源默认导出 URL。
/** *.mp4 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.mp4' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.webm 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.webm' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.ogg 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.ogg' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.mp3 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.mp3' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.wav 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.wav' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.flac 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.flac' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.aac 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.aac' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.opus 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.opus' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.mov 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.mov' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.m4a 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.m4a' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.vtt 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.vtt' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

// 字体资源默认导出 URL。
/** *.woff 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.woff' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.woff2 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.woff2' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.eot 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.eot' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.ttf 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.ttf' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.otf 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.otf' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

// 其他内建静态资源默认导出 URL。
/** *.webmanifest 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.webmanifest' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.pdf 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.pdf' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}
/** *.txt 静态资源导入声明，默认导出资产插件生成的 URL。 */
declare module '*.txt' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

// ?init 请求导出异步实例化函数。
/** Wasm 初始化查询的类型入口，默认导出接受导入对象的异步实例化函数。 */
declare module '*.wasm?init' {
  /** 按需获取并实例化 Wasm，options 传给 WebAssembly 的导入对象。 */
  const initWasm: (
    options?: WebAssembly.Imports,
  ) => Promise<WebAssembly.Instance>
  export default initWasm
}

// 未带查询的 Wasm 声明不承诺具名导出形状。
/** 裸 Wasm 导入的占位类型入口；具体 ESM 集成的导出由工具链提供。 */
declare module '*.wasm' {}

// Worker 查询后缀决定默认导出为构造器或脚本 URL。
/** Worker 查询入口，默认导出构造器。 */
declare module '*?worker' {
  /** 由 worker 插件生成的 Worker 包装构造器；name 传给宿主构造选项。 */
  const workerConstructor: {
    /** 创建新的 Worker，脚本地址与模块类型由生成的包装器设置。 */
    new (options?: {
      /** 传给 Worker 或 SharedWorker 宿主构造器的实例名称。 */
      name?: string
    }): Worker
  }
  export default workerConstructor
}

/** Worker 查询入口，默认导出构造器。 */
declare module '*?worker&inline' {
  /** 由 worker 插件生成的 Worker 包装构造器；name 传给宿主构造选项。 */
  const workerConstructor: {
    /** 创建新的 Worker，脚本地址与模块类型由生成的包装器设置。 */
    new (options?: {
      /** 传给 Worker 或 SharedWorker 宿主构造器的实例名称。 */
      name?: string
    }): Worker
  }
  export default workerConstructor
}

/** Worker URL 查询入口，默认导出处理后的脚本地址。 */
declare module '*?worker&url' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

/** SharedWorker 查询入口，默认导出构造器。 */
declare module '*?sharedworker' {
  /** 由 worker 插件生成的 SharedWorker 包装构造器；name 传给宿主构造选项。 */
  const sharedWorkerConstructor: {
    /** 创建新的 SharedWorker，脚本地址与模块类型由生成的包装器设置。 */
    new (options?: {
      /** 传给 Worker 或 SharedWorker 宿主构造器的实例名称。 */
      name?: string
    }): SharedWorker
  }
  export default sharedWorkerConstructor
}

/** SharedWorker 查询入口，默认导出构造器。 */
declare module '*?sharedworker&inline' {
  /** 由 worker 插件生成的 SharedWorker 包装构造器；name 传给宿主构造选项。 */
  const sharedWorkerConstructor: {
    /** 创建新的 SharedWorker，脚本地址与模块类型由生成的包装器设置。 */
    new (options?: {
      /** 传给 Worker 或 SharedWorker 宿主构造器的实例名称。 */
      name?: string
    }): SharedWorker
  }
  export default sharedWorkerConstructor
}

/** SharedWorker URL 查询入口，默认导出处理后的脚本地址。 */
declare module '*?sharedworker&url' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

/** raw 查询入口，把读取到的文件文本作为默认字符串导出。 */
declare module '*?raw' {
  /** 文件的原始文本内容，不是资源地址。 */
  const src: string
  export default src
}

/** URL 查询入口，默认导出资源 URL，资产插件按内联规则决定其形式。 */
declare module '*?url' {
  /** 处理后的资源地址，可为内联 data URL 或公开文件 URL。 */
  const src: string
  export default src
}

/** inline 查询入口，默认导出插件生成的内联字符串；CSS 使用时不自动注入样式。 */
declare module '*?inline' {
  /** 内联处理后的字符串；具体内容由处理该文件的插件决定。 */
  const src: string
  export default src
}

/** 禁止资源内联的查询入口，默认导出独立资源文件的 URL。 */
declare module '*?no-inline' {
  /** 必须输出为独立文件的资源地址。 */
  const src: string
  export default src
}

/** 要求资源内联的 URL 查询入口，默认导出 data URL。 */
declare module '*?url&inline' {
  /** 内联到代码中的资源 data URL。 */
  const src: string
  export default src
}

/** 禁止资源内联的查询入口，默认导出独立资源文件的 URL。 */
declare module '*?url&no-inline' {
  /** 必须输出为独立文件的资源地址。 */
  const src: string
  export default src
}

/** 动态 chunk 预加载失败时派发的事件，监听方可 preventDefault 阻止继续抛错。 */
declare interface VitePreloadErrorEvent extends Event {
  /** 本次导入或预加载失败的原始错误。 */
  payload: Error
}

/** 为 window 的 addEventListener 补充 Vite 预加载失败事件类型。 */
declare interface WindowEventMap {
  /** chunk 预加载失败时触发，可读取 payload 以决定刷新或其他恢复动作。 */
  'vite:preloadError': VitePreloadErrorEvent
}
