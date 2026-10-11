/** 先于静态 CSS 求值插入的橙色样式，用后续蓝色和动态绿色验证 CSS 应用顺序。 */
const style = document.createElement('style')
style.textContent = '.order-bulk { color: orange; }'
document.head.appendChild(style)
