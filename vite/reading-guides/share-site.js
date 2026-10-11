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

  var expandedDiagram = null

  function closeDiagram() {
    if (!expandedDiagram) return
    var figure = expandedDiagram
    var button = figure.querySelector('[data-diagram-action="expand"]')
    figure.classList.remove('is-expanded')
    figure.removeAttribute('role')
    figure.removeAttribute('aria-modal')
    body.classList.remove('diagram-is-expanded')
    button.setAttribute('aria-expanded', 'false')
    button.textContent = '展开图示'
    expandedDiagram = null
    button.focus()
  }

  document.querySelectorAll('.engineering-diagram').forEach(function (figure) {
    var viewport = figure.querySelector('.diagram-viewport')
    var canvas = figure.querySelector('.diagram-canvas')
    var output = figure.querySelector('.diagram-scale')
    var width = Number(figure.getAttribute('data-diagram-width'))
    var scale = 1

    function setScale(next) {
      scale = Math.min(2, Math.max(0.15, next))
      canvas.style.width = width * scale + 'px'
      output.textContent = Math.round(scale * 100) + '%'
    }

    figure.querySelectorAll('[data-diagram-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.getAttribute('data-diagram-action')
        if (action === 'in') setScale(scale * 1.2)
        if (action === 'out') setScale(scale / 1.2)
        if (action === 'fit') setScale(viewport.clientWidth / width)
        if (action === 'reset') setScale(1)
        if (action === 'expand') {
          if (expandedDiagram === figure) {
            closeDiagram()
            return
          }
          closeDiagram()
          expandedDiagram = figure
          figure.classList.add('is-expanded')
          figure.setAttribute('role', 'dialog')
          figure.setAttribute('aria-modal', 'true')
          body.classList.add('diagram-is-expanded')
          button.setAttribute('aria-expanded', 'true')
          button.textContent = '收起图示'
          button.focus()
        }
      })
    })
  })

  document.addEventListener('keydown', function (event) {
    if (!expandedDiagram) return
    if (event.key === 'Escape') closeDiagram()
    if (event.key === 'Tab') {
      var controls = Array.from(
        expandedDiagram.querySelectorAll('button, a, [tabindex="0"]'),
      )
      var first = controls[0]
      var last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  })

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
