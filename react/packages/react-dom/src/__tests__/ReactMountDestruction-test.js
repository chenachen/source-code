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
/** `ReactDOM`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOM = require('react-dom');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');
/** `act`：保存当前测试场景复用的夹具、状态或回调。 */
const act = require('internal-test-utils').act;
/** `assertConsoleErrorDev`：保存当前测试场景复用的夹具、状态或回调。 */
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

describe('ReactMount', () => {
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should destroy a react root upon request」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should destroy a react root upon request', async () => {
    const mainContainerDiv = document.createElement('div');
    document.body.appendChild(mainContainerDiv);

    const instanceOne = <div className="firstReactDiv" />;
    const firstRootDiv = document.createElement('div');
    mainContainerDiv.appendChild(firstRootDiv);
    const firstRoot = ReactDOMClient.createRoot(firstRootDiv);
    await act(() => {
      firstRoot.render(instanceOne);
    });

    const instanceTwo = <div className="secondReactDiv" />;
    const secondRootDiv = document.createElement('div');
    mainContainerDiv.appendChild(secondRootDiv);
    const secondRoot = ReactDOMClient.createRoot(secondRootDiv);
    await act(() => {
      secondRoot.render(instanceTwo);
    });

    // 测试两个 React 根在隔离中渲染
    expect(firstRootDiv.firstChild.className).toBe('firstReactDiv');
    expect(secondRootDiv.firstChild.className).toBe('secondReactDiv');

    // 测试在卸载每个组件后，它们不再存在于文档中。
    await act(() => {
      firstRoot.unmount();
    });
    expect(firstRootDiv.firstChild).toBeNull();
    await act(() => {
      secondRoot.unmount();
    });
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn when unmounting a non-container root node」描述的渲染、交互或错误处理结果。 */
  it('should warn when unmounting a non-container root node', () => {
    const mainContainerDiv = document.createElement('div');

    const component = (
      <div>
        <div />
      </div>
    );
    // 无法迁移到创建Root,直到我们删除unmountComponentAtNode i.e. 取消这个测试.
    ReactDOM.render(component, mainContainerDiv);

    // 测试在根节点卸载时提供有用的警告
    const rootDiv = mainContainerDiv.firstChild;
    ReactDOM.unmountComponentAtNode(rootDiv);
    assertConsoleErrorDev([
      "unmountComponentAtNode(): The node you're attempting to " +
        'unmount was rendered by React and is not a top-level container. You ' +
        'may have accidentally passed in a React root node instead of its ' +
        'container.',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn when unmounting a non-container, non-root node」描述的渲染、交互或错误处理结果。 */
  it('should warn when unmounting a non-container, non-root node', () => {
    const mainContainerDiv = document.createElement('div');

    const component = (
      <div>
        <div>
          <div />
        </div>
      </div>
    );
    // 无法迁移到创建Root,直到我们删除unmountComponentAtNode i.e. 取消这个测试.
    ReactDOM.render(component, mainContainerDiv);

    // 测试在非根节点卸载时显示不同的警告
    const nonRootDiv = mainContainerDiv.firstChild.firstChild;
    ReactDOM.unmountComponentAtNode(nonRootDiv);
    assertConsoleErrorDev([
      "unmountComponentAtNode(): The node you're attempting to " +
        'unmount was rendered by React and is not a top-level container. ' +
        'Instead, have the parent component update its state and rerender in ' +
        'order to remove this component.',
    ]);
  });
});
