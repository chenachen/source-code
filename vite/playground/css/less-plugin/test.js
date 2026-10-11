functions.add(
  'test',
  /** 注册 Less 的 test() 函数，返回透明 PNG 的 data URL，供 Less 插件 URL 转换测试使用。 */
  function test() {
    const transparentPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYGD4/x8AAwIB/8myre4AAAAASUVORK5CYII='
    return `url(${transparentPng})`
  }
)
