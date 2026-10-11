/* eslint-disable import-x/no-duplicates */
import ra from './no-ext'
import rb from './no-ext.js' // 此显式路径不做替换
import rc from './ext'
import rd from './ext.js'
import re from './ext-index/index.js'
import rf from './no-ext-index/index.js' // 此相对导入没有 browser 替换映射。

export { ra, rb, rc, rd, re, rf }
