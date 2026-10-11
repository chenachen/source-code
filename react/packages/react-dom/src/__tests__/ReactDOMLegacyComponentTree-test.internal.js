/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMComponentTree', () => {
  let React;
  let ReactDOM;
  let container;
  let assertConsoleErrorDev;

  beforeEach(() => {
    React = require('react');
    ReactDOM = require('react-dom');
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  // @gate !disableLegacyMode

  /** legacy render 返回的是已渲染的宿主 div，把该 div 错当容器传给 unmountComponentAtNode；DEV 应指出它不是顶层容器，验证 DOM→Fiber 缓存可以识别传错的 React 根节点。 */
  it('finds instance of node that is attempted to be unmounted', () => {
    const component = <div />;
    const node = ReactDOM.render(<div>{component}</div>, container);
    ReactDOM.unmountComponentAtNode(node);
    assertConsoleErrorDev([
      "unmountComponentAtNode(): The node you're attempting to unmount " +
        'was rendered by React and is not a top-level container. You may ' +
        'have accidentally passed in a React root node instead of its ' +
        'container.',
    ]);
  });

  // @gate !disableLegacyMode

  /** 先在外容器渲染带 span 的 div，再把返回 div 当新根容器渲染另一棵树；DEV 应警告正在替换 React 管理的 children，验证节点实例缓存能区分已有树内部节点和独立容器。 */
  it('finds instance from node to stop rendering over other react rendered components', () => {
    const component = (
      <div>
        <span>Hello</span>
      </div>
    );
    const anotherComponent = <div />;
    const instance = ReactDOM.render(component, container);
    ReactDOM.render(anotherComponent, instance);
    assertConsoleErrorDev([
      'Replacing React-rendered children with a new root ' +
        'component. If you intended to update the children of this node, ' +
        'you should instead have the existing children update their state ' +
        'and render the new components instead of calling ReactDOM.render.',
    ]);
  });
});
