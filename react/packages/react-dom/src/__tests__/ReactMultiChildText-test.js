/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');
/** `act`：保存当前测试场景复用的夹具、状态或回调。 */
const act = require('internal-test-utils').act;

// 帮助人
/** `testAllPermutations`：封装当前用例复用的操作、回调或断言步骤。 */
const testAllPermutations = async function (testCases) {
  for (let i = 0; i < testCases.length; i += 2) {
    const renderWithChildren = testCases[i];
    const expectedResultAfterRender = testCases[i + 1];

    for (let j = 0; j < testCases.length; j += 2) {
      const updateWithChildren = testCases[j];
      const expectedResultAfterUpdate = testCases[j + 1];

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<div>{renderWithChildren}</div>));
      expectChildren(container, expectedResultAfterRender);

      await act(() => root.render(<div>{updateWithChildren}</div>));
      expectChildren(container, expectedResultAfterUpdate);
    }
  }
};

/** `expectChildren`：封装当前用例复用的操作、回调或断言步骤。 */
const expectChildren = function (container, children) {
  const outerNode = container.firstChild;
  let textNode;
  if (typeof children === 'string') {
    textNode = outerNode.firstChild;

    if (children === '') {
      expect(textNode != null).toBe(false);
    } else {
      expect(textNode != null).toBe(true);
      expect(textNode.nodeType).toBe(3);
      expect(textNode.data).toBe(String(children));
    }
  } else {
    let mountIndex = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];

      if (typeof child === 'string') {
        if (child === '') {
          continue;
        }
        textNode = outerNode.childNodes[mountIndex];
        expect(textNode != null).toBe(true);
        expect(textNode.nodeType).toBe(3);
        expect(textNode.data).toBe(child);
        mountIndex++;
      } else {
        const elementDOMNode = outerNode.childNodes[mountIndex];
        expect(elementDOMNode.tagName).toBe('DIV');
        mountIndex++;
      }
    }
  }
};

/**
 * 集成测试：ReactMultiChild 在 ReactDOM 组件中， 我们确保将单个字符串子元素视为 "content"，这
 * 比渲染和更新更快。
 */
describe('ReactMultiChildText', () => {
  jest.setTimeout(30000);

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should correctly handle all possible children for render and update」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should correctly handle all possible children for render and update', async () => {
    spyOnDev(console, 'error').mockImplementation(() => {});
    // prettier-ignore
    await testAllPermutations([
      // 基本值
      undefined, [],
      null, [],
      false, [],
      true, [],
      0, '0',
      1.2, '1.2',
      '', [],
      'foo', 'foo',
    
      [], [],
      [undefined], [],
      [null], [],
      [false], [],
      [true], [],
      [0], ['0'],
      [1.2], ['1.2'],
      [''], [],
      ['foo'], ['foo'],
      [<div />], [<div />],
    
      // 两个相邻的值
      [true, 0], ['0'],
      [0, 0], ['0', '0'],
      [1.2, 0], ['1.2', '0'],
      [0, ''], ['0', ''],
      ['foo', 0], ['foo', '0'],
      [0, <div />], ['0', <div />],
    
      [true, 1.2], ['1.2'],
      [1.2, 0], ['1.2', '0'],
      [1.2, 1.2], ['1.2', '1.2'],
      [1.2, ''], ['1.2', ''],
      ['foo', 1.2], ['foo', '1.2'],
      [1.2, <div />], ['1.2', <div />],
    
      [true, ''], [''],
      ['', 0], ['', '0'],
      [1.2, ''], ['1.2', ''],
      ['', ''], ['', ''],
      ['foo', ''], ['foo', ''],
      ['', <div />], ['', <div />],
    
      [true, 'foo'], ['foo'],
      ['foo', 0], ['foo', '0'],
      [1.2, 'foo'], ['1.2', 'foo'],
      ['foo', ''], ['foo', ''],
      ['foo', 'foo'], ['foo', 'foo'],
      ['foo', <div />], ['foo', <div />],
    
      // 通过元素分离的值
      [true, <div />, true], [<div />],
      [1.2, <div />, 1.2], ['1.2', <div />, '1.2'],
      ['', <div />, ''], ['', <div />, ''],
      ['foo', <div />, 'foo'], ['foo', <div />, 'foo'],
    
      [true, 1.2, <div />, '', 'foo'], ['1.2', <div />, '', 'foo'],
      [1.2, '', <div />, 'foo', true], ['1.2', '', <div />, 'foo'],
      ['', 'foo', <div />, true, 1.2], ['', 'foo', <div />, '1.2'],
    
      [true, 1.2, '', <div />, 'foo', true, 1.2], ['1.2', '', <div />, 'foo', '1.2'],
      ['', 'foo', true, <div />, 1.2, '', 'foo'], ['', 'foo', <div />, '1.2', '', 'foo'],
    
      // 数组中的值
      [[true], [true]], [],
      [[1.2], [1.2]], ['1.2', '1.2'],
      [[''], ['']], ['', ''],
      [['foo'], ['foo']], ['foo', 'foo'],
      [[<div />], [<div />]], [<div />, <div />],
    
      [[true, 1.2, <div />], '', 'foo'], ['1.2', <div />, '', 'foo'],
      [1.2, '', [<div />, 'foo', true]], ['1.2', '', <div />, 'foo'],
      ['', ['foo', <div />, true], 1.2], ['', 'foo', <div />, '1.2'],
    
      [true, [1.2, '', <div />, 'foo'], true, 1.2], ['1.2', '', <div />, 'foo', '1.2'],
      ['', 'foo', [true, <div />, 1.2, ''], 'foo'], ['', 'foo', <div />, '1.2', '', 'foo'],
    
      // 元素内部的值
      [<div>{true}{1.2}{<div />}</div>, '', 'foo'], [<div />, '', 'foo'],
      [1.2, '', <div>{<div />}{'foo'}{true}</div>], ['1.2', '', <div />],
      ['', <div>{'foo'}{<div />}{true}</div>, 1.2], ['', <div />, '1.2'],
    
      [true, <div>{1.2}{''}{<div />}{'foo'}</div>, true, 1.2], [<div />, '1.2'],
      ['', 'foo', <div>{true}{<div />}{1.2}{''}</div>, 'foo'], ['', 'foo', <div />, 'foo'],
    ]);
    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(2);
      expect(console.error.mock.calls[0][0]).toMatch(
        'Each child in a list should have a unique "key" prop.',
      );
      expect(console.error.mock.calls[1][0]).toMatch(
        'Each child in a list should have a unique "key" prop.',
      );
    }
  });

  /** 测试场景：验证「should correctly handle bigint children for render and update」描述的渲染、交互或错误处理结果。 */
  it('should correctly handle bigint children for render and update', async () => {
    // prettier-ignore
    await testAllPermutations([
      10n, '10',
      [10n], ['10']
    ]);
  });

  /** 测试场景：验证「should throw if rendering both HTML and children」描述的渲染、交互或错误处理结果。 */
  it('should throw if rendering both HTML and children', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(
          <div dangerouslySetInnerHTML={{__html: 'abcdef'}}>ghjkl</div>,
        );
      }),
    ).rejects.toThrow();
  });

  /** 测试场景：验证「should render between nested components and inline children」描述的渲染、交互或错误处理结果。 */
  it('should render between nested components and inline children', async () => {
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div>
          <h1>
            <span />
            <span />
          </h1>
        </div>,
      );
    });

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(
          <div>
            <h1>A</h1>
          </div>,
        );
      }),
    ).resolves.not.toThrow();

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(
          <div>
            <h1>{['A']}</h1>
          </div>,
        );
      }),
    ).resolves.not.toThrow();

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(
          <div>
            <h1>{['A', 'B']}</h1>
          </div>,
        );
      }),
    ).resolves.not.toThrow();
  });
});
