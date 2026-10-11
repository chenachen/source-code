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

  /** 创建已完成缓存记录，或把 pending 记录改为 resolved 并通知全部等待者；控制同一 async action 两个独立等待点。 */
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

  /** 按文本键返回稳定 pending thenable；完成记录改返回已完成 Promise，拒绝记录改返回 rejected Promise。缓存用于手工控制 Transition 的开始与结束。 */
  function getText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const thenable = {
        pings: [],
        /** pending 时保存 resolve 回调；已完成时借 Promise 微任务通知，模拟异步等待可在首次订阅前或后完成。 */
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

  /** 记录每个 renderer 的当前乐观状态并原样输出，以同时比较调度日志和两个根结果。 */
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
  /** 在实际构建产物中同时建立 DOM 与 Noop 根，各自挂载 useOptimistic 状态；同一个 async startTransition 在第一等待点后设置两个根为 Pending，第二等待点结束后二者恢复 Not pending，验证共享 React Transition 上下文跨 renderer 延续且乐观状态维持至整个 action 完成。 */
  it('React.startTransition works across multiple renderers', async () => {
    const ReactNoop = require('react-noop-renderer');

    const setIsPendings = new Set();

    /** 各 renderer 独立建立 useOptimistic(false)，把更新器收进 Set；同一 action 可遍历更新所有根，完成后自动回退。 */
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
