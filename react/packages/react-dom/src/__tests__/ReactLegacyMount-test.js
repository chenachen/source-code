/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `{COMMENT_NODE}`：保存当前测试场景复用的夹具、状态或回调。 */
const {COMMENT_NODE} = require('react-dom-bindings/src/client/HTMLNodeType');

let React;
let ReactDOM;
let ReactDOMClient;
let waitForAll;
let assertConsoleErrorDev;

describe('ReactMount', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  describe('unmountComponentAtNode', () => {
    // @gate !disableLegacyMode
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「throws when given a non-node」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
     */
    it('throws when given a non-node', () => {
      const nodeArray = document.getElementsByTagName('div');
      expect(() => {
        ReactDOM.unmountComponentAtNode(nodeArray);
      }).toThrowError('Target container is not a DOM element.');
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「returns false on non-React containers」描述的渲染、交互或错误处理结果。 */
    it('returns false on non-React containers', () => {
      const d = document.createElement('div');
      d.innerHTML = '<b>hellooo</b>';
      expect(ReactDOM.unmountComponentAtNode(d)).toBe(false);
      expect(d.textContent).toBe('hellooo');
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「returns true on React containers」描述的渲染、交互或错误处理结果。 */
    it('returns true on React containers', () => {
      const d = document.createElement('div');
      ReactDOM.render(<b>hellooo</b>, d);
      expect(d.textContent).toBe('hellooo');
      expect(ReactDOM.unmountComponentAtNode(d)).toBe(true);
      expect(d.textContent).toBe('');
    });
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「warns when given a factory」描述的渲染、交互或错误处理结果。 */
  it('warns when given a factory', () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(Component, container);
    assertConsoleErrorDev([
      'Functions are not valid as a React child. ' +
        'This may happen if you return Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.\n' +
        '  root.render(Component)',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render different components in same root」描述的渲染、交互或错误处理结果。 */
  it('should render different components in same root', () => {
    const container = document.createElement('container');
    document.body.appendChild(container);

    ReactDOM.render(<div />, container);
    expect(container.firstChild.nodeName).toBe('DIV');

    ReactDOM.render(<span />, container);
    expect(container.firstChild.nodeName).toBe('SPAN');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should unmount and remount if the key changes」描述的渲染、交互或错误处理结果。 */
  it('should unmount and remount if the key changes', () => {
    const container = document.createElement('container');

    const mockMount = jest.fn();
    const mockUnmount = jest.fn();

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidMount`：记录测试夹具在当前场景中的状态。 */
      componentDidMount = mockMount;
      /** `Component.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
      componentWillUnmount = mockUnmount;
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span>{this.props.text}</span>;
      }
    }

    expect(mockMount).toHaveBeenCalledTimes(0);
    expect(mockUnmount).toHaveBeenCalledTimes(0);

    ReactDOM.render(<Component text="orange" key="A" />, container);
    expect(container.firstChild.innerHTML).toBe('orange');
    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(mockUnmount).toHaveBeenCalledTimes(0);

    // 改变 key 会使组件先卸载再重新挂载。
    ReactDOM.render(<Component text="green" key="B" />, container);
    expect(container.firstChild.innerHTML).toBe('green');
    expect(mockMount).toHaveBeenCalledTimes(2);
    expect(mockUnmount).toHaveBeenCalledTimes(1);

    // 但是如果我们不改变键,组件实例会重复使用
    ReactDOM.render(<Component text="blue" key="B" />, container);
    expect(container.firstChild.innerHTML).toBe('blue');
    expect(mockMount).toHaveBeenCalledTimes(2);
    expect(mockUnmount).toHaveBeenCalledTimes(1);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should reuse markup if rendering to the same target twice」描述的渲染、交互或错误处理结果。 */
  it('should reuse markup if rendering to the same target twice', () => {
    const container = document.createElement('container');
    const instance1 = ReactDOM.render(<div />, container);
    const instance2 = ReactDOM.render(<div />, container);

    expect(instance1 === instance2).toBe(true);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not warn if mounting into non-empty node」描述的渲染、交互或错误处理结果。 */
  it('should not warn if mounting into non-empty node', () => {
    const container = document.createElement('container');
    container.innerHTML = '<div></div>';

    ReactDOM.render(<div />, container);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn when mounting into document.body」描述的渲染、交互或错误处理结果。 */
  it('should warn when mounting into document.body', () => {
    const iFrame = document.createElement('iframe');
    document.body.appendChild(iFrame);

    // HostSingletons 使针对 document.body 的警告不再必要。
    ReactDOM.render(<div />, iFrame.contentDocument.body);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn if render removes React-rendered children」描述的渲染、交互或错误处理结果。 */
  it('should warn if render removes React-rendered children', () => {
    const container = document.createElement('container');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <div />
          </div>
        );
      }
    }

    ReactDOM.render(<Component />, container);

    // 验证直接清空子节点会产生警告。
    const rootNode = container.firstChild;

    ReactDOM.render(<span />, rootNode);
    assertConsoleErrorDev([
      'Replacing React-rendered children with a new ' +
        'root component. If you intended to update the children of this node, ' +
        'you should instead have the existing children update their state and ' +
        'render the new components instead of calling ReactDOM.render.',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn if the unmounted node was rendered by another copy of React」描述的渲染、交互或错误处理结果。 */
  it('should warn if the unmounted node was rendered by another copy of React', () => {
    jest.resetModules();
    const ReactDOMOther = require('react-dom');
    const container = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <div />
          </div>
        );
      }
    }

    ReactDOM.render(<Component />, container);
    // 确保 ReactDOM 和 ReactDOMOther 是不同的副本。
    expect(ReactDOM).not.toEqual(ReactDOMOther);

    ReactDOMOther.unmountComponentAtNode(container);
    assertConsoleErrorDev([
      "unmountComponentAtNode(): The node you're attempting to unmount " +
        'was rendered by another copy of React.',
    ]);

    // 不要抛出警告，如果正确的 React 复制卸载了节点。
    ReactDOM.unmountComponentAtNode(container);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「passes the correct callback context」描述的渲染、交互或错误处理结果。 */
  it('passes the correct callback context', () => {
    const container = document.createElement('div');
    let calls = 0;

    ReactDOM.render(<div />, container, function () {
      expect(this.nodeName).toBe('DIV');
      calls++;
    });

    // 更新，类型未改变
    ReactDOM.render(<div />, container, function () {
      expect(this.nodeName).toBe('DIV');
      calls++;
    });

    // 更新和类型变化
    ReactDOM.render(<span />, container, function () {
      expect(this.nodeName).toBe('SPAN');
      calls++;
    });

    // 批量更新，无类型改变
    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.render(<span />, container, function () {
        expect(this.nodeName).toBe('SPAN');
        calls++;
      });
    });

    // 批量更新，类型改变
    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.render(<article />, container, function () {
        expect(this.nodeName).toBe('ARTICLE');
        calls++;
      });
    });

    expect(calls).toBe(5);
  });

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「initial mount of legacy root is sync inside batchedUpdates, as if it were wrapped in flushSync」描述的渲染、交互或错误处理结果。 */
  it('initial mount of legacy root is sync inside batchedUpdates, as if it were wrapped in flushSync', () => {
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');

    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.state`：记录测试夹具在当前场景中的状态。 */
      state = {active: false};
      /** `Foo.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({active: true});
      }
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>{this.props.children + (this.state.active ? '!' : '')}</div>
        );
      }
    }

    ReactDOM.render(<div>1</div>, container1);

    ReactDOM.unstable_batchedUpdates(() => {
    // 安排更新；此时尚未冲刷。
      ReactDOM.render(<div>2</div>, container1);
      expect(container1.textContent).toEqual('1');

      // 初始挂载到另一个根节点。 应立即冲刷。
      ReactDOM.render(<Foo>a</Foo>, container2);
      // 之前的更新也出现了, 由于 `flushSync` 会将所有同步工作都同步地发送到所有根上，因此它会清除所
      // 有同步工作。
      expect(container1.textContent).toEqual('2');
      // 布局更新也会同步冲刷
      expect(container2.textContent).toEqual('a!');
    });
    expect(container1.textContent).toEqual('2');
    expect(container2.textContent).toEqual('a!');
  });

  describe('mount point is a comment node', () => {
    let containerDiv;
    let mountPoint;

    beforeEach(() => {
      containerDiv = document.createElement('div');
      containerDiv.innerHTML = 'A<!-- react-mount-point-unstable -->B';
      mountPoint = containerDiv.childNodes[1];
      expect(mountPoint.nodeType).toBe(COMMENT_NODE);
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「renders at a comment node」描述的渲染、交互或错误处理结果。 */
    it('renders at a comment node', () => {
      /** `Char`：封装当前用例复用的操作、回调或断言步骤。 */
      function Char(props) {
        return props.children;
      }
      /** `list`：封装当前用例复用的操作、回调或断言步骤。 */
      function list(chars) {
        return chars.split('').map(c => <Char key={c}>{c}</Char>);
      }

      ReactDOM.render(list('aeiou'), mountPoint);
      expect(containerDiv.innerHTML).toBe(
        'Aaeiou<!-- react-mount-point-unstable -->B',
      );

      ReactDOM.render(list('yea'), mountPoint);
      expect(containerDiv.innerHTML).toBe(
        'Ayea<!-- react-mount-point-unstable -->B',
      );

      ReactDOM.render(list(''), mountPoint);
      expect(containerDiv.innerHTML).toBe(
        'A<!-- react-mount-point-unstable -->B',
      );
    });
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「clears existing children with legacy API」描述的渲染、交互或错误处理结果。 */
  it('clears existing children with legacy API', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<div>a</div><div>b</div>';
    ReactDOM.render(
      <div>
        <span>c</span>
        <span>d</span>
      </div>,
      container,
    );
    expect(container.textContent).toEqual('cd');
    ReactDOM.render(
      <div>
        <span>d</span>
        <span>c</span>
      </div>,
      container,
    );
    await waitForAll([]);
    expect(container.textContent).toEqual('dc');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「warns when rendering with legacy API into createRoot() container」描述的渲染、交互或错误处理结果。 */
  it('warns when rendering with legacy API into createRoot() container', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    ReactDOM.render(<div>Bye</div>, container);
    assertConsoleErrorDev([
      // 我们关心这个警告：
      'You are calling ReactDOM.render() on a container that was previously ' +
        'passed to ReactDOMClient.createRoot(). This is not supported. ' +
        'Did you mean to call root.render(element)?',
      // 这更多是症状，但重构代码以避免它并不是值得的：
      'Replacing React-rendered children with a new root component. ' +
        'If you intended to update the children of this node, ' +
        'you should instead have the existing children update their state ' +
        'and render the new components instead of calling ReactDOM.render.',
    ]);
    await waitForAll([]);
    // 这已经有效了,但我们可以禁止它.
    expect(container.textContent).toEqual('Bye');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「warns when unmounting with legacy API (no previous content)」描述的渲染、交互或错误处理结果。 */
  it('warns when unmounting with legacy API (no previous content)', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    const unmounted = ReactDOM.unmountComponentAtNode(container);
    assertConsoleErrorDev([
      // 我们关心这个警告：
      'You are calling ReactDOM.unmountComponentAtNode() on a container that was previously ' +
        'passed to ReactDOMClient.createRoot(). This is not supported. Did you mean to call root.unmount()?',
      // 这更多是症状，但重构代码以避免它并不是值得的：
      'unmountComponentAtNode(): ' +
        "The node you're attempting to unmount was rendered by React and is not a top-level container. " +
        'Instead, have the parent component update its state and rerender in order to remove this component.',
    ]);
    expect(unmounted).toBe(false);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    root.unmount();
    await waitForAll([]);
    expect(container.textContent).toEqual('');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「warns when unmounting with legacy API (has previous content)」描述的渲染、交互或错误处理结果。 */
  it('warns when unmounting with legacy API (has previous content)', async () => {
    const container = document.createElement('div');
    // 目前createRoot()render()没有清除此.
    container.appendChild(document.createElement('div'));
    // 其余部分与上述测试相同。
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    const unmounted = ReactDOM.unmountComponentAtNode(container);
    assertConsoleErrorDev([
      'You are calling ReactDOM.unmountComponentAtNode() on a container ' +
        'that was previously passed to ReactDOMClient.createRoot(). ' +
        'This is not supported. Did you mean to call root.unmount()?',
      // 这更多是症状，但重构代码以避免它并不是值得的：
      'unmountComponentAtNode(): ' +
        "The node you're attempting to unmount was rendered by React and is not a top-level container. " +
        'Instead, have the parent component update its state and rerender in order to remove this component.',
    ]);
    expect(unmounted).toBe(false);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    root.unmount();
    await waitForAll([]);
    expect(container.textContent).toEqual('');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「warns when passing legacy container to createRoot()」描述的渲染、交互或错误处理结果。 */
  it('warns when passing legacy container to createRoot()', () => {
    const container = document.createElement('div');
    ReactDOM.render(<div>Hi</div>, container);
    ReactDOMClient.createRoot(container);
    assertConsoleErrorDev([
      'You are calling ReactDOMClient.createRoot() on a container that was previously ' +
        'passed to ReactDOM.render(). This is not supported.',
    ]);
  });
});
