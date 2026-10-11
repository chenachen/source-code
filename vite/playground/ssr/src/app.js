import { escapeHtml } from './utils'

/** 七个示例路由与渲染函数的映射；根页面据此生成链接，render 据清理后的路径选择处理函数。 */
const pathRenderers = {
  '/': renderRoot,
  '/circular-dep': renderCircularDep,
  '/circular-import': renderCircularImport,
  '/circular-import2': renderCircularImport2,
  '/forked-deadlock-static-imports': renderForkedDeadlockStaticImports,
  '/forked-deadlock-dynamic-imports': renderForkedDeadlockDynamicImports,
  '/import-meta': renderImportMeta,
}

/** 移除 URL 的 fragment 和 query 后查找路由；await 对应渲染函数并传入 rootDir，未知路径返回 404 文本。 */
export async function render(url, rootDir) {
  const pathname = url.replace(/#[^#]*$/, '').replace(/\?[^?]*$/, '')
  const renderer = pathRenderers[pathname]
  if (renderer) {
    return await renderer(rootDir)
  }
  return '404'
}

/** 枚举除根路径之外的示例路由，转义路径后生成链接列表，避免把路径直接作为 HTML 文本和属性内容。 */
async function renderRoot(rootDir) {
  const paths = Object.keys(pathRenderers).filter((key) => key !== '/')
  return `
    <ul>
      ${paths
        .map(
          (path) =>
            `<li><a href="${escapeHtml(path)}">${escapeHtml(path)}</a></li>`,
        )
        .join('\n')}
    </ul>
  `
}

/** 动态加载循环初始化模块并读取 valueAB，转义后输出；用于核对依赖循环中的初始化顺序和已导出绑定。 */
async function renderCircularDep(rootDir) {
  const { getValueAB } = await import('./circular-dep-init/circular-dep-init')
  return `<div class="circ-dep-init">${escapeHtml(getValueAB())}</div>`
}

/** 动态加载第一种循环转导出图，调用 logA 并转义输出，核对从 b 回到 a 的绑定可读。 */
async function renderCircularImport(rootDir) {
  const { logA } = await import('./circular-import/index.js')
  return `<div class="circ-import">${escapeHtml(logA())}</div>`
}

/** 动态加载第二种语句顺序的循环转导出图，调用 logA 并转义输出，检查导出与函数声明顺序变化。 */
async function renderCircularImport2(rootDir) {
  const { logA } = await import('./circular-import2/index.js')
  return `<div class="circ-import">${escapeHtml(logA())}</div>`
}

/** 导入静态交叉循环图的公共 H 模块，调用其导出并输出；该图同时含分叉依赖与回边，但 Y 只引用 A 函数而不递归调用。 */
async function renderForkedDeadlockStaticImports(rootDir) {
  const { commonModuleExport } = await import('./forked-deadlock/common-module')
  commonModuleExport()
  return `<div class="forked-deadlock-static-imports">rendered</div>`
}

/** 动态导入使用 Promise.all 分叉加载的 H 模块并等待其导出，验证两支共享循环依赖时加载可以完成。 */
async function renderForkedDeadlockDynamicImports(rootDir) {
  const { commonModuleExport } =
    await import('./forked-deadlock/dynamic-imports/common-module')
  await commonModuleExport()
  return `<div class="forked-deadlock-dynamic-imports">rendered</div>`
}

/** SSR 加载一个包含 import.meta 的模块，分别输出并转义 url、resolve 的路径和 main 标记，供页面测试核对服务端元信息。 */
async function renderImportMeta(rootDir) {
  const metaUrl = import.meta.url
  const resolveResult = import.meta.resolve('./app.js')
  const metaMain = import.meta.main
  return (
    `<div class="import-meta-url">${escapeHtml(metaUrl)}</div>` +
    `<div class="import-meta-resolve">${escapeHtml(resolveResult)}</div>` +
    `<div class="import-meta-main">${escapeHtml(String(metaMain))}</div>`
  )
}
