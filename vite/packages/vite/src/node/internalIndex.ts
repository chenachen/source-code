/**
 * 仅供 Vite 仓库内部包消费的窄出口，不属于 `vite` 的稳定公共 API。
 * React refresh wrapper 暂时来自 Rolldown experimental 命名空间，集中转出可避免
 * 内部调用点直接绑定上游实验路径。
 */
export { viteReactRefreshWrapperPlugin as reactRefreshWrapperPlugin } from 'rolldown/experimental'
