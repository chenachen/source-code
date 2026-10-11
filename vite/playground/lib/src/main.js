export default /* @__PURE__ */ Object.assign(/** 向调用者指定节点写入库运行消息，并保留 process.env.NODE_ENV、展开与调试语句供各输出格式/压缩器断言。 */ function myLib(sel) {
  // 对象展开触发兼容 helper，覆盖库 wrapper 内的 helper 放置。
  // 原 esbuild 场景：https://github.com/evanw/esbuild/issues/951
  console.log({ ...'foo' })

  document.querySelector(sel).textContent = 'It works'

  // 库输出保留 process.env.NODE_ENV，让调用方决定环境替换。
  console.log(process.env.NODE_ENV)

  // 字符串含类似 UMD wrapper 的文本，检查 helper 放置不会误匹配它。
  console.log(`amd function(){ "use strict"; }`)

  // eslint-disable-next-line no-debugger
  debugger
})

// 可选链调用覆盖此前正则注入 helper 的全局放置场景。
;(function () {})()?.foo
