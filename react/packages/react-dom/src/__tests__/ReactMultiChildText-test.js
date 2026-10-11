/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 构造各类children和嵌套元素输入，JSX用它创建测试树。 */
const React = require('react');

/** 为每个初始/更新组合创建独立根，避免前一组合影响DOM状态。 */
const ReactDOMClient = require('react-dom/client');

/** 等待每轮root.render完成，确保文本与元素节点断言观察提交结果。 */
const act = require('internal-test-utils').act;

// 以输入/预期对构造全部首次挂载与更新组合。

/** testCases按[输入,预期,输入,预期]交替排列；外层选首次children，内层枚举更新children，各组合新建根并在两次act后调用expectChildren，覆盖所有方向的内容形状切换。 */
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

/** 预期字符串时检查父div的首Text或空值；预期列表时按mountIndex跳过空字符串并检查Text数据/元素DIV，不另验证元素内部或容器总节点数。 */
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
 * 检查单个文本、相邻文本、数组与元素混合时的 DOM 内容；单个直接文本可走宿主 textContent 路径。
 */
describe('ReactMultiChildText', () => {
  jest.setTimeout(30000);

  /** 输入表包含空值、数字、字符串、数组、嵌套数组、元素与相邻文本；对每个初始输入和每个后续输入执行笛卡尔组合的render/update，以对应文本或节点列表检查DOM，DEV仅两条缺key警告，验证直接文本与HostText/元素列表路径相互切换。 */
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

  /** 以直接10n和[10n]两种输入执行全部初始/更新组合；预期分别单文本10与列表Text10，验证bigint在宿主直接文本与数组子级间转换。 */
  it('should correctly handle bigint children for render and update', async () => {
    // prettier-ignore
    await testAllPermutations([
      10n, '10',
      [10n], ['10']
    ]);
  });

  /** 同一div既传dangerouslySetInnerHTML的abcdef又传children=ghjkl；act应拒绝抛错，验证两种内容来源互斥。 */
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

  /** 分别在新根渲染h1下双span、直接A、单项文本数组及A/B数组；各act应正常完成，验证这些嵌套/内联文本形状均可构建；本例未在同一根更新也未比较节点身份。 */
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
