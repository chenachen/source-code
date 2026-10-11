/**
 * 在框架模块加载前把 global.window 置为 undefined，使工具层初始化的 isBrowser 为 false。
 * ssr_env.test 的 import 顺序依赖此副作用；它模拟无浏览器入口，不创建服务端渲染 DOM。
 */
Object.defineProperty(global, 'window', {
  value: undefined,
})
