/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 要求
let React;
let ReactDOMClient;
let act;

// 测试组件
let LowerLevelComposite;
let MyCompositeComponent;

/**
 * 用 JSX 组合函数组件与 DOM，检查插值文本和复合组件不会引入额外包装节点。
 */
describe('ReactCompositeComponentDOMMinimalism', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    /** 最内层类 fixture 仅创建一个 div，所有期望中的根元素都来自这一层。 */
    LowerLevelComposite = class extends React.Component {

      /** 在唯一显式 div 内原样放入 children，覆盖纯文本、字符串插值与 ul 子节点三种输入。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    };

    /** 外层类 fixture 只转交 children 给另一复合组件，测试其本身不创建 DOM 包装。 */
    MyCompositeComponent = class extends React.Component {

      /** 只渲染 LowerLevelComposite 并透传 children，让元素计数能识别复合组件额外包装。 */
      render() {
        return <LowerLevelComposite>{this.props.children}</LowerLevelComposite>;
      }
    };
  });

  /** 两层复合组件包裹直接字符串 children；提交后根仅有一个 DIV 且其元素 children 为 0，验证复合层级与纯文本都不添加包装元素。 */
  it('should not render extra nodes for non-interpolated text', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MyCompositeComponent>A string child</MyCompositeComponent>);
    });

    const instance = container.firstChild;
    expect(instance.tagName).toBe('DIV');
    expect(instance.children.length).toBe(0);
  });

  /** 两层复合组件包裹 JSX 字符串插值；提交后仍是一个 DIV 且无元素子节点，验证插值文本也不引入额外元素。 */
  it('should not render extra nodes for interpolated text', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <MyCompositeComponent>
          {'Interpolated String Child'}
        </MyCompositeComponent>,
      );
    });

    const instance = container.firstChild;
    expect(instance.tagName).toBe('DIV');
    expect(instance.children.length).toBe(0);
  });

  /** 两层复合组件包裹带文本的 ul；提交后 DIV 仅有一个 UL，UL 自身没有元素子节点，验证仅显式 JSX 元素影响元素树结构。 */
  it('should not render extra nodes for interpolated text children', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <MyCompositeComponent>
          <ul>This text causes no children in ul, just innerHTML</ul>
        </MyCompositeComponent>,
      );
    });

    const instance = container.firstChild;
    expect(instance.tagName).toBe('DIV');
    expect(instance.children.length).toBe(1);
    expect(instance.children[0].tagName).toBe('UL');
    expect(instance.children[0].children.length).toBe(0);
  });
});
