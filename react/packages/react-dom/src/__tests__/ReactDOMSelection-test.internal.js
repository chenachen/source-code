/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let ReactDOMSelection;
let act;

let getModernOffsetsFromPoints;

describe('ReactDOMSelection', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMSelection = require('react-dom-bindings/src/client/ReactDOMSelection');
    act = require('internal-test-utils').act;

    ({getModernOffsetsFromPoints} = ReactDOMSelection);
  });

// 用于比较正确性的简单实现。React 的旧实现使用 DOM Range 对象，可通过以下地址手动测试：
// https://gist.github.com/sophiebits/2e6d571f4f10f33b62ea138a6e9c265c

  /** 递归深度优先累计 Text UTF16 长度；Text 偏移加长度、Element 偏移定位 childNodes 间隙，用作随机测试的独立参照实现。 */
  function simpleModernOffsetsFromPoints(
    outerNode,
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset,
  ) {
    let start;
    let end;
    let length = 0;

    /** 逐子节点递归，并在每个元素子节点边界与文本内部记录 anchor/focus 的累计偏移。 */
    function traverse(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node === anchorNode) {
          start = length + anchorOffset;
        }
        if (node === focusNode) {
          end = length + focusOffset;
        }
        length += node.nodeValue.length;
        return;
      }

      for (let i = 0; true; i++) {
        if (node === anchorNode && i === anchorOffset) {
          start = length;
        }
        if (node === focusNode && i === focusOffset) {
          end = length;
        }
        if (i === node.childNodes.length) {
          break;
        }
        const n = node.childNodes[i];
        traverse(n);
      }
    }
    traverse(outerNode);

    if (start === null || end === null) {
      throw new Error('Provided anchor/focus nodes were outside of root.');
    }
    return {start, end};
  }

  // 复杂示例源自一个真实的 DOM 树。 包含各种各样的东西。

  /** 提交含空 div、深层嵌套、相邻插值 Text 的固定 27 元素树，返回宿主根以枚举所有选择点。 */
  async function getFixture() {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div>
            <div>
              <div>xxxxxxxxxxxxxxxxxxxx</div>
            </div>
            x
            <div>
              <div>
                x
                <div>
                  <div>
                    <div>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</div>
                    <div />
                    <div />
                    <div>xxxxxxxxxxxxxxxxxx</div>
                  </div>
                </div>
              </div>
            </div>
            <div />
          </div>
          <div>
            <div>
              <div>
                <div>xxxx</div>
                <div>xxxxxxxxxxxxxxxxxxx</div>
              </div>
            </div>
            <div>xxx</div>
            <div>xxxxx</div>
            <div>xxx</div>
            <div>
              <div>
                <div>
                  <div>{['x', 'x', 'xxx']}</div>
                </div>
              </div>
            </div>
          </div>
          <div>
            <div>xxxxxx</div>
          </div>
        </div>,
      );
    });
    return container.firstChild;
  }

  /** 对空 div 使用自身作为 anchor/focus 且两个子节点偏移均为 0；生产 helper 与递归参照都应返回 start=0/end=0，验证无文本的基线选择区。 */
  it('returns correctly for base case', () => {
    const node = document.createElement('div');
    expect(getModernOffsetsFromPoints(node, node, 0, node, 0)).toEqual({
      start: 0,
      end: 0,
    });
    expect(simpleModernOffsetsFromPoints(node, node, 0, node, 0)).toEqual({
      start: 0,
      end: 0,
    });
  });

  /** fixture 含 27 元素、补文本后共 41 节点；随机生成 2000 组合法节点与节点内偏移，比较生产遍历和简单递归的结果，任意不等即带节点索引抛错，验证嵌套、空节点、元素边界与 Text 字符偏移组合。 */
  it('returns correctly for fuzz test', async () => {
    const fixtureRoot = await getFixture();
    const allNodes = [fixtureRoot].concat(
      Array.from(fixtureRoot.querySelectorAll('*')),
    );
    expect(allNodes.length).toBe(27);
    allNodes.slice().forEach(element => {
      // 添加文本节点。
      allNodes.push(
        ...Array.from(element.childNodes).filter(n => n.nodeType === 3),
      );
    });
    expect(allNodes.length).toBe(41);

    /** 从固定 41 节点数组均匀随机取一个 anchor 或 focus 候选，包含元素与 Text。 */
    function randomNode() {
      return allNodes[(Math.random() * allNodes.length) | 0];
    }

    /** 在 Text 字符长度或 Element 子节点数量的闭区间 0..length 生成偏移，包含节点末端边界。 */
    function randomOffset(node) {
      return (
        (Math.random() *
          (1 +
            (node.nodeType === 3 ? node.nodeValue : node.childNodes).length)) |
        0
      );
    }

    for (let i = 0; i < 2000; i++) {
      const anchorNode = randomNode();
      const anchorOffset = randomOffset(anchorNode);
      const focusNode = randomNode();
      const focusOffset = randomOffset(focusNode);

      const offsets1 = getModernOffsetsFromPoints(
        fixtureRoot,
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
      );
      const offsets2 = simpleModernOffsetsFromPoints(
        fixtureRoot,
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
      );
      if (JSON.stringify(offsets1) !== JSON.stringify(offsets2)) {
        throw new Error(
          JSON.stringify(offsets1) +
            ' does not match ' +
            JSON.stringify(offsets2) +
            ' for anchorNode=allNodes[' +
            allNodes.indexOf(anchorNode) +
            '], anchorOffset=' +
            anchorOffset +
            ', focusNode=allNodes[' +
            allNodes.indexOf(focusNode) +
            '], focusOffset=' +
            focusOffset,
        );
      }
    }
  });
});
