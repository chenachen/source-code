// injectedMsg 在原源码中未定义；配置里的插件仅向被请求的优化输出前置其 import。
/** 读取源码中未定义的 injectedMsg；仅开发请求的 transform 插件会为优化输出注入该 import。 */
export function getInjectedMsg() {
  return injectedMsg
}
