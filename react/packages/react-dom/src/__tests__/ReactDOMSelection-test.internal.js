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
  /** `simpleModernOffsetsFromPoints`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `simpleModernOffsetsFromPoints.traverse`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** `getFixture`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「returns correctly for base case」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接表单宿主状态、ReactDOMSharedInternals 与提交后受控值恢复路径。
   */
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

  /** 测试场景：验证「returns correctly for fuzz test」描述的渲染、交互或错误处理结果。 */
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

    /** `randomNode`：封装当前用例复用的操作、回调或断言步骤。 */
    function randomNode() {
      return allNodes[(Math.random() * allNodes.length) | 0];
    }
    /** `randomOffset`：封装当前用例复用的操作、回调或断言步骤。 */
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
