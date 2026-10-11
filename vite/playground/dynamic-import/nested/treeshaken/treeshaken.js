/** 打印 foo 对应的 treeshaken 标记；消费者用解构、属性访问或 then 回调读取并执行此导出。 */
export const foo = () => {
  console.log('treeshaken foo')
}
/** 打印 bar 对应的 treeshaken 标记；消费者用解构、属性访问或 then 回调读取并执行此导出。 */
export const bar = () => {
  console.log('treeshaken bar')
}
/** 打印 baz1 对应的 treeshaken 标记；消费者用解构、属性访问或 then 回调读取并执行此导出。 */
export const baz1 = () => {
  console.log('treeshaken baz1')
}
/** 带 log 函数的导出对象，供动态 import 的属性链（含可选链）读取，检查已使用导出保留。 */
export const baz2 = {
  /** 打印对应 baz 对象的标记，供属性链读取后的调用验证导出保留。 */
  log: () => {
    console.log('treeshaken baz2')
  },
}
/** 带 log 函数的导出对象，供动态 import 的属性链（含可选链）读取，检查已使用导出保留。 */
export const baz3 = {
  /** 打印对应 baz 对象的标记，供属性链读取后的调用验证导出保留。 */
  log: () => {
    console.log('treeshaken baz3')
  },
}
/** 打印 baz4 对应的 treeshaken 标记；消费者用解构、属性访问或 then 回调读取并执行此导出。 */
export const baz4 = () => {
  console.log('treeshaken baz4')
}
/** 打印 baz5 对应的 treeshaken 标记；消费者用解构、属性访问或 then 回调读取并执行此导出。 */
export const baz5 = () => {
  console.log('treeshaken baz5')
}
/** 打印 baz6 对应的 treeshaken 标记；消费者用解构、属性访问或 then 回调读取并执行此导出。 */
export const baz6 = () => {
  console.log('treeshaken baz6')
}
/** 未被动态导入消费者使用的函数；构建用它的日志标记检查 tree shaking 删除。 */
export const removed = () => {
  console.log('treeshaken removed')
}
export default () => {
  console.log('treeshaken default')
}
