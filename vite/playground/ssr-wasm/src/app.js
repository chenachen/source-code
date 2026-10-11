/** 根路径列出四个 Wasm 示例；其他已知路径动态导入对应 render，分别覆盖初始化器轻/重资源与直接 Wasm 导入，未知路径返回 undefined。 */
export async function render(url) {
  switch (url) {
    case '/':
      return `<ul>${[
        '/static-light',
        '/static-heavy',
        '/direct-add',
        '/direct-light',
      ]
        .map((name) => `<li><a href="${name}">${name}</a></li>`)
        .join('')}</ul>`
    case '/static-light':
      return (await import('./static-light')).render()
    case '/static-heavy':
      return (await import('./static-heavy')).render()
    case '/direct-add':
      return (await import('./direct-add')).render()
    case '/direct-light':
      return (await import('./direct-light')).render()
  }
}
