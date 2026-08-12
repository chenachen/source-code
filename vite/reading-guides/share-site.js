;(function () {
  'use strict'

  var root = document.documentElement
  var body = document.body
  var themeButton = document.querySelector('[data-theme-toggle]')
  var navButton = document.querySelector('[data-nav-toggle]')
  var progress = document.querySelector('[data-reading-progress]')

  function setTheme(theme) {
    root.setAttribute('data-theme', theme)
    if (themeButton) {
      themeButton.setAttribute(
        'aria-label',
        theme === 'dark' ? '切换到浅色模式' : '切换到深色模式',
      )
      themeButton.textContent = theme === 'dark' ? '☀' : '◐'
    }
  }

  var savedTheme
  try {
    savedTheme = localStorage.getItem('vite-guide-theme')
  } catch (_) {
    savedTheme = null
  }
  setTheme(
    savedTheme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'),
  )

  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      setTheme(next)
      try {
        localStorage.setItem('vite-guide-theme', next)
      } catch (_) {
        // file:// 或隐私模式下 localStorage 可能不可用；主题仍对当前页面生效。
      }
    })
  }

  function closeNavigation() {
    body.classList.remove('nav-open')
    if (navButton) navButton.setAttribute('aria-expanded', 'false')
  }

  if (navButton) {
    navButton.addEventListener('click', function () {
      var open = body.classList.toggle('nav-open')
      navButton.setAttribute('aria-expanded', String(open))
    })
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeNavigation()
  })

  document.querySelectorAll('.site-nav a').forEach(function (link) {
    link.addEventListener('click', closeNavigation)
  })

  function updateProgress() {
    if (!progress) return
    var scrollable = document.documentElement.scrollHeight - window.innerHeight
    var ratio = scrollable > 0 ? window.scrollY / scrollable : 0
    progress.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%'
  }

  updateProgress()
  window.addEventListener('scroll', updateProgress, { passive: true })
  window.addEventListener('resize', updateProgress)

  document.querySelectorAll('.copy-code').forEach(function (button) {
    button.addEventListener('click', async function () {
      var code = button.closest('.code-card').querySelector('code')
      var value = code ? code.textContent : ''
      var copied = false

      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(value)
          copied = true
        } catch (_) {
          copied = false
        }
      }

      if (!copied) {
        var input = document.createElement('textarea')
        input.value = value
        input.setAttribute('readonly', '')
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        copied = document.execCommand('copy')
        input.remove()
      }

      var previous = button.textContent
      button.textContent = copied ? '已复制' : '复制失败'
      window.setTimeout(function () {
        button.textContent = previous
      }, 1200)
    })
  })

  var tocLinks = Array.from(document.querySelectorAll('.toc-list a'))
  var tocById = new Map(
    tocLinks.map(function (link) {
      return [decodeURIComponent(link.hash.slice(1)), link]
    }),
  )
  var headings = Array.from(
    document.querySelectorAll(
      '.prose h2[id], .prose h3[id], .prose section[id]',
    ),
  )

  if ('IntersectionObserver' in window && headings.length > 0) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          tocLinks.forEach(function (link) {
            link.classList.remove('is-active')
          })
          var active = tocById.get(entry.target.id)
          if (active) active.classList.add('is-active')
        })
      },
      { rootMargin: '-18% 0px -72% 0px' },
    )
    headings.forEach(function (heading) {
      observer.observe(heading)
    })
  }
})()
