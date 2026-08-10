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
let ReactDOM;
let ReactDOMClient;
let act;

describe('EnterLeaveEventPlugin', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    // 容器必须挂载才能触发事件。
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should set onMouseLeave relatedTarget properly in iframe」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should set onMouseLeave relatedTarget properly in iframe', async () => {
    const iframe = document.createElement('iframe');
    container.appendChild(iframe);
    const iframeDocument = iframe.contentDocument;
    iframeDocument.write(
      '<!DOCTYPE html><html><head></head><body><div></div></body></html>',
    );
    iframeDocument.close();

    const leaveEvents = [];
    const root = ReactDOMClient.createRoot(
      iframeDocument.body.getElementsByTagName('div')[0],
    );
    await act(() => {
      root.render(
        <div
          onMouseLeave={e => {
            e.persist();
            leaveEvents.push(e);
          }}
        />,
      );
    });
    const node = iframeDocument.body.getElementsByTagName('div')[0].firstChild;
    await act(() => {
      node.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: iframe.contentWindow,
        }),
      );
    });

    expect(leaveEvents.length).toBe(1);
    expect(leaveEvents[0].target).toBe(node);
    expect(leaveEvents[0].relatedTarget).toBe(iframe.contentWindow);
  });

  /** 测试场景：验证「should set onMouseEnter relatedTarget properly in iframe」描述的渲染、交互或错误处理结果。 */
  it('should set onMouseEnter relatedTarget properly in iframe', async () => {
    const iframe = document.createElement('iframe');
    container.appendChild(iframe);
    const iframeDocument = iframe.contentDocument;
    iframeDocument.write(
      '<!DOCTYPE html><html><head></head><body><div></div></body></html>',
    );
    iframeDocument.close();

    const enterEvents = [];
    const root = ReactDOMClient.createRoot(
      iframeDocument.body.getElementsByTagName('div')[0],
    );
    await act(() => {
      root.render(
        <div
          onMouseEnter={e => {
            e.persist();
            enterEvents.push(e);
          }}
        />,
      );
    });
    const node = iframeDocument.body.getElementsByTagName('div')[0].firstChild;
    await act(() => {
      node.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: null,
        }),
      );
    });

    expect(enterEvents.length).toBe(1);
    expect(enterEvents[0].target).toBe(node);
    expect(enterEvents[0].relatedTarget).toBe(iframe.contentWindow);
  });

  // 针对 https://github.com/facebook/react/issues/10906 的回归测试。
  /** 测试场景：验证「should find the common parent after updates」描述的渲染、交互或错误处理结果。 */
  it('should find the common parent after updates', async () => {
    let parentEnterCalls = 0;
    let childEnterCalls = 0;
    let parent = null;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div
            onMouseEnter={() => parentEnterCalls++}
            ref={node => (parent = node)}>
            {this.props.showChild && (
              <div onMouseEnter={() => childEnterCalls++} />
            )}
          </div>
        );
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      root.render(<Parent showChild={true} />);
    });

    // 从父组件进入子组件。
    await act(() => {
      parent.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: parent.firstChild,
        }),
      );
    });

    // 进入子组件时，应该在子组件上触发事件，而不是在父组件上。
    expect(childEnterCalls).toBe(1);
    expect(parentEnterCalls).toBe(0);
  });

  // https://github.com/facebook/react/issues/16763. 测试
  // @gate !disableLegacyMode
  /** 测试场景：验证「should call mouseEnter once from sibling rendered inside a rendered component in legacy roots」描述的渲染、交互或错误处理结果。 */
  it('should call mouseEnter once from sibling rendered inside a rendered component in legacy roots', async () => {
    const mockFn = jest.fn();

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.parentEl = React.createRef();
      }

      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ReactDOM.render(<MouseEnterDetect />, this.parentEl.current);
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div ref={this.parentEl} />;
      }
    }

    /** `MouseEnterDetect`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MouseEnterDetect extends React.Component {
      /** `MouseEnterDetect.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.firstEl = React.createRef();
        this.siblingEl = React.createRef();
      }

      /** `MouseEnterDetect.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.siblingEl.current.dispatchEvent(
          new MouseEvent('mouseout', {
            bubbles: true,
            cancelable: true,
            relatedTarget: this.firstEl.current,
          }),
        );
      }

      /** `MouseEnterDetect.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <React.Fragment>
            <div ref={this.firstEl} onMouseEnter={mockFn} />
            <div ref={this.siblingEl} />
          </React.Fragment>
        );
      }
    }

    await act(() => {
      ReactDOM.render(<Parent />, container);
    });
    expect(mockFn.mock.calls.length).toBe(1);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should call mouseEnter when pressing a non tracked React node in legacy root」描述的渲染、交互或错误处理结果。 */
  it('should call mouseEnter when pressing a non tracked React node in legacy root', async () => {
    const mockFn = jest.fn();

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.parentEl = React.createRef();
      }

      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ReactDOM.render(<MouseEnterDetect />, this.parentEl.current);
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div ref={this.parentEl} />;
      }
    }

    /** `MouseEnterDetect`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MouseEnterDetect extends React.Component {
      /** `MouseEnterDetect.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.divRef = React.createRef();
        this.siblingEl = React.createRef();
      }

      /** `MouseEnterDetect.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        const attachedNode = document.createElement('div');
        this.divRef.current.appendChild(attachedNode);
        attachedNode.dispatchEvent(
          new MouseEvent('mouseout', {
            bubbles: true,
            cancelable: true,
            relatedTarget: this.siblingEl.current,
          }),
        );
      }

      /** `MouseEnterDetect.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div ref={this.divRef}>
            <div ref={this.siblingEl} onMouseEnter={mockFn} />
          </div>
        );
      }
    }

    await act(() => {
      ReactDOM.render(<Parent />, container);
    });
    expect(mockFn.mock.calls.length).toBe(1);
  });

  /** 测试场景：验证「should work with portals outside of the root that has onMouseLeave」描述的渲染、交互或错误处理结果。 */
  it('should work with portals outside of the root that has onMouseLeave', async () => {
    const divRef = React.createRef();
    const onMouseLeave = jest.fn();

    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      return (
        <div onMouseLeave={onMouseLeave}>
          {ReactDOM.createPortal(<div ref={divRef} />, document.body)}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component />);
    });

    // 从 Portal 的 div 离开。
    await act(() => {
      divRef.current.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should work with portals that have onMouseEnter outside of the root」描述的渲染、交互或错误处理结果。 */
  it('should work with portals that have onMouseEnter outside of the root', async () => {
    const divRef = React.createRef();
    const otherDivRef = React.createRef();
    const onMouseEnter = jest.fn();

    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      return (
        <div ref={divRef}>
          {ReactDOM.createPortal(
            <div ref={otherDivRef} onMouseEnter={onMouseEnter} />,
            document.body,
          )}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component />);
    });

    // 从 Portal 的 div 离开。
    divRef.current.dispatchEvent(
      new MouseEvent('mouseout', {
        bubbles: true,
        cancelable: true,
        relatedTarget: otherDivRef.current,
      }),
    );

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });
});
