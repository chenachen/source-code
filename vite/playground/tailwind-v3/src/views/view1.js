import { component1 } from '../components/component1'

/** 组合组件与 view 文本的 HTML，父入口接受其更新后重新渲染；测试修改文本和 utility class 检查 JS/CSS 同步更新。 */
export const view1 = /* html */ `
  <div data-id="view1">
    <div id="view1-text" class="text-green-600">|view1|</div>
    ${component1}
  </div>
`
