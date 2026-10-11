import plusCircle from './+circle.svg'
import underscoreCircle from './_circle.svg'
/** 把导入的 SVG URL 同时写入背景和文本，供测试比较浏览器加载与文件名清理结果。 */
function setData(classname, file) {
  const el = document.body.querySelector(classname)
  el.style.backgroundImage = `url(${file})`
  el.textContent = file
}
setData('.plus-circle', plusCircle)
setData('.underscore-circle', underscoreCircle)
