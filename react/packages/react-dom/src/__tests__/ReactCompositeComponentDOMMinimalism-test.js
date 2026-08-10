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
 * 集成测试，保留英文。 测试 JSX 与我们抽象单元的组合。 ``ReactCompositeComponent`
 * ` 从不添加多余的 `DOM` 节点。
 */
describe('ReactCompositeComponentDOMMinimalism', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    LowerLevelComposite = class extends React.Component {
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    };

    MyCompositeComponent = class extends React.Component {
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <LowerLevelComposite>{this.props.children}</LowerLevelComposite>;
      }
    };
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should not render extra nodes for non-interpolated text」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
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

  /** 测试场景：验证「should not render extra nodes for interpolated text」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not render extra nodes for interpolated text children」描述的渲染、交互或错误处理结果。 */
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
