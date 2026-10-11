import { name } from '@vitejs/test-multi-entry-dep'

/** 返回 test-multi-entry-dep 的 name，作为尚未被 client 扫描发现的间接依赖。 */
export function sayName() {
  return name
}
