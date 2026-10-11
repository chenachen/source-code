/** 为已打包的 Connect 提供内部最小类型入口，公开精确类型另见 connect.d.ts。 */
declare module 'connect' {
  /** 创建内部 Connect 应用；这里用 any 避免依赖外部声明包。 */
  const connect: () => any
  export = connect
}

/** 为内部 CORS 中间件工厂提供最小声明。 */
declare module 'cors' {
  /** 使用透传配置创建 CORS 中间件，此 shim 不细化其配置或返回值。 */
  function cors(options: any): any
  export = cors
}

/** 声明 Vite 调用 postcss-import 时注入的解析、加载和 layer 命名能力。 */
declare module 'postcss-import' {
  import type { Plugin } from 'postcss'
  /** 创建使用 Vite 文件解析与加载策略的 PostCSS import 插件。 */
  const plugin: (options: {
    /** 相对 basedir 解析 CSS import，可异步返回一个或多个目标文件。 */
    resolve: (
      id: string,
      basedir: string,
      importOptions: any,
      atRule: import('postcss').AtRule,
    ) => string | string[] | Promise<string | string[]>
    /** 异步读取解析后文件的 CSS 文本。 */
    load: (id: string) => Promise<string>
    /** 为匿名 layer 生成稳定名称，参数包含序号与根样式文件。 */
    nameLayer: (index: number, rootFilename: string) => string
  }) => Plugin
  export = plugin
}

/**
 * `vite --profile` 在入口脚本中创建的 V8 Inspector 会话。
 * CLI 主模块通过该全局值停止采样、写出 `.cpuprofile`，或绑定性能分析快捷键。
 */
// eslint-disable-next-line no-var
declare var __vite_profile_session: import('node:inspector').Session | undefined
/**
 * `packages/vite/bin/vite.js` 刚开始执行时记录的高精度时间戳。
 * Dev Server 启动完成后用它计算包含 CLI 加载和配置解析在内的完整启动耗时。
 */
// eslint-disable-next-line no-var
declare var __vite_start_time: number | undefined
