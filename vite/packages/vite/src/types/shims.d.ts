declare module 'connect' {
  const connect: () => any
  export = connect
}

declare module 'cors' {
  function cors(options: any): any
  export = cors
}

declare module 'postcss-import' {
  import type { Plugin } from 'postcss'
  const plugin: (options: {
    resolve: (
      id: string,
      basedir: string,
      importOptions: any,
      atRule: import('postcss').AtRule,
    ) => string | string[] | Promise<string | string[]>
    load: (id: string) => Promise<string>
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
