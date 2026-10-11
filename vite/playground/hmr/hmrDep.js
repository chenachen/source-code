/** 初始数值一；直接或嵌套依赖更新后由入口接受回调显示，普通依赖还在 dispose 保存旧值。 */
export const foo = 1
export { foo as nestedFoo } from './hmrNestedDep'

if (import.meta.hot) {
  const data = import.meta.hot.data
  if ('fromDispose' in data) {
    console.log(`(dep) foo from dispose: ${data.fromDispose}`)
  }

  import.meta.hot.dispose((data) => {
    console.log(`(dep) foo was: ${foo}`)
    data.fromDispose = foo
  })
}
