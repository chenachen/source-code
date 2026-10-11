/** HTMLLoader 普通入口分支使用的 URL；请求内容由 fetch stub 固定提供，与该服务器是否存在无关。 */
export const MOCK_APP_URL = 'http://localhost:6666/'

/** pathname 以 .js 结尾的入口输入，触发 HTMLLoader 合成脚本容器而绕过 fetch stub。 */
export const MOCK_APP_URL_UMD = 'https://storage.360buyimg.com/launch/zeromock/umd-module.js'

/** 保留的第二个 .js 地址常量；当前测试未引用，拼写不同形成另一个完整资源键。 */
export const MOCK_APP_URL_UMD_OTHER = 'https://storage.360buyimg.com/launch/zeromock/umd-module-cpoy.js'
