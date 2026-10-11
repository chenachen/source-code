/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 用 createObjectURL 生成临时 src；img load 或媒体 loadstart/error 后撤销 URL 并移除清理监听。 */
export function setSrcObject(domElement: Element, tag: string, value: any) {
  // 交给浏览器 createObjectURL 判断支持的对象类型，也接受其他 realm 的对象。
  const url = URL.createObjectURL(value as any);
  const loadEvent = tag === 'img' ? 'load' : 'loadstart';
  /** 撤销本次创建的 object URL，并移除 load/loadstart 与 error 两个监听。 */
  const cleanUp = () => {
    // load/loadstart 或 error 到达后释放本次临时 URL，并移除配对监听。
    URL.revokeObjectURL(url);
    domElement.removeEventListener(loadEvent, cleanUp);
    domElement.removeEventListener('error', cleanUp);
  };
  domElement.addEventListener(loadEvent, cleanUp);
  domElement.addEventListener('error', cleanUp);
  domElement.setAttribute('src', url);
}
