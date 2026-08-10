/*
Copyright (c) 2015-present, Facebook, Inc.

This source code is licensed under the MIT license found in the
LICENSE file at
https://github.com/react/create-react-app/blob/main/LICENSE
*/

/* global Application */

/**
 * JXA 入口：在指定 Chromium 应用中复用或创建用于开发地址的标签页。
 * `osascript` 会把命令行参数作为数组传入此约定名称的函数。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  const urlToOpen = argv[0]
  // 浏览器应用名可省略；直接执行脚本时默认操作稳定版 Google Chrome。
  const programName = argv[1] ?? 'Google Chrome'

  const app = Application(programName)

  if (app.windows.length === 0) {
    app.Window().make()
  }

  // 优先级 1：找到已打开目标地址的标签页，切换到该页并刷新，保留调试上下文。
  const found = lookupTabWithUrl(urlToOpen, app)
  if (found) {
    found.targetWindow.activeTabIndex = found.targetTabIndex
    found.targetTab.reload()
    found.targetWindow.index = 1
    app.activate()
    return
  }

  // 优先级 2：没有目标页时复用 Chrome 空白新标签，避免制造多余标签页。
  const emptyTabFound = lookupTabWithUrl('chrome://newtab/', app)
  if (emptyTabFound) {
    emptyTabFound.targetWindow.activeTabIndex = emptyTabFound.targetTabIndex
    emptyTabFound.targetTab.url = urlToOpen
    app.activate()
    return
  }

  // 优先级 3：既无目标页也无空白页，才在第一个窗口创建新标签。
  const firstWindow = app.windows[0]
  firstWindow.tabs.push(app.Tab({ url: urlToOpen }))
  app.activate()
}

/**
 * 在所有窗口中查找 URL 包含给定字符串的第一个标签页。
 *
 * JXA 的 activeTabIndex 从 1 开始，因此返回数组索引时加一；同时返回窗口与标签
 * 对象，调用方可完成聚焦、刷新或改写 URL。
 */
function lookupTabWithUrl(lookupUrl, app) {
  const windows = app.windows()
  for (const window of windows) {
    for (const [tabIndex, tab] of window.tabs().entries()) {
      if (tab.url().includes(lookupUrl)) {
        return {
          targetTab: tab,
          targetTabIndex: tabIndex + 1,
          targetWindow: window,
        }
      }
    }
  }
}
