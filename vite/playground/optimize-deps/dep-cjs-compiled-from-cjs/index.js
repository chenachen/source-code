'use strict'
/** 返回 foo 的 CommonJS 函数默认值，同时携带 bar 属性；用于 namespace 与 default 互操作对照。 */
function foo() {
  return 'foo'
}
foo.bar = 'bar'
module.exports = foo
