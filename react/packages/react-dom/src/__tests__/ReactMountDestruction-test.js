/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 构造根销毁与传错容器诊断需要的宿主 JSX 树。 */
const React = require('react');
/** 提供 legacy render/unmountComponentAtNode，用于区分根容器、首层根节点和内部节点的 DEV 消息。 */
const ReactDOM = require('react-dom');
/** 提供两个独立并发根与 root.unmount，检查销毁仅清空所属容器。 */
const ReactDOMClient = require('react-dom/client');
/** 等待独立根挂载及卸载提交，随后检查容器中的宿主节点。 */
const act = require('internal-test-utils').act;
/** 匹配 legacy 卸载的专门 DEV 消息，生产构建不要求该诊断。 */
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

describe('ReactMount', () => {
  /** 在同一外层元素内建立两个独立并发根，分别提交不同 className；两根内容应独立，卸载第一根后其容器为空，再卸载第二根应完成，验证 root.unmount 清理所属树。 */
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
  /** legacy render 后把返回的首层宿主 div 当作 unmount 容器；DEV 应建议传真正根容器，验证根节点与容器混淆时的专门诊断。 */
  it('should warn when unmounting a non-container root node', () => {
    const mainContainerDiv = document.createElement('div');

    const component = (
      <div>
        <div />
      </div>
    );
    // 此用例专门测试 legacy unmountComponentAtNode 的容器诊断，因此保留 legacy render 入口。
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
  /** legacy render 三层 div 后把中间内部 div 当作 unmount 容器；DEV 应建议由父组件更新删除它，验证普通内部节点与首层根节点得到不同诊断。 */
  it('should warn when unmounting a non-container, non-root node', () => {
    const mainContainerDiv = document.createElement('div');

    const component = (
      <div>
        <div>
          <div />
        </div>
      </div>
    );
    // 此用例专门测试 legacy unmountComponentAtNode 的容器诊断，因此保留 legacy render 入口。
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
