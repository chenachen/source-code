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

  /** 同级树中一个组件在 useMemo 后抛错并由类边界接住，另一个组件持有 useState；首次恢复后再次渲染 App 应 resolve 且不抛错，验证错误退出会清理当前 Hook 上下文，不污染后续兄弟或重试的 Hook 顺序。 */
  it('should preserve hook order if errors are caught', async () => {
    /** 先建立 useMemo Hook 再抛 expected，迫使渲染从已使用 Hook 的组件中断并交给上层错误边界。 */
    function ErrorThrower() {
      React.useMemo(() => undefined, []);
      throw new Error('expected');
    }

    /** 建立独立 useState Hook 后输出兄弟文本，检测错误组件是否污染后续函数组件的 Hook 上下文。 */
    function StatefulComponent() {
      React.useState(null);
      return ' | stateful';
    }

    /** 捕获子树错误并用本地状态切换到错误文本，为 Hook 错误退出提供可提交的恢复路径。 */
    class ErrorHandler extends React.Component {
      /** error 初始为 null 时透传 children；捕获后保存 Error 并切换到恢复内容。 */
      state = {error: null};

      /** 把捕获的 Error 写入边界 state，触发显示错误消息的恢复更新。 */
      componentDidCatch(error) {
        return this.setState({error});
      }

      /** 未捕获错误时渲染原子树，捕获后显示 Error.message，阻止故障子组件再次执行。 */
      render() {
        if (this.state.error !== null) {
          return <p>Handled error: {this.state.error.message}</p>;
        }
        return this.props.children;
      }
    }

    /** 把故障子树的类边界与独立有状态函数组件放在同级 Fragment 中，暴露错误退出与兄弟 Hook 隔离。 */
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
