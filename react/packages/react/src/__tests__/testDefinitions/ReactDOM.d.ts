/*!
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * React DOM 测试使用的 TypeScript 声明文件。
 *
 * 这里并非正式、完整的公共类型定义，只提供单元测试所需的最小表面。
 */

declare module 'react-dom' {
  /** 把元素渲染进旧版根容器。 */
  export function render(element : any, container : any) : any
  /** 从旧版根容器卸载 React 树。 */
  export function unmountComponentAtNode(container : any) : void
  /** 查找类组件实例关联的宿主 DOM 节点。 */
  export function findDOMNode(instance : any) : any
  /** 同步冲刷回调中安排的更新。 */
  export function flushSync(cb : any) : any
}
