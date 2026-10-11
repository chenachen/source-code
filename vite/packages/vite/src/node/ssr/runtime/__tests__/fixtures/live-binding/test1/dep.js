/** 最初返回 0 的函数绑定，随后重复赋值；默认导出形式决定导入端是否跟随更新。 */
export default function f() {
  return 0
}

f = () => 1

f = () => 2

/** 将函数或 class 绑定再次替换为返回 3 的实现，供导入端再次读取。 */
export function update() {
  f = () => 3
}
