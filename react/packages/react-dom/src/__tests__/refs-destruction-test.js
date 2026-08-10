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
let TestComponent;
let act;
let theInnerDivRef;
let theInnerClassComponentRef;

describe('refs-destruction', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    /** `ClassComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ClassComponent extends React.Component {
      /** `ClassComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    TestComponent = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        theInnerDivRef = React.createRef();
        theInnerClassComponentRef = React.createRef();
      }

      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.props.destroy) {
          return <div />;
        } else if (this.props.removeRef) {
          return (
            <div>
              <div />
              <ClassComponent />
            </div>
          );
        } else {
          return (
            <div>
              <div ref={theInnerDivRef} />
              <ClassComponent ref={theInnerClassComponentRef} />
            </div>
          );
        }
      }
    };
  });

  afterEach(() => {
    theInnerClassComponentRef = null;
    theInnerDivRef = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should remove refs when destroying the parent」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should remove refs when destroying the parent', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(theInnerDivRef.current).toBeInstanceOf(Element);
    expect(theInnerClassComponentRef.current).toBeTruthy();

    root.unmount();

    expect(theInnerDivRef.current).toBe(null);
    expect(theInnerClassComponentRef.current).toBe(null);
  });

  /** 测试场景：验证「should remove refs when destroying the child」描述的渲染、交互或错误处理结果。 */
  it('should remove refs when destroying the child', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(theInnerDivRef.current).toBeInstanceOf(Element);
    expect(theInnerClassComponentRef.current).toBeTruthy();

    await act(async () => {
      root.render(<TestComponent destroy={true} />);
    });

    expect(theInnerDivRef.current).toBe(null);
    expect(theInnerClassComponentRef.current).toBe(null);
  });

  /** 测试场景：验证「should remove refs when removing the child ref attribute」描述的渲染、交互或错误处理结果。 */
  it('should remove refs when removing the child ref attribute', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(theInnerDivRef.current).toBeInstanceOf(Element);
    expect(theInnerClassComponentRef.current).toBeTruthy();

    await act(async () => {
      root.render(<TestComponent removeRef={true} />);
    });

    expect(theInnerDivRef.current).toBe(null);
    expect(theInnerClassComponentRef.current).toBe(null);
  });

  /** 测试场景：验证「should not error when destroying child with ref asynchronously」描述的渲染、交互或错误处理结果。 */
  it('should not error when destroying child with ref asynchronously', async () => {
    let nestedRoot;
    /** `Modal`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Modal extends React.Component {
      /** `Modal.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.div = document.createElement('div');
        nestedRoot = ReactDOMClient.createRoot(this.div);
        document.body.appendChild(this.div);
        this.componentDidUpdate();
      }

      /** `Modal.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        setTimeout(() => {
          ReactDOM.flushSync(() => {
            nestedRoot.render(<div>{this.props.children}</div>);
          });
        }, 0);
      }

      /** `Modal.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        const self = this;
        // 一些异步动画
        setTimeout(function () {
          expect(function () {
            nestedRoot.unmount();
          }).not.toThrow();
          document.body.removeChild(self.div);
        }, 0);
      }

      /** `Modal.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    /** `AppModal`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class AppModal extends React.Component {
      /** `AppModal.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Modal>
            <a ref={React.createRef()} />
          </Modal>
        );
      }
    }

    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.hidden ? null : <AppModal onClose={this.close} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      root.render(<App hidden={true} />);
    });
  });
});
