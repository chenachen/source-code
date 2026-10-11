/** worker共用的基础响应消息，实例收到ping后回传。 */
export const msg = 'pong'
/** 取当前NODE_ENV，供worker与主页面检查环境替换结果。 */
export const mode = process.env.NODE_ENV
