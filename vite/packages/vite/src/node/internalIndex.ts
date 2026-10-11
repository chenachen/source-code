/**
 * `vite/internal` 的内部集成窄出口，不属于主 `vite` 入口的稳定公共 API。
 * React refresh wrapper 暂时来自 Rolldown experimental 命名空间，集中转出可避免
 * 内部调用点直接绑定上游实验路径。
 */
export { viteReactRefreshWrapperPlugin as reactRefreshWrapperPlugin } from 'rolldown/experimental'
