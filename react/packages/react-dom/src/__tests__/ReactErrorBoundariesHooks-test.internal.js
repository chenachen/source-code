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
let ReactDOMClient;
let act;

describe('ReactErrorBoundariesHooks', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should preserve hook order if errors are caught」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should preserve hook order if errors are caught', async () => {
    /** `ErrorThrower`：封装当前用例复用的操作、回调或断言步骤。 */
    function ErrorThrower() {
      React.useMemo(() => undefined, []);
      throw new Error('expected');
    }

    /** `StatefulComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    function StatefulComponent() {
      React.useState(null);
      return ' | stateful';
    }

    /** `ErrorHandler`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorHandler extends React.Component {
      /** `ErrorHandler.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};

      /** `ErrorHandler.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        return this.setState({error});
      }

      /** `ErrorHandler.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error !== null) {
          return <p>Handled error: {this.state.error.message}</p>;
        }
        return this.props.children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App(props) {
      return (
        <React.Fragment>
          <ErrorHandler>
            <ErrorThrower />
          </ErrorHandler>
          <StatefulComponent />
        </React.Fragment>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    await expect(
      act(() => {
        root.render(<App />);
      }),
    ).resolves.not.toThrow();
  });
});
