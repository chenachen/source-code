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

/** 在 require React/DOM renderer 前写入三个 profiling flags（timer、commit hooks、nested phase）；默认全开，不自行 resetModules，由用例 setup 隔离加载缓存。 */
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
  // 每例创建空容器；内层循环另重置模块并在 require renderer 前切换 timer，隔离两组 profiling 配置。
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

        // 只有 DEV 且 profiler timer 开启时检查缺少 id 的诊断；此用例没有期待抛错。
        if (__DEV__ && enableProfilerTimer) {
          /** 外层循环在 timer 开/关两配置加载模块，但本例只在 DEV 且 timer 开时定义；挂空 Profiler 且无 id，要求 id 必须字符串的诊断，验证配置门控下的参数提醒。 */
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

        /** 在 timer=true/false 两配置各挂空 Profiler，再包在 div 中更新；两次比较容器快照，验证 Profiler 透明结构及无 children 边界，没有计时参数断言。 */
        it('should support an empty Profiler (with no children)', async () => {
          const root = ReactDOMClient.createRoot(container);
          // 空 Profiler 不生成宿主节点；快照检查容器为空。
          await act(() => {
            root.render(<React.Profiler id="label" onRender={jest.fn()} />);
          });
          expect(container.innerHTML).toMatchSnapshot();

          // 放入 div 后，快照应只包含外层 div；这里没有断言 onRender 的计时参数。
          await act(() => {
            root.render(
              <div>
                <React.Profiler id="label" onRender={jest.fn()} />
              </div>,
            );
          });
          expect(container.innerHTML).toMatchSnapshot();
        });

        /** 在 timer=true/false 两配置各挂外部 span 与 Profiler 内 span/函数文本，比较 DOM 快照，验证启停计时不改变宿主 children 结构。 */
        it('should render children', async () => {
          /** 返回 label span 的函数叶，供 timer 开/关配置下宿主结构快照。 */
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

        /** 在 timer=true/false 两配置各挂外层函数和内层 class/span 的嵌套 Profiler，比较 DOM 快照，验证多层透明结构而非回调耗时。 */
        it('should support nested Profilers', async () => {
          /** 返回 label div 的函数叶，供嵌套 Profiler 的外层结构快照。 */
          const FunctionComponent = ({label}) => <div>{label}</div>;
          /** 嵌套 Profiler 的 class 叶，将 label 输出成 span，与外层函数叶对照。 */
          class ClassComponent extends React.Component {
            /** 返回 props.label 的 span，供内层 Profiler children 快照。 */
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
