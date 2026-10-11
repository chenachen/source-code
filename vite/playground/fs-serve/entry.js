import { msg } from './nested/foo'

/** root 外入口与嵌套依赖组合后的 foobar 消息；页面据此验证被允许的模块链可加载。 */
export const fullmsg = msg + 'bar'

document.querySelector('.nested-entry').textContent = fullmsg
