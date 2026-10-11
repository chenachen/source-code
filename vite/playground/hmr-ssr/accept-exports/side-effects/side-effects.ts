/** 未被入口读取的命名导出；入口仅做副作用导入，接受 default 已覆盖空使用集合。 */
export const x = 'x'

/** 未被入口读取的命名导出；入口仅做副作用导入，接受 default 已覆盖空使用集合。 */
export const y = 'y'

export default 'z'

log('>>> side FX')

globalThis.__HMR__['.app'] = 'hey'

if (import.meta.hot) {
  import.meta.hot.acceptExports(['default'])
}
