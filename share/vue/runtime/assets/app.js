;(() => {
  const navigation = [
    {
      title: '开始',
      items: [
        ['index.html', '总览与使用方式', '建立完整学习地图'],
        ['primer.html', '零基础先修课', '先懂页面如何发生变化'],
      ],
    },
    {
      title: 'runtime-core',
      items: [
        ['architecture.html', '为什么要分层', '先认清 core 与宿主边界'],
        ['component.html', '组件怎样活起来', '定义、实例与生命周期'],
        ['renderer.html', '页面该改哪里', '创建、更新、移动、离开'],
        ['diff.html', '列表怎样少动 DOM', 'key、复用、LIS、移动'],
        ['scheduler.html', '为什么不立刻更新', '合并、顺序、nextTick'],
        ['hydration.html', '怎样接管 SSR 页面', '认领、恢复、懒水合'],
        ['builtins.html', '四个特殊组件', '位置、等待、缓存、动画'],
      ],
    },
    {
      title: 'runtime-dom',
      items: [['runtime-dom.html', '浏览器怎样执行', '属性、事件、输入与动画']],
    },
    {
      title: '两层如何接起来',
      items: [
        ['integration.html', '按钮完整调用链', '从 renderer 构造走到 DOM 提交'],
      ],
    },
    {
      title: '演进与实践',
      items: [
        ['evolution.html', '真实问题与演进', '从用户故障理解历史'],
        ['testing.html', '怎样证明更新正确', '结果、身份、顺序、恢复'],
      ],
    },
  ]

  const current = document.body.dataset.current || 'index.html'
  const root = document.documentElement

  let savedTheme = null
  try {
    savedTheme = localStorage.getItem('vue-runtime-site-theme')
  } catch {
    // file:// 环境可能禁止持久化；不影响本次页面的主题切换。
  }
  root.dataset.theme =
    savedTheme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light')

  const header = document.querySelector('[data-site-header]')
  if (header) {
    header.className = 'site-header'
    header.innerHTML = `
      <div class="reading-progress" aria-hidden="true"></div>
      <div class="site-header-inner">
        <a class="site-brand" href="index.html">
          <span class="site-brand-mark">V</span>
          <span class="site-brand-copy">
            <strong>Vue Runtime 内核解剖</strong>
            <span>从 runtime-core 到 runtime-dom，再用一个 Counter 串起来 · v3.5.41</span>
          </span>
        </a>
        <div class="header-actions">
          <a class="header-button suite-button" href="../index.html">三专题总览</a>
          <button class="menu-button" type="button" aria-expanded="false">章节</button>
          <button class="header-button theme-button" type="button"></button>
          <button class="header-button print-button" type="button">打印本章</button>
        </div>
      </div>`
  }

  const nav = document.querySelector('[data-global-nav]')
  if (nav) {
    nav.className = 'global-nav'
    nav.setAttribute('aria-label', '全站章节')
    nav.innerHTML = navigation
      .map(
        group => `
        <div class="nav-group">
          <div class="nav-group-title">${group.title}</div>
          ${group.items
            .map(
              ([href, label, note]) => `
              <a href="${href}"${href === current ? ' class="active" aria-current="page"' : ''}>
                ${label}<span>${note}</span>
              </a>`,
            )
            .join('')}
        </div>`,
      )
      .join('')
  }

  const backdrop = document.createElement('div')
  backdrop.className = 'nav-backdrop'
  document.body.appendChild(backdrop)

  const menuButton = document.querySelector('.menu-button')
  const closeMenu = () => {
    document.body.classList.remove('nav-open')
    menuButton?.setAttribute('aria-expanded', 'false')
  }
  menuButton?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open')
    menuButton.setAttribute('aria-expanded', String(open))
  })
  backdrop.addEventListener('click', closeMenu)
  nav
    ?.querySelectorAll('a')
    .forEach(link => link.addEventListener('click', closeMenu))

  const themeButton = document.querySelector('.theme-button')
  const updateThemeLabel = () => {
    if (themeButton) {
      themeButton.textContent = root.dataset.theme === 'dark' ? '浅色' : '深色'
      themeButton.setAttribute(
        'aria-label',
        root.dataset.theme === 'dark' ? '切换为浅色主题' : '切换为深色主题',
      )
    }
  }
  updateThemeLabel()
  themeButton?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem('vue-runtime-site-theme', root.dataset.theme)
    } catch {
      // 仅放弃持久化。
    }
    updateThemeLabel()
  })
  document
    .querySelector('.print-button')
    ?.addEventListener('click', () => window.print())

  document.querySelectorAll('[data-tabs]').forEach(tabRoot => {
    const buttons = [...tabRoot.querySelectorAll('[data-tab]')]
    const panels = [...tabRoot.querySelectorAll('[data-tab-panel]')]
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const target = button.dataset.tab
        buttons.forEach(item =>
          item.setAttribute('aria-selected', String(item === button)),
        )
        panels.forEach(panel => {
          panel.hidden = panel.dataset.tabPanel !== target
        })
      })
    })
  })

  document.querySelectorAll('[data-runtime-demo]').forEach(demo => {
    const stages = [...demo.querySelectorAll('[data-demo-stage]')]
    const output = demo.querySelector('[data-demo-output]')
    const explanation = demo.querySelector('[data-demo-explanation]')
    let step = -1
    const messages = [
      '教程测试在同一同步调用栈内调用 triggerEvent 两次，处理函数把 count 从 0 写到 1，再写到 2。',
      'Vue 把同一个组件 job 排入队列；第二次通知因 QUEUED 位不会复制任务。',
      '组件在微任务里读取最终 count=2，生成新的 button VNode。',
      'Renderer 比较 button 0 与 button 2：type/key 相同，可复用旧宿主节点。',
      '宿主层只把 button 的文本 children 从 0 更新为 2。',
      'post flush 完成并清理队列后，等待当前 flush 的 nextTick 才恢复。',
    ]

    const renderStep = () => {
      stages.forEach((stage, index) => {
        stage.classList.toggle('active', index === step)
        stage.classList.toggle('done', index < step)
      })
      if (explanation)
        explanation.textContent =
          messages[step] || '点击“下一步”，观察一次更新如何穿过 Vue Runtime。'
      if (output) {
        output.textContent = step >= 4 ? '2' : '0'
        output.classList.toggle('new', step >= 4)
      }
    }

    demo.querySelector('[data-demo-next]')?.addEventListener('click', () => {
      step = (step + 1) % stages.length
      renderStep()
    })
    demo.querySelector('[data-demo-reset]')?.addEventListener('click', () => {
      step = -1
      renderStep()
    })
    renderStep()
  })

  document.querySelectorAll('[data-diff-demo]').forEach(demo => {
    const list = demo.querySelector('[data-diff-demo-list]')
    const explanation = demo.querySelector('[data-diff-explanation]')
    const cases = {
      initial: {
        items: [
          ['a', '买牛奶', ''],
          ['b', '回复邮件', ''],
          ['c', '学习 Vue', ''],
        ],
        text: '目标顺序是 a、b、c。每个 li 后面的 DOM 编号代表节点身份。',
      },
      append: {
        items: [
          ['a', '买牛奶', ''],
          ['b', '回复邮件', ''],
          ['c', '学习 Vue', ''],
          ['d', '跑步', 'new'],
        ],
        text: '目标顺序是 a、b、c、d。',
      },
      reorder: {
        items: [
          ['c', '学习 Vue', 'moved'],
          ['a', '买牛奶', ''],
          ['b', '回复邮件', ''],
        ],
        text: '目标顺序是 c、a、b。',
      },
      replace: {
        items: [
          ['a', '买牛奶', ''],
          ['d', '跑步', 'new'],
          ['c', '学习 Vue', ''],
        ],
        text: '目标顺序是 a、d、c。',
      },
    }

    let nextNodeId = 1
    const keyedNodes = new Map()

    const createItem = ([key, label, state]) => {
      const item = document.createElement('li')
      const title = document.createElement('strong')
      const identity = document.createElement('small')
      item.className = `ui-item ${state}`.trim()
      item.dataset.key = key
      item.dataset.nodeId = String(nextNodeId++)
      title.textContent = label
      identity.textContent = `key = ${key} · DOM #${item.dataset.nodeId}`
      item.append(title, identity)
      return item
    }

    const updateItem = (item, [, label, state]) => {
      item.className = `ui-item ${state}`.trim()
      item.querySelector('strong').textContent = label
      item.querySelector('small').textContent =
        `key = ${item.dataset.key} · DOM #${item.dataset.nodeId}`
    }

    const show = name => {
      const current = cases[name]
      if (!current || !list) return
      const desiredKeys = new Set(current.items.map(([key]) => key))
      const operations = { create: [], move: [], remove: [], reuse: [] }
      const createdKeys = new Set()

      for (const [key, node] of keyedNodes) {
        if (!desiredKeys.has(key)) {
          operations.remove.push(`key=${key}（DOM #${node.dataset.nodeId}）`)
          node.remove()
          keyedNodes.delete(key)
        }
      }

      const desiredNodes = current.items.map(item => {
        const [key] = item
        let node = keyedNodes.get(key)
        if (node) {
          operations.reuse.push(`key=${key}（DOM #${node.dataset.nodeId}）`)
          updateItem(node, item)
        } else {
          node = createItem(item)
          keyedNodes.set(key, node)
          createdKeys.add(key)
          operations.create.push(`key=${key}（DOM #${node.dataset.nodeId}）`)
        }
        return node
      })

      desiredNodes.forEach((node, index) => {
        const reference = list.children[index] || null
        if (node !== reference) {
          const wasMounted = node.parentNode === list
          list.insertBefore(node, reference)
          if (wasMounted && !createdKeys.has(node.dataset.key)) {
            operations.move.push(
              `key=${node.dataset.key}（DOM #${node.dataset.nodeId}）`,
            )
          }
        }
      })

      if (explanation) {
        const summarize = (label, values) =>
          `${label} ${values.length}${values.length ? `：${values.join('、')}` : ''}`
        explanation.textContent = `${current.text} 这段教学模拟本次执行的 DOM 操作：${[
          summarize('复用', operations.reuse),
          summarize('创建', operations.create),
          summarize('移动', operations.move),
          summarize('删除', operations.remove),
        ].join('；')}。`
      }
      demo
        .querySelectorAll('[data-diff-case]')
        .forEach(button =>
          button.classList.toggle('active', button.dataset.diffCase === name),
        )
    }

    demo
      .querySelectorAll('[data-diff-case]')
      .forEach(button =>
        button.addEventListener('click', () => show(button.dataset.diffCase)),
      )
    show('initial')
  })

  document.querySelectorAll('pre').forEach(block => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-code'
    button.textContent = '复制'
    button.addEventListener('click', async () => {
      const code = block.querySelector('code')
      const text = code?.innerText || ''
      try {
        await navigator.clipboard.writeText(text)
        button.textContent = '已复制'
      } catch {
        button.textContent = '选择后复制'
      }
      setTimeout(() => {
        button.textContent = '复制'
      }, 1200)
    })
    block.appendChild(button)
  })

  const progress = document.querySelector('.reading-progress')
  const updateProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (progress)
      progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`
  }
  updateProgress()
  window.addEventListener('scroll', updateProgress, { passive: true })

  const tocLinks = [...document.querySelectorAll('.page-toc a')]
  const tocSections = tocLinks
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean)
  if (tocSections.length) {
    const byId = new Map(
      tocLinks.map(link => [link.getAttribute('href').slice(1), link]),
    )
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return
        tocLinks.forEach(link => link.classList.remove('active'))
        byId.get(visible.target.id)?.classList.add('active')
      },
      { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.15, 0.45] },
    )
    tocSections.forEach(section => observer.observe(section))
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu()
  })

  const footer = document.querySelector('[data-site-footer]')
  if (footer) {
    footer.className = 'site-footer'
    footer.innerHTML =
      'Vue Runtime 内核解剖 · 基于 vuejs/core v3.5.41 · 支持离线分享与打印'
  }
})()
