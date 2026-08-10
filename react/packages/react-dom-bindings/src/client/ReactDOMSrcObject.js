/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** `setSrcObject` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于以赋值或属性回退方式同步媒体 srcObject。 */
export function setSrcObject(domElement: Element, tag: string, value: any) {
  //我们乐观地创建 URL，而不考虑对象类型。这让我们
  //支持跨域以及浏览器支持的任何类型，比如新类型。
  const url = URL.createObjectURL(value as any);
  const loadEvent = tag === 'img' ? 'load' : 'loadstart';
  /** `setSrcObject.cleanUp` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于以赋值或属性回退方式同步媒体 srcObject。 */
  const cleanUp = () => {
    //一旦对象开始加载，那么它已经被...收集了
    //浏览器将不会再通过 URL 引用它，所以我们现在可以撤销它。
    URL.revokeObjectURL(url);
    domElement.removeEventListener(loadEvent, cleanUp);
    domElement.removeEventListener('error', cleanUp);
  };
  domElement.addEventListener(loadEvent, cleanUp);
  domElement.addEventListener('error', cleanUp);
  domElement.setAttribute('src', url);
}
