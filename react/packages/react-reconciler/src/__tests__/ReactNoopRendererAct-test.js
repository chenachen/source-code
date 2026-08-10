/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment node
 */

// act() 的基础健全性测试。

/** 测试所用 React 公共 API。 */
const React = require('react');
/** 提供无宿主环境渲染根，便于只观察调度与 effect。 */
const ReactNoop = require('react-noop-renderer');
/** 记录跨微任务阶段的可断言日志。 */
const Scheduler = require('scheduler');
/** 内部异步 act；负责耗尽 React 测试队列与相关微任务。 */
const act = require('internal-test-utils').act;
/** 日志断言与队列耗尽工具：前者核对阶段顺序，后者等待残余调度工作。 */
const {assertLog, waitForAll} = require('internal-test-utils');

// TODO: 这些测试已不再专属于 noop renderer；
// 它们验证 React 测试套件自身使用的内部实现。
/** 验证内部 act 能覆盖被动 effect 及跨多轮 await 的异步状态更新。 */
describe('internal act()', () => {
  /** Given 组件在 useEffect 中调用回调；When render 包在 act 内并随后确认调度队列为空；Then 回调只执行一次。通过 calledLog 验证 act 已刷新被动 effect。 */
  it('can use act to flush effects', async () => {
    /** 注册传入的 effect 回调，用于证明 act 会进入被动 effect 阶段。 */
    function App(props) {
      React.useEffect(props.callback);
      return null;
    }

    const calledLog = [];
    await act(() => {
      ReactNoop.render(
        <App
          callback={() => {
            calledLog.push(calledLog.length);
          }}
        />,
      );
    });
    await waitForAll([]);
    expect(calledLog).toEqual([0]);
  });

  /** Given effect 启动跨两轮微任务的异步函数并最终 setState；When 使用 act 包裹初次渲染；Then 两个阶段日志有序出现且状态 1 已提交。通过 Scheduler 日志与 ReactNoop 输出验证 act 对微任务链的递归排空。 */
  it('should work with async/await', async () => {
    /** 在 effect 中启动异步链，并把链尾状态写入渲染输出。 */
    function App() {
      const [ctr, setCtr] = React.useState(0);
      /** 依次跨越两轮微任务再更新 ctr，模拟 act 必须持续追踪的异步工作。 */
      async function someAsyncFunction() {
        Scheduler.log('stage 1');
        await null;
        Scheduler.log('stage 2');
        await null;
        setCtr(1);
      }
      React.useEffect(() => {
        someAsyncFunction();
      }, []);
      return ctr;
    }
    await act(() => {
      ReactNoop.render(<App />);
    });
    assertLog(['stage 1', 'stage 2']);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('1');
  });
});
