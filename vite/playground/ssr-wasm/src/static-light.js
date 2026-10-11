import light from './light.wasm?init'

/** 调用 ?init 初始化器并提供 imports 对象；await 实例后调用 exported_func，输出 JS 回调接收到的值，覆盖该尺寸 Wasm 资源的 SSR 初始化路径。 */
export async function render() {
  let result
  const { exported_func } = await light({
    imports: {
      /** 作为 Wasm imports.imported_func 接收参数并写入当前 render 的局部 result，供返回段落使用。 */
      imported_func: (res) => (result = res),
    },
  }).then((i) => i.exports)
  exported_func()
  return `<div class="static-light">${result}</div>`
}
