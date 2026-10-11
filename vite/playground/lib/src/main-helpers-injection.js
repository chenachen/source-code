// 字符串包含类似 wrapper 的 use strict 文本，覆盖 helper 注入误匹配字符串的场景。
;(function () {
  /** 尝试用 $Function 从语法表达式取得构造器，失败返回 undefined；字符串内的 use strict 用于检查 helper 注入不误匹配字符串。 */
  var getEvalledConstructor = function (expressionSyntax) {
    try {
      return $Function(
        '"use strict"; return (' + expressionSyntax + ').constructor;',
      )()
    } catch (e) {}
  }
  console.log(getEvalledConstructor(0))
})()
