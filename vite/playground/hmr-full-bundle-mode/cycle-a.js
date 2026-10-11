import './cycle-b.js'

/** 环形失效场景的初始导出，执行时写页面；当前对应稳定性测试处于 skip。 */
export const value = 'cycle'
document.querySelector('.cycle').textContent = value
