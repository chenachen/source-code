/** 与 Node global 同名的具名导出，验证 SSR 导出绑定不会覆盖宿主全局对象。 */
export const global = 'ok'
