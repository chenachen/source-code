/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactStartTransitionMultipleRenderers', () => {
  let act;
  let container;
  let React;
  let ReactDOMClient;
  let Scheduler;
  let assertLog;
  let startTransition;
  let useOptimistic;
  let textCache;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    startTransition = React.startTransition;
    useOptimistic = React.useOptimistic;
    container = document.createElement('div');
    document.body.appendChild(container);

    textCache = new Map();
  });

  /** `resolveText`：封装当前用例复用的操作、回调或断言步骤。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t(text));
    }
  }

  /** `getText`：封装当前用例复用的操作、回调或断言步骤。 */
  function getText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const thenable = {
        pings: [],
        /** `getText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };
      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);
      return thenable;
    } else {
      switch (record.status) {
        case 'pending':
          return record.value;
        case 'rejected':
          return Promise.reject(record.value);
        case 'resolved':
          return Promise.resolve(record.value);
      }
    }
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  afterEach(() => {
    document.body.removeChild(container);
  });

  // 该测试导入多个 reconciler。受 renderer 构建方式影响，它只能针对实际构建产物运行，不能直接针对
  // 源文件运行。
  // @gate !source
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「React.startTransition works across multiple renderers」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('React.startTransition works across multiple renderers', async () => {
    const ReactNoop = require('react-noop-renderer');

    const setIsPendings = new Set();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [isPending, setIsPending] = useOptimistic(false);
      setIsPendings.add(setIsPending);
      return <Text text={isPending ? 'Pending' : 'Not pending'} />;
    }

    const noopRoot = ReactNoop.createRoot(null);
    const domRoot = ReactDOMClient.createRoot(container);

    // 运行相同的组件在两个不同的渲染器中。
    await act(() => {
      noopRoot.render(<App />);
      domRoot.render(<App />);
    });
    assertLog(['Not pending', 'Not pending']);
    expect(container.textContent).toEqual('Not pending');
    expect(noopRoot).toMatchRenderedOutput('Not pending');

    await act(() => {
      startTransition(async () => {
        // 等待异步间隙之后设置乐观状态。
        await getText('Wait before setting isPending');
        setIsPendings.forEach(setIsPending => setIsPending(true));

        // 乐观状态在动作完成之前不应被撤销。
        await getText('Wait until end of async action');
      });
    });

    await act(() => resolveText('Wait before setting isPending'));
    assertLog(['Pending', 'Pending']);
    expect(container.textContent).toEqual('Pending');
    expect(noopRoot).toMatchRenderedOutput('Pending');

    await act(() => resolveText('Wait until end of async action'));
    assertLog(['Not pending', 'Not pending']);
    expect(container.textContent).toEqual('Not pending');
    expect(noopRoot).toMatchRenderedOutput('Not pending');
  });
});
