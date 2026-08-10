;(() => {
  const root = document.documentElement
  const topbar = document.querySelector('.topbar')
  const themeButton = document.querySelector('[data-theme-toggle]')
  const menuButton = document.querySelector('[data-menu-toggle]')
  const globalNav = document.querySelector('.global-nav')
  const modes = ['auto', 'light', 'dark']
  const labels = { auto: '自动', light: '浅色', dark: '深色' }
  let mode = localStorage.getItem('vue-compiler-guide-theme') || 'auto'

  if (!modes.includes(mode)) mode = 'auto'

  const applyTheme = next => {
    mode = next
    root.dataset.theme = mode
    if (themeButton) {
      themeButton.textContent = labels[mode]
      themeButton.setAttribute(
        'aria-label',
        `当前${labels[mode]}配色，点击切换`,
      )
    }
    localStorage.setItem('vue-compiler-guide-theme', mode)
  }

  applyTheme(mode)

  if (globalNav) {
    const suiteLink = document.createElement('a')
    suiteLink.className = 'suite-link'
    suiteLink.href = '../index.html'
    suiteLink.textContent = '三专题总览'
    globalNav.prepend(suiteLink)
  }

  themeButton?.addEventListener('click', () => {
    applyTheme(modes[(modes.indexOf(mode) + 1) % modes.length])
  })

  menuButton?.addEventListener('click', () => {
    const open = topbar?.classList.toggle('menu-open') || false
    menuButton.setAttribute('aria-expanded', String(open))
  })

  document.querySelectorAll('.global-nav a').forEach(link => {
    link.addEventListener('click', () => {
      topbar?.classList.remove('menu-open')
      menuButton?.setAttribute('aria-expanded', 'false')
    })
  })

  const outlineLinks = [...document.querySelectorAll('.rail nav a[href^="#"]')]
  const sections = outlineLinks
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean)

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return
        outlineLinks.forEach(link => {
          const active = link.getAttribute('href') === `#${visible.target.id}`
          if (active) link.setAttribute('aria-current', 'true')
          else link.removeAttribute('aria-current')
        })
      },
      { rootMargin: '-14% 0px -72% 0px', threshold: [0, 0.2, 0.55] },
    )
    sections.forEach(section => observer.observe(section))
  }
})()
