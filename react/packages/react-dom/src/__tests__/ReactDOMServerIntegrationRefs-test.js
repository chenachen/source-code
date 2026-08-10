/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{resetModules, clientRenderOnServerString, expectMarkupMatch}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, clientRenderOnServerString, expectMarkupMatch} =
  ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('refs', function () {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should not run ref code on server」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it('should not run ref code on server', async () => {
      let refCount = 0;
      /** `RefsComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class RefsComponent extends React.Component {
        /** `RefsComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div ref={e => refCount++} />;
        }
      }
      await expectMarkupMatch(<RefsComponent />, <div />);
      expect(refCount).toBe(0);
    });

    /** 测试场景：验证「should run ref code on client」描述的渲染、交互或错误处理结果。 */
    it('should run ref code on client', async () => {
      let refCount = 0;
      /** `RefsComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class RefsComponent extends React.Component {
        /** `RefsComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div ref={e => refCount++} />;
        }
      }
      await expectMarkupMatch(<div />, <RefsComponent />);
      expect(refCount).toBe(1);
    });

    /** 测试场景：验证「should send the correct element to ref functions on client」描述的渲染、交互或错误处理结果。 */
    it('should send the correct element to ref functions on client', async () => {
      let refElement = null;
      /** `RefsComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class RefsComponent extends React.Component {
        /** `RefsComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div ref={e => (refElement = e)} />;
        }
      }
      const e = await clientRenderOnServerString(<RefsComponent />);
      expect(refElement).not.toBe(null);
      expect(refElement).toBe(e);
    });
  });

  /** 测试场景：验证「should forward refs」描述的渲染、交互或错误处理结果。 */
  it('should forward refs', async () => {
    const divRef = React.createRef();

    /** `InnerComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class InnerComponent extends React.Component {
      /** `InnerComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div ref={this.props.forwardedRef}>{this.props.value}</div>;
      }
    }

    const OuterComponent = React.forwardRef((props, ref) => (
      <InnerComponent {...props} forwardedRef={ref} />
    ));

    await clientRenderOnServerString(
      <OuterComponent ref={divRef} value="hello" />,
    );

    expect(divRef.current).not.toBe(null);
    expect(divRef.current.textContent).toBe('hello');
  });
});
