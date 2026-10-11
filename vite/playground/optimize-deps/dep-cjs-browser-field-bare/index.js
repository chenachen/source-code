'use strict'

/** 加载本包 internal 模块，间接触发 browser 字段对裸 events 导入的替换。 */
const internal = require('./internal')

module.exports = internal
