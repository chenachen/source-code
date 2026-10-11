/** 返回包含 LEGACY 标记的服务端 HTML，供 SSR 输出与浏览器 legacy 输出隔离测试检查。 */
export async function render() {
  return /* html */ `
    <div id="app">Hello</div>
    <div id="env">${import.meta.env.LEGACY}</div>
  `
}
