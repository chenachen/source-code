import barJson from 'virtual:/bar.json'
import fooJson from './foo.json'

// transform 插件注入转换计数，页面显示该值以观察重新转换。
document.getElementById('transform-count').innerHTML = TRANSFORM_COUNT

document.getElementById('module-type-json-pre').innerHTML =
  fooJson.moduleTypePre
document.getElementById('module-type-json-post').innerHTML =
  fooJson.moduleTypePost

document.getElementById('module-type-json-virtual-pre').innerHTML =
  barJson.moduleTypePre
document.getElementById('module-type-json-virtual-post').innerHTML =
  barJson.moduleTypePost

// lazy-hook-filter 插件替换下方占位字符串。
document.getElementById('lazy-hook-filter').innerHTML =
  'LAZY_HOOK_FILTER_CONTENT'
