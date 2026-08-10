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
let ReactFeatureFlags;
let act;
let container;
let assertConsoleErrorDev;

/** 按当前特性开关重新加载 React、测试 renderer 与调度器，隔离模块状态。 */
function loadModules({
  enableProfilerTimer = true,
  enableProfilerCommitHooks = true,
  enableProfilerNestedUpdatePhase = true,
} = {}) {
  ReactFeatureFlags = require('shared/ReactFeatureFlags');

  ReactFeatureFlags.enableProfilerTimer = enableProfilerTimer;
  ReactFeatureFlags.enableProfilerCommitHooks = enableProfilerCommitHooks;
  ReactFeatureFlags.enableProfilerNestedUpdatePhase =
    enableProfilerNestedUpdatePhase;

  React = require('react');
  ReactDOMClient = require('react-dom/client');
  const InternalTestUtils = require('internal-test-utils');
  act = InternalTestUtils.act;
  assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
}

describe('Profiler', () => {
  beforeEach(() => {
    container = document.createElement('div');
  });

  describe('works in profiling and non-profiling bundles', () => {
    [true, false].forEach(enableProfilerTimer => {
      describe(`enableProfilerTimer:${
        enableProfilerTimer ? 'enabled' : 'disabled'
      }`, () => {
        beforeEach(() => {
          jest.resetModules();

          loadModules({enableProfilerTimer});
        });

      // 生产构建同样会抛错，但此用例只验证 DEV 的诊断信息。
        if (__DEV__ && enableProfilerTimer) {
          /**
           * Given：已建立该文件所需的 renderer、容器与测试夹具。
           * When：执行“should warn if required params are missing”场景的唯一关键操作。
           * Then：断言 Profiler 组件的公开校验与嵌套行为 的可观察结果。
           *
           * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
           */
          it('should warn if required params are missing', async () => {
            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<React.Profiler />);
            });
            assertConsoleErrorDev([
              'Profiler must specify an "id" of type `string` as a prop. Received the type `undefined` instead.',
            ]);
          });
        }

        /**
         * 场景：“should support an empty Profiler (with no children)”。
         * 机制：验证Profiler 组件的公开校验与嵌套行为，锁定可观察结果与失败边界。
         */
        it('should support an empty Profiler (with no children)', async () => {
          const root = ReactDOMClient.createRoot(container);
    // 作为根节点挂载时，Profiler 仍必须正常报告提交。
          await act(() => {
            root.render(<React.Profiler id="label" onRender={jest.fn()} />);
          });
          expect(container.innerHTML).toMatchSnapshot();

    // 作为非根后代挂载时，Profiler 使用相同的测量契约。
          await act(() => {
            root.render(
              <div>
                <React.Profiler id="label" onRender={jest.fn()} />
              </div>,
            );
          });
          expect(container.innerHTML).toMatchSnapshot();
        });

        /**
         * 场景：“should render children”。
         * 机制：验证Profiler 组件的公开校验与嵌套行为，锁定可观察结果与失败边界。
         */
        it('should render children', async () => {
          /** 作为“should render children”场景的函数夹具，返回待协调内容或触发目标行为。 */
          const FunctionComponent = ({label}) => <span>{label}</span>;
          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(
              <div>
                <span>outside span</span>
                <React.Profiler id="label" onRender={jest.fn()}>
                  <span>inside span</span>
                  <FunctionComponent label="function component" />
                </React.Profiler>
              </div>,
            );
          });
          expect(container.innerHTML).toMatchSnapshot();
        });

        /**
         * 场景：“should support nested Profilers”。
         * 机制：验证Profiler 组件的公开校验与嵌套行为，锁定可观察结果与失败边界。
         */
        it('should support nested Profilers', async () => {
          /** 作为“should support nested Profilers”场景的函数夹具，返回待协调内容或触发目标行为。 */
          const FunctionComponent = ({label}) => <div>{label}</div>;
          /** 作为“should support nested Profilers”场景的组件夹具，隔离待验证的 React 行为。 */
          class ClassComponent extends React.Component {
            /** 渲染“should support nested Profilers”场景所需的元素树，使断言能够观察协调与提交结果。 */
            render() {
              return <span>{this.props.label}</span>;
            }
          }
          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(
              <React.Profiler id="outer" onRender={jest.fn()}>
                <FunctionComponent label="outer function component" />
                <React.Profiler id="inner" onRender={jest.fn()}>
                  <ClassComponent label="inner class component" />
                  <span>inner span</span>
                </React.Profiler>
              </React.Profiler>,
            );
          });

          expect(container.innerHTML).toMatchSnapshot();
        });
      });
    });
  });
});
