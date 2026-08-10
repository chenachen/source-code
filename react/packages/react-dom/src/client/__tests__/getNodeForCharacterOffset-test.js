/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// TODO：是否可以仅使用公共 API 表达这个测试？
const getNodeForCharacterOffset =
  require('react-dom-bindings/src/client/getNodeForCharacterOffset').default;

// 从 HTML 字符串创建节点
/** `createNode`：封装当前用例复用的操作、回调或断言步骤。 */
function createNode(html) {
  const node = (getTestDocument() || document).createElement('div');
  node.innerHTML = html;
  return node;
}

/** `getTestDocument`：封装当前用例复用的操作、回调或断言步骤。 */
function getTestDocument(markup) {
  const doc = document.implementation.createHTMLDocument('');
  doc.open();
  doc.write(
    markup ||
      '<!doctype html><html><meta charset=utf-8><title>test doc</title>',
  );
  doc.close();
  return doc;
}

// 检查 getNodeForCharacterOffset返回值与预期结果匹配.
/** `expectNodeOffset`：封装当前用例复用的操作、回调或断言步骤。 */
function expectNodeOffset(result, textContent, nodeOffset) {
  expect(result.node.textContent).toBe(textContent);
  expect(result.offset).toBe(nodeOffset);
}

describe('getNodeForCharacterOffset', () => {
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should handle siblings」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should handle siblings', () => {
    const node = createNode('<i>123</i><i>456</i><i>789</i>');

    expectNodeOffset(getNodeForCharacterOffset(node, 0), '123', 0);
    expectNodeOffset(getNodeForCharacterOffset(node, 4), '456', 1);
  });

  /** 测试场景：验证「should handle trailing chars」描述的渲染、交互或错误处理结果。 */
  it('should handle trailing chars', () => {
    const node = createNode('<i>123</i><i>456</i><i>789</i>');

    expectNodeOffset(getNodeForCharacterOffset(node, 3), '123', 3);
    expectNodeOffset(getNodeForCharacterOffset(node, 9), '789', 3);
  });

  /** 测试场景：验证「should handle trees」描述的渲染、交互或错误处理结果。 */
  it('should handle trees', () => {
    const node = createNode(
      '<i>' +
        '<i>1</i>' +
        '<i>' +
        '<i>' +
        '<i>2</i>' +
        '<i></i>' +
        '</i>' +
        '</i>' +
        '<i>' +
        '3' +
        '<i>45</i>' +
        '</i>' +
        '</i>',
    );

    expectNodeOffset(getNodeForCharacterOffset(node, 3), '3', 1);
    expectNodeOffset(getNodeForCharacterOffset(node, 5), '45', 2);
    expect(getNodeForCharacterOffset(node, 10)).toBeUndefined();
  });

  /** 测试场景：验证「should handle non-existent offset」描述的渲染、交互或错误处理结果。 */
  it('should handle non-existent offset', () => {
    const node = createNode('<i>123</i>');

    expect(getNodeForCharacterOffset(node, -1)).toBeUndefined();
    expect(getNodeForCharacterOffset(node, 4)).toBeUndefined();
  });
});
