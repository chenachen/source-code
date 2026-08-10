import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const guidesDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(guidesDir, '..')
const workspaceRoot = path.resolve(projectRoot, '..')
const outputDir = path.join(workspaceRoot, 'share', 'vite')
const style = fs.readFileSync(path.join(guidesDir, 'share-site.css'), 'utf8')
const clientScript = fs.readFileSync(
  path.join(guidesDir, 'share-site.js'),
  'utf8',
)

const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm')
const markdownPackage = fs
  .readdirSync(pnpmDir)
  .find((name) => name.startsWith('markdown-it@14.3.0'))

if (!markdownPackage) {
  throw new Error('Cannot find the local markdown-it 14.3.0 dependency.')
}

const markdownModule = path.join(
  pnpmDir,
  markdownPackage,
  'node_modules',
  'markdown-it',
  'index.mjs',
)
const { default: MarkdownIt } = await import(pathToFileURL(markdownModule).href)

const version = 'v8.2.1'
const commit = '421615865dad3ed39137d17281814fc78a41246c'

const groups = [
  {
    name: '全景',
    description: '先建立对象、状态和完整请求坐标。',
    pages: [
      {
        code: '00',
        slug: '00-system-map-and-end-to-end',
        nav: '系统全景与请求链',
        lede: 'Vite Dev Server 是长期存活的增量模块系统；pending、ModuleGraph 与 PluginContainer 各自承担不同状态。',
        boundary:
          '主线限定普通开发态 JavaScript 请求；HTML、CSS、optimizer、SSR 与生产构建在后续页面展开。',
      },
    ],
  },
  {
    name: '启动与配置',
    description: '从命令行输入走到稳定的 ResolvedConfig。',
    pages: [
      {
        code: '01',
        slug: '01-cli-and-startup',
        nav: 'CLI 与启动',
        lede: 'CLI 负责尽早处理进程参数、把命令转成 InlineConfig，再把控制权交给 Node API。',
        boundary:
          '这里解释命令分派，不把 CLI 当成配置解析器或 HTTP Server 本体。',
      },
      {
        code: '02A',
        slug: '02a-env-loading',
        nav: '环境文件加载',
        lede: '四类 env 文件按顺序合并、展开，再由 process.env 覆盖；envPrefix 决定客户端暴露边界。',
        boundary:
          '只解释环境变量来源与暴露，不替代完整配置合并和 define 替换语义。',
      },
      {
        code: '02B',
        slug: '02b-config-resolution',
        nav: '配置加载与解析',
        lede: '配置解析是文件加载、合并、串行 config hook、Environment 派生与插件最终排序组成的多阶段过程。',
        boundary:
          '页面按阶段解释 resolveConfig；单个初始化片段不被扩大为全部六阶段的唯一证据。',
      },
      {
        code: '02C',
        slug: '02c-define-client-injection-and-json',
        nav: 'Define、注入与 JSON',
        lede: 'define 的语义在构建、SSR dev、client dev 中一致，但替换时机不同；JSON 又有独立模块语义。',
        boundary:
          'Define、client injection 与 JSON 是三条相邻但不同的执行路径，证据不能互相代替。',
      },
    ],
  },
  {
    name: '开发服务器核心',
    description: '插件、Environment、请求路由与模块身份。',
    pages: [
      {
        code: '03',
        slug: '03-plugin-system',
        nav: '插件体系',
        lede: '插件先按应用范围与 Environment 选择，再按插件层和 hook 层排序；开发态容器模拟 bundler context。',
        boundary:
          'Hook 排序只证明调度顺序；resolve、load、transform 的停止与串联规则分别核对。',
      },
      {
        code: '04',
        slug: '04-dev-server-lifecycle',
        nav: 'Dev Server 生命周期',
        lede: '构造、监听、关闭、重启是四个状态阶段；重启迁移公开对象，关闭等待全部资源。',
        boundary:
          'createServer 只完成装配，listen 才占端口；关闭与重启不能由构造片段推导。',
      },
      {
        code: '05',
        slug: '05-environment-api',
        nav: 'Environment API',
        lede: '每个 DevEnvironment 隔离配置视图、插件容器和模块图；依赖优化器与运行时 transport 只在相应类型和配置下存在。',
        boundary:
          'Build、Scan、Unknown 等 Environment 能力不同；类继承层级不等于运行时所有权层级。',
      },
      {
        code: '06',
        slug: '06-middleware-request-pipeline',
        nav: '中间件与请求入口',
        lede: 'Connect 注册顺序就是请求语义：校验、代理、public、transform、static、HTML 与 error。',
        boundary:
          'Host、CORS、server.fs 和 WebSocket token 是不同安全边界，不能压成一个开关。',
      },
      {
        code: '07',
        slug: '07-module-resolution',
        nav: '模块解析',
        lede: 'Resolve 是按 Environment 配置的多插件决策树；package 条件、缓存与 external 共同决定结果。',
        boundary:
          'URL、resolved ID、磁盘 file 是不同身份；basedir 片段只证明其中一个决策。',
      },
      {
        code: '08',
        slug: '08-transform-and-module-graph',
        nav: 'Transform 与模块图',
        lede: 'pending 合并当前并发，ModuleNode 保存长期结果；URL、ID、file 三种索引共同维持增量状态。',
        boundary:
          '短期 Promise 不是长期缓存；缓存是否可用还要结合失效时间和软硬失效。',
      },
    ],
  },
  {
    name: '转换与增量更新',
    description: 'HTML、import、依赖优化与 HMR 闭环。',
    pages: [
      {
        code: '09',
        slug: '09-html-transform',
        nav: 'HTML 转换',
        lede: 'HTML 同时是开发 HTTP 入口和构建图入口：内联代码经 proxy 入图，产物再由 chunk 图还原。',
        boundary:
          '开发态代理与构建态 generateBundle 是两段流程，不能共享一套时序结论。',
      },
      {
        code: '10',
        slug: '10-import-analysis',
        nav: 'Import Analysis',
        lede: 'Glob 和变量 import 先展开，主 Import Analysis 再改写 URL、注入 runtime、写依赖和 HMR 边。',
        boundary:
          '插件入口只证明启用条件；URL 规范化与 ModuleGraph 写入由后续决定性分支证明。',
      },
      {
        code: '11',
        slug: '11-dependency-pre-bundling',
        nav: '依赖预构建',
        lede: '预构建允许先启动、后台发现、候选构建、hash 比较和原子发布，是并发状态机而非一次扫描。',
        boundary:
          'Scanner 是预测；真实 crawl 会校验与补漏，候选结果也可能丢弃重跑。',
      },
      {
        code: '12',
        slug: '12-hmr',
        nav: 'HMR',
        lede: 'HMR 从 watcher 经插件与图传播生成 update 或 reload，再由客户端执行 dispose、import、accept。',
        boundary:
          'WebSocket 只是 transport；找到接受边界也不保证循环、死端或执行错误绝不 reload。',
      },
    ],
  },
  {
    name: '资源管线',
    description: '把非 JS 输入接入同一模块协议。',
    pages: [
      {
        code: '13A',
        slug: '13a-css-pipeline',
        nav: 'CSS 管线',
        lede: '三段 CSS 插件把预处理、用户变换、开发注入与构建抽取分层，并管理 worker 和构建轮次缓存。',
        boundary:
          '普通 CSS、CSS Modules、HTML proxy 有不同身份；不能概括为全部 CSS 都 self-accept。',
      },
      {
        code: '13B',
        slug: '13b-asset-worker-wasm',
        nav: 'Asset、Worker、Wasm',
        lede: 'Asset、Worker、Wasm 通过 URL、占位符、独立子构建和 runtime 胶水进入 JavaScript 图。',
        boundary:
          'Worker 不是复制文件；Asset 的 resolve 证据也不能替代 Worker 与 Wasm 的决定性分支。',
      },
    ],
  },
  {
    name: '生产构建',
    description: 'Builder 编排、最终图与输出协议。',
    pages: [
      {
        code: '14A',
        slug: '14a-build-orchestration',
        nav: '生产构建编排',
        lede: '传统 build 是单 Environment 兼容层；真正编排由 createBuilder、BuildEnvironment 与 Rolldown 完成。',
        boundary:
          '此版本主构建器是 Rolldown；不要把 esbuild 的转译和压缩阶段说成主图构建。',
      },
      {
        code: '14B',
        slug: '14b-build-output-and-preload',
        nav: 'Preload 与构建输出',
        lede: 'Preload 先留 marker，generateBundle 再读取最终图，runtime helper 最后装载；清单也在产物阶段生成。',
        boundary:
          'Transform 阶段尚不知道最终文件名，因此 asset 与 preload 必须使用占位协议。',
      },
    ],
  },
  {
    name: 'SSR 与运行时',
    description: '服务端协议、求值缓存与循环依赖。',
    pages: [
      {
        code: '15A',
        slug: '15a-ssr-transform-and-loading',
        nav: 'SSR 变换与加载',
        lede: 'SSR 把 ESM 变成 Runner 协议，并在 fetchModule 边界决定 external、cache 或返回转换代码。',
        boundary:
          'SSR transform 只改写协议，不执行模块；真正求值发生在 Module Runner。',
      },
      {
        code: '15B',
        slug: '15b-module-runner',
        nav: 'Module Runner',
        lede: 'Runner 是可移植求值客户端；模块身份、两层 Promise、循环 exports 与 HMR 各有独立状态。',
        boundary:
          'Fetch 去重与 evaluation 去重不能合并；循环依赖需要暴露部分 exports 避免 Promise 死锁。',
      },
    ],
  },
  {
    name: '公共边界',
    description: '稳定出口、诊断和兼容类型。',
    pages: [
      {
        code: '16',
        slug: '16-public-api-diagnostics-and-types',
        nav: '公共 API 与类型',
        lede: '公共 export 是兼容承诺边界；诊断、常量和内联上游类型服务维护，不是新的运行主链。',
        boundary:
          'src/node 中可导入的 helper 不自动等于稳定公共 API；DTS 测试锁定的是类型契约。',
      },
    ],
  },
]

const pages = groups.flatMap((group) =>
  group.pages.map((page) => ({ ...page, group: group.name })),
)

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function stripInlineMarkdown(value) {
  return value
    .replaceAll(/[*_~]/g, '')
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replaceAll(/<[^>]+>/g, '')
    .trim()
}

function plainTextFromInline(token) {
  if (!token?.children) return stripInlineMarkdown(token?.content ?? '')
  return token.children
    .map((child) => {
      if (child.type === 'softbreak' || child.type === 'hardbreak') return ' '
      if (
        child.type === 'text' ||
        child.type === 'code_inline' ||
        child.type === 'html_inline' ||
        child.type === 'image'
      ) {
        return child.content
      }
      return ''
    })
    .join('')
    .trim()
}

function slugify(value) {
  const normalized = stripInlineMarkdown(value)
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
  return normalized || 'section'
}

function uniqueSlug(env, value) {
  env.slugCounts ??= new Map()
  const base = slugify(value)
  const count = env.slugCounts.get(base) ?? 0
  env.slugCounts.set(base, count + 1)
  return count === 0 ? base : base + '-' + (count + 1)
}

function rewriteGuideHref(value) {
  const hashIndex = value.indexOf('#')
  const pathname = hashIndex >= 0 ? value.slice(0, hashIndex) : value
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : ''
  if (/^(?:https?:|mailto:|#)/.test(value)) return value
  if (/^(?:\.\/)?README\.md$/.test(pathname)) return 'index.html' + hash
  if (pathname.endsWith('.md')) {
    return pathname.replace(/^\.\//, '').replace(/\.md$/, '.html') + hash
  }
  return value
}

function renderFlowDiagram(source, pageCode) {
  const escapedSource = escapeHtml(source)
  let visual

  if (pageCode === '13B') {
    visual = [
      '<div class="flow-lanes resource-topology">',
      '<section class="flow-lane"><h4 class="lane-label">Asset</h4>',
      '<div class="lane-path"><span class="lane-step">JS / CSS / HTML 资源引用</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">fileToUrl</span>',
      '<span class="lane-arrow">→</span><span class="lane-choice">serve 还是 bundled？</span></div>',
      '<div class="lane-split"><span><b>serve</b> → fileToDevUrl → base / @fs / public URL</span>',
      '<span><b>bundled</b> → fileToBuiltUrl → asset / public placeholder ↘</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">Worker</h4>',
      '<div class="lane-path"><span class="lane-step">new Worker(new URL(...)) / ?worker</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">识别入口与 type</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">bundleWorkerEntry</span>',
      '<span class="lane-arrow">→</span><span class="lane-choice">worker placeholder ↘</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">Wasm</h4>',
      '<div class="lane-path"><span class="lane-step">.wasm?init / 直接 .wasm</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">wasm helper + ESM glue</span>',
      '<span class="lane-arrow">→</span><span class="lane-choice">fileToBuiltUrl ↘</span></div></section>',
      '<div class="merge-output"><b>构建分支共同汇入</b>',
      '<span>renderChunk → 最终文件名、base、相对路径或运行时表达式</span></div></div>',
    ].join('')
  } else {
    visual = [
      '<div class="flow-lanes request-topology">',
      '<section class="flow-lane"><h4 class="lane-label">启动</h4>',
      '<div class="lane-path"><span class="lane-step">CLI</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">createServer</span><span class="lane-arrow">→</span>',
      '<span class="lane-choice">配置可用于 serve？</span></div>',
      '<div class="lane-split"><span><b>否</b> → 抛错并清理</span>',
      '<span><b>是</b> → HTTP / WS / watcher / Environments → listen</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">请求</h4>',
      '<div class="lane-path"><span class="lane-step">浏览器模块请求</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">transformMiddleware</span>',
      '<span class="lane-arrow">→</span><span class="lane-choice">ETag 命中？</span></div>',
      '<div class="lane-split"><span><b>是</b> → 304 + end</span>',
      '<span><b>否</b> → environment.transformRequest</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">并发与缓存</h4>',
      '<div class="lane-path"><span class="lane-choice">pending 存在？</span>',
      '<span class="lane-arrow">→</span><span class="lane-choice">ModuleGraph 缓存有效？</span></div>',
      '<div class="lane-split"><span><b>pending 是</b> → 复用 Promise；<b>否</b> → 登记 Promise</span>',
      '<span><b>cache 是</b> → 返回结果；<b>否</b> → 进入插件链</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">核心转换</h4>',
      '<div class="lane-path"><span class="lane-step">resolveId</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">load</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">transform</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">写回 ModuleNode / meta / 依赖边</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">finally 删除 pending</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">send code + ETag + map</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">错误</h4>',
      '<div class="lane-path"><span class="lane-step">resolve / load / transform 失败</span>',
      '<span class="lane-arrow">→</span><span class="lane-choice">错误分类</span></div>',
      '<div class="lane-split three"><span>optimizer 处理中 / 过期 → 504</span>',
      '<span>访问拒绝 → 403</span><span>其他 → error middleware / 500</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">失效与 HMR</h4>',
      '<div class="lane-path"><span class="lane-choice">文件变化？</span><span class="lane-arrow">→</span>',
      '<span class="lane-step">失效节点并向 importer 传播</span><span class="lane-arrow">→</span>',
      '<span class="lane-choice">找到接受边界？</span></div>',
      '<div class="lane-split"><span><b>是</b> → update payload</span>',
      '<span><b>否</b> → full-reload；无变化则缓存等待</span></div></section>',
      '<section class="flow-lane"><h4 class="lane-label">关闭</h4>',
      '<div class="lane-path"><span class="lane-step">server.close()</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">allSettled：watcher / WS / Environments / HTTP / Runner</span>',
      '<span class="lane-arrow">→</span><span class="lane-step">清空 resolvedUrls 与兼容 Runner 引用</span></div></section>',
      '</div>',
    ].join('')
  }

  return [
    '<figure class="flow-figure" aria-label="离线流程图">',
    '<figcaption class="flow-caption"><strong>执行流程图</strong>',
    '<span>教程图依据目标版本源码与测试绘制；折叠区保留原始 Mermaid</span></figcaption>',
    visual,
    '<details class="diagram-source"><summary>查看原始 Mermaid 源码</summary>',
    '<pre><code>',
    escapedSource,
    '</code></pre></details></figure>',
  ].join('')
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options))

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const hrefIndex = token.attrIndex('href')
  if (hrefIndex >= 0) {
    const href = token.attrs[hrefIndex][1]
    token.attrs[hrefIndex][1] = rewriteGuideHref(href)
    if (/^https?:/.test(href)) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noreferrer noopener')
    }
  }
  return defaultLinkOpen(tokens, index, options, env, self)
}

md.renderer.rules.heading_open = (tokens, index, _options, env) => {
  const tag = tokens[index].tag
  const title = plainTextFromInline(tokens[index + 1]) || 'section'
  const id = uniqueSlug(env, title)
  const depth = Number(tag.slice(1))
  if (depth >= 2 && depth <= 3) {
    env.headings.push({ id, title, depth })
  }
  return (
    '<' +
    tag +
    ' id="' +
    escapeHtml(id) +
    '"><a class="heading-anchor" href="#' +
    encodeURIComponent(id) +
    '" aria-label="链接到本节">#</a>'
  )
}

md.renderer.rules.heading_close = (tokens, index) =>
  '</' + tokens[index].tag + '>\n'

md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n'
md.renderer.rules.table_close = () => '</table></div>\n'

md.renderer.rules.fence = (tokens, index, _options, env) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0] || 'text'
  if (language === 'mermaid')
    return renderFlowDiagram(token.content, env.pageCode)
  return [
    '<figure class="code-card">',
    '<figcaption><span>',
    escapeHtml(language),
    '</span><button class="copy-code" type="button">复制</button></figcaption>',
    '<pre><code class="language-',
    escapeHtml(language),
    '">',
    escapeHtml(token.content),
    '</code></pre></figure>',
  ].join('')
}

function renderMarkdown(source, pageCode) {
  const env = { pageCode, headings: [], slugCounts: new Map() }
  return { html: md.render(source, env), headings: env.headings }
}

function readPageSource(page) {
  const source = fs.readFileSync(
    path.join(guidesDir, page.slug + '.md'),
    'utf8',
  )
  const firstLine = source.split('\n', 1)[0]
  const title = firstLine.replace(/^#\s+/, '').trim()
  const body = source
    .replace(/^#\s+.*\n+/, '')
    .replace(/^>\s+\*\*证据基线\*\*：.*\n+/, '')
  return { source, title, body }
}

function estimateMinutes(source) {
  const cjk = (source.match(/[\p{Script=Han}]/gu) ?? []).length
  const words = (source.match(/[A-Za-z0-9_]+/g) ?? []).length
  return Math.max(4, Math.ceil(cjk / 420 + words / 190))
}

function renderNavigation(current) {
  const sections = groups
    .map((group) => {
      const links = group.pages
        .map((page) => {
          const active = current === page.code ? ' aria-current="page"' : ''
          return [
            '<li><a href="',
            page.slug,
            '.html"',
            active,
            '><span class="nav-code">',
            escapeHtml(page.code),
            '</span><span>',
            escapeHtml(page.nav),
            '</span></a></li>',
          ].join('')
        })
        .join('')
      return [
        '<section class="nav-group"><h2 class="nav-group-title">',
        escapeHtml(group.name),
        '</h2><ul class="nav-list">',
        links,
        '</ul></section>',
      ].join('')
    })
    .join('')

  return [
    '<nav class="site-nav" aria-label="模块导航">',
    '<a class="nav-home" href="index.html"',
    current === 'index' ? ' aria-current="page"' : '',
    '><span>⌂</span><span>阅读总览</span></a>',
    sections,
    '</nav>',
  ].join('')
}

function renderToc(headings) {
  if (headings.length === 0) return ''
  const items = headings
    .map((heading) => {
      return [
        '<li class="depth-',
        heading.depth,
        '"><a href="#',
        encodeURIComponent(heading.id),
        '">',
        escapeHtml(heading.title),
        '</a></li>',
      ].join('')
    })
    .join('')
  return [
    '<aside class="page-toc" aria-label="页内目录">',
    '<h2 class="toc-title">本页目录</h2><ol class="toc-list">',
    items,
    '</ol></aside>',
  ].join('')
}

function renderHero({ code, group, title, lede, minutes, source }) {
  return [
    '<header class="article-hero">',
    '<div class="eyebrow"><span class="pill">',
    escapeHtml(code),
    '</span><span>',
    escapeHtml(group),
    '</span></div>',
    '<h1>',
    escapeHtml(title),
    '</h1><p class="lede">',
    escapeHtml(lede),
    '</p><div class="hero-meta">',
    '<span>证据基线：',
    version,
    '</span><span>commit <code>',
    commit.slice(0, 12),
    '</code></span><span>约 ',
    minutes,
    ' 分钟</span><a href="../../vite/reading-guides/',
    escapeHtml(source),
    '">查看 Markdown 原稿</a></div></header>',
  ].join('')
}

function renderPager(pageIndex) {
  const previous = pages[pageIndex - 1]
  const next = pages[pageIndex + 1]
  const previousHtml = previous
    ? [
        '<a class="pager-link previous" href="',
        previous.slug,
        '.html"><span class="pager-label">上一篇 · ',
        previous.code,
        '</span><span class="pager-title">',
        escapeHtml(previous.nav),
        '</span></a>',
      ].join('')
    : '<a class="pager-link previous" href="index.html"><span class="pager-label">返回</span><span class="pager-title">阅读总览</span></a>'
  const nextHtml = next
    ? [
        '<a class="pager-link next" href="',
        next.slug,
        '.html"><span class="pager-label">下一篇 · ',
        next.code,
        '</span><span class="pager-title">',
        escapeHtml(next.nav),
        '</span></a>',
      ].join('')
    : '<a class="pager-link next" href="index.html"><span class="pager-label">完成</span><span class="pager-title">返回阅读总览</span></a>'
  return (
    '<nav class="article-pager" aria-label="前后篇">' +
    previousHtml +
    nextHtml +
    '</nav>'
  )
}

function renderShell({
  documentTitle,
  description,
  current,
  pathLabel,
  content,
  headings,
}) {
  const initialTheme = [
    '(function(){try{var t=localStorage.getItem("vite-guide-theme");',
    'if(t)document.documentElement.setAttribute("data-theme",t)}catch(_){}})();',
  ].join('')
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="theme-color" content="#646cff">',
    '<meta name="description" content="',
    escapeHtml(description),
    '"><title>',
    escapeHtml(documentTitle),
    '</title><style>',
    style,
    '</style><script>',
    initialTheme,
    '</script></head><body>',
    '<a class="skip-link" href="#article-start">跳到正文</a>',
    '<div class="reading-progress" aria-hidden="true"><span data-reading-progress></span></div>',
    '<header class="topbar"><div class="topbar-inner">',
    '<button class="icon-button nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-label="打开模块导航">☰</button>',
    '<a class="brand" href="index.html"><span class="brand-mark">V</span><span class="brand-text">Vite 源码解剖</span></a>',
    '<span class="topbar-path">',
    escapeHtml(pathLabel),
    '</span><div class="topbar-actions">',
    '<button class="icon-button" type="button" data-theme-toggle aria-label="切换主题">◐</button>',
    '</div></div></header>',
    '<div class="page-grid">',
    renderNavigation(current),
    '<main class="article" id="article-start">',
    content,
    '</main>',
    renderToc(headings),
    '</div><script>',
    clientScript,
    '</script></body></html>\n',
  ].join('')
}

function renderPage(page, pageIndex) {
  const { source, title, body } = readPageSource(page)
  const rendered = renderMarkdown(body, page.code)
  const hero = renderHero({
    code: page.code,
    group: page.group,
    title,
    lede: page.lede,
    minutes: estimateMinutes(source),
    source: page.slug + '.md',
  })
  const notes = [
    '<section class="focus-card" aria-label="阅读重点与边界">',
    '<div><h2>本页重点</h2><p>',
    escapeHtml(page.lede),
    '</p></div><div class="boundary"><h3>推导边界</h3><p>',
    escapeHtml(page.boundary),
    '</p></div></section>',
    '<aside class="evidence-note"><h3>证据口径</h3>',
    '<p>正文保留目标版本中的真实源码、状态说明与代表性测试映射。测试源码用于锁定设计契约；本轮没有执行测试命令。</p></aside>',
  ].join('')
  const content = [
    hero,
    notes,
    '<article class="prose">',
    rendered.html,
    '</article>',
    renderPager(pageIndex),
    '<footer class="site-footer">Vite ',
    version,
    ' 源码阅读站 · 所有机制结论限定于 commit ',
    commit,
    '。</footer>',
  ].join('')
  return renderShell({
    documentTitle: title + ' · Vite 源码解剖',
    description: page.lede,
    current: page.code,
    pathLabel: page.group + ' / ' + page.code + ' ' + page.nav,
    content,
    headings: rendered.headings,
  })
}

function renderIndex() {
  const indexHeadings = [
    { id: '核心结论', title: '核心结论', depth: 2 },
    { id: '对象所有权', title: '对象所有权', depth: 2 },
    { id: '推荐路线', title: '推荐路线', depth: 2 },
    ...groups.map((group) => ({
      id: '模块-' + slugify(group.name),
      title: group.name,
      depth: 2,
    })),
    { id: '证据边界', title: '证据边界', depth: 2 },
  ]

  const thesis = [
    '<section id="核心结论"><div class="module-group-heading"><h2>核心结论</h2><p>先记机制，不背文件名</p></div>',
    '<div class="index-thesis">',
    '<article class="thesis-card"><span class="thesis-number">01</span><h2>按需，而非先打包全站</h2><p>普通开发主线在浏览器请求模块时才 resolve、load、transform。</p></article>',
    '<article class="thesis-card"><span class="thesis-number">02</span><h2>快来自增量状态协作</h2><p>pending 合并并发，ModuleGraph 保存结果与依赖，optimizer 处理依赖形态。</p></article>',
    '<article class="thesis-card"><span class="thesis-number">03</span><h2>HMR 是图算法</h2><p>WebSocket 只传输；接受边界、失效和 importer 传播决定 update 或 reload。</p></article>',
    '</div></section>',
  ].join('')

  const ownership = [
    '<section id="对象所有权"><div class="module-group-heading"><h2>对象所有权</h2><p>每个状态属于谁</p></div>',
    '<div class="ownership-flow" aria-label="Vite 核心对象所有权">',
    '<span>InlineConfig</span><b>→</b><span>ResolvedConfig</span><b>→</b>',
    '<span>ViteDevServer</span><b>→</b><span>DevEnvironment × N</span><b>→</b>',
    '<span>PluginContainer + ModuleGraph</span><b>→</b><span>ModuleNode</span>',
    '</div></section>',
  ].join('')

  const tracks = [
    '<section id="推荐路线"><div class="module-group-heading"><h2>推荐路线</h2><p>按目标跳读，不必平均用力</p></div>',
    '<div class="track-grid">',
    '<a class="track-card" href="00-system-map-and-end-to-end.html"><span class="nav-code">主线</span><h3>开发请求如何跑完</h3><p>从 CLI、配置、Server 到 transform、ModuleGraph、HMR 与 close。</p><span class="track-path">00 → 01 → 02B → 03 → 04 → 06 → 08 → 10 → 12</span></a>',
    '<a class="track-card" href="13a-css-pipeline.html"><span class="nav-code">资源</span><h3>CSS 与非 JS 模块</h3><p>理解请求身份、开发注入、构建占位和独立 Worker 子构建。</p><span class="track-path">09 → 13A → 13B → 14B</span></a>',
    '<a class="track-card" href="14a-build-orchestration.html"><span class="nav-code">构建</span><h3>生产输出如何形成</h3><p>从 Builder、Environment、Rolldown 图走到 preload、manifest 与压缩。</p><span class="track-path">14A → 14B</span></a>',
    '<a class="track-card" href="15a-ssr-transform-and-loading.html"><span class="nav-code">服务端</span><h3>SSR 与 Module Runner</h3><p>区分协议改写、模块获取、求值缓存、循环依赖和 HMR。</p><span class="track-path">05 → 15A → 15B</span></a>',
    '</div></section>',
  ].join('')

  const moduleSections = groups
    .map((group) => {
      const cards = group.pages
        .map((page) => {
          return [
            '<a class="module-card" href="',
            page.slug,
            '.html"><span class="module-code">',
            page.code,
            '</span><h3>',
            escapeHtml(page.nav),
            '</h3><p>',
            escapeHtml(page.lede),
            '</p><span class="module-arrow">进入本模块 →</span></a>',
          ].join('')
        })
        .join('')
      return [
        '<section id="模块-',
        slugify(group.name),
        '"><div class="module-group-heading"><h2>',
        escapeHtml(group.name),
        '</h2><p>',
        escapeHtml(group.description),
        '</p></div><div class="module-grid">',
        cards,
        '</div></section>',
      ].join('')
    })
    .join('')

  const boundary = [
    '<section id="证据边界"><div class="module-group-heading"><h2>证据边界</h2><p>分享不等于省略版本条件</p></div>',
    '<aside class="boundary-note"><p>全站限定 Vite ',
    version,
    '（commit ',
    commit,
    '）。源码片段来自该版本，测试只作为静态证据阅读，本轮未执行。普通 unbundled dev、bundled dev、生产构建和 SSR 的状态边界分别说明，不互相套用。</p></aside></section>',
  ].join('')

  const hero = [
    '<header class="article-hero index-hero">',
    '<div class="eyebrow"><span class="pill">23 pages</span><span>Vite ',
    version,
    '</span></div><h1>Vite 源码：从一次请求看懂增量系统</h1>',
    '<p class="lede">一页一个重点模块。先分清对象与状态，再沿真实入口串起开发请求、依赖优化、HMR、构建和 SSR。</p>',
    '<div class="hero-meta"><span>22 个机制模块</span><span>commit <code>',
    commit.slice(0, 12),
    '</code></span><span>离线可读</span><a href="../../vite/reading-guides/README.md">查看 Markdown 索引</a></div></header>',
  ].join('')

  const content = [
    hero,
    '<div class="prose">',
    thesis,
    ownership,
    tracks,
    moduleSections,
    boundary,
    '</div><footer class="site-footer">建议从 00 开始，再按目标路线深入；每页末尾可顺序翻篇。</footer>',
  ].join('')

  return renderShell({
    documentTitle: 'Vite 源码解剖 · 多页面分享指南',
    description: '基于 Vite v8.2.1 真实源码与测试证据的多页面中文阅读指南。',
    current: 'index',
    pathLabel: '阅读总览 / 22 个重点模块',
    content,
    headings: indexHeadings,
  })
}

fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(path.join(outputDir, 'index.html'), renderIndex())

for (const [index, page] of pages.entries()) {
  fs.writeFileSync(
    path.join(outputDir, page.slug + '.html'),
    renderPage(page, index),
  )
}

console.log(
  'Generated ' +
    (pages.length + 1) +
    ' offline HTML pages in ' +
    path.relative(workspaceRoot, outputDir),
)
