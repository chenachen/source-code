import { b } from './b'

/** 保留下一个节点导出的对象引用，组成环形导入关系；入口消费此对象以建立执行链。 */
export const a = {
  b,
}
