/** 返回包含当前 MODE 的服务端 HTML，供顺序 app builder 检查 SSR 环境配置。 */
export async function render() {
  return /* html */ `
    <div id="app">Hello</div>
    <div id="mode">${import.meta.env.MODE}</div>
  `
}
