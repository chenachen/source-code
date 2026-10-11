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
/** 直接导入DOM selection内部文本偏移遍历器，返回指定字符所属Text节点及局部offset；本组覆盖多层DOM/空节点而不是通过公共selection事件间接触发。 */
const getNodeForCharacterOffset =
  require('react-dom-bindings/src/client/getNodeForCharacterOffset').default;

// 从 HTML 字符串创建节点
/** 在独立 HTMLDocument 中解析传入 markup 并返回包裹 div，保留多层与空节点的真实 DOM 文本结构。 */
function createNode(html) {
  const node = (getTestDocument() || document).createElement('div');
  node.innerHTML = html;
  return node;
}

/** 新建并写入可选 HTML 文档，缺省补最小 charset/title；隔离 fixture 的节点所有者文档。 */
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
/** 同时核对定位到的 Text 内容和该节点内偏移，避免只比较全局文字而漏掉跨节点定位错误。 */
function expectNodeOffset(result, textContent, nodeOffset) {
  expect(result.node.textContent).toBe(textContent);
  expect(result.offset).toBe(nodeOffset);
}

describe('getNodeForCharacterOffset', () => {
  /** 从三个兄弟 i 的串联文本 123456789 查全局偏移 0 和 4；应分别定位第一文本节点的 0 与第二节点的 1，验证跨兄弟累计字符数。 */
  it('should handle siblings', () => {
    const node = createNode('<i>123</i><i>456</i><i>789</i>');

    expectNodeOffset(getNodeForCharacterOffset(node, 0), '123', 0);
    expectNodeOffset(getNodeForCharacterOffset(node, 4), '456', 1);
  });

  /** 同一兄弟树查偏移 3 和末尾 9；应取前一节点末尾 3 而非下一节点开头，验证相等边界归属于当前 Text 的尾端。 */
  it('should handle trailing chars', () => {
    const node = createNode('<i>123</i><i>456</i><i>789</i>');

    expectNodeOffset(getNodeForCharacterOffset(node, 3), '123', 3);
    expectNodeOffset(getNodeForCharacterOffset(node, 9), '789', 3);
  });

  /** 构造带空 i 的多层文本树，查偏移 3/5/10；前两项应定位文本 3 的尾端和 45 的尾端，超出总长应 undefined，验证深度优先文本遍历跳过空元素。 */
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

  /** 单一文本 123 查 -1 和 4；两项都应 undefined，验证负值与超过末尾的偏移不制造节点结果。 */
  it('should handle non-existent offset', () => {
    const node = createNode('<i>123</i>');

    expect(getNodeForCharacterOffset(node, -1)).toBeUndefined();
    expect(getNodeForCharacterOffset(node, 4)).toBeUndefined();
  });
});
