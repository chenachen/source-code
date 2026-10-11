/** 返回调用时的 this，用于核对转换后的具名导入调用不会错误绑定 namespace。 */
export function foo() {
  return this
}
