/** 公共入口：集中导出基座门面、命令式生命周期 API、预取能力和少量集成工具。 */
export {
  default,
  MicroApp,
  getActiveApps,
  getAllApps,
  unmountApp,
  unmountAllApps,
  reload,
  renderApp,
} from './micro_app'
export {
  default as preFetch,
} from './prefetch'
/** 提供 DOM 作用域清理、原生元素创建与构建时注入的版本号。 */
export {
  removeDomScope,
  pureCreateElement,
  version,
} from './libs/utils'
export {
  EventCenterForMicroApp,
} from './interact'
