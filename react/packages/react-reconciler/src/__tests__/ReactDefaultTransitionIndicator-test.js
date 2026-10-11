/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let act;
let use;
let useOptimistic;
let useState;
let useTransition;
let useDeferredValue;
let assertLog;
let waitForPaint;

/** 验证默认 transition indicator 的启动/清理，以及应用自有 sync、optimistic、isPending、deferred UI 对它的抑制规则。 */
describe('ReactDefaultTransitionIndicator', () => {
  /** 重置根与 Hook API，绑定 action/painters 日志以隔离全局默认 indicator 注册状态。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;
    use = React.use;
    useOptimistic = React.useOptimistic;
    useState = React.useState;
    useTransition = React.useTransition;
    useDeferredValue = React.useDeferredValue;
  });

  /** Given–When–Then：Given transition render 的 App use 未解决 promise；When根进入等待并随后 promise 解决；Then默认 indicator 先 start、完成时 stop，最终提交 Hello。通过回调清理函数日志验证 transition 生命周期。 */
  // @gate enableDefaultTransitionIndicator
  it('triggers the default indicator while a transition is on-going', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** 直接 use 未解决 promise，使根 transition 无任何应用级 loading UI。 */
    function App() {
      return use(promise);
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      React.startTransition(() => {
        root.render(<App />);
      });
    });

    assertLog(['start']);

    await act(async () => {
      await resolve('Hello');
    });

    assertLog(['stop']);

    expect(root).toMatchRenderedOutput('Hello');
  });

  /** Given–When–Then：Given已有 Hi，随后普通 state 更新写入 Loading 并在 transition 中清空 state、等待 B；When B 解决；Then应用先提交的 loading UI 抑制默认 indicator。通过全程无 start/stop 与宿主输出验证 sync mutation 启发式。 */
  // @gate enableDefaultTransitionIndicator
  it('does not trigger the default indicator if there is a sync mutation', async () => {
    const promiseA = Promise.resolve('Hi');
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));
    let update;
    /** 持有普通 state 并组合 promise children，允许在挂起期间显示显式 Loading 文本。 */
    function App({children}) {
      const [state, setState] = useState('');
      update = setState;
      return (
        <div>
          {state}
          {children}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      React.startTransition(() => {
        root.render(<App>{promiseA}</App>);
      });
    });

    assertLog(['start', 'stop']);

    expect(root).toMatchRenderedOutput(<div>Hi</div>);

    await act(() => {
      update('Loading...');
      React.startTransition(() => {
        update('');
        root.render(<App>{promiseB}</App>);
      });
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput(<div>Loading...Hi</div>);

    await act(async () => {
      await resolveB('Hello');
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given–When–Then：Given transition 内 useOptimistic 写入 Loading 并等待 B；When action 完成；Then optimistic UI 充当局部 indicator，默认根回调不触发。通过 Loading...Hi 到 Hello 的输出验证 optimistic lane 抑制。 */
  // @gate enableDefaultTransitionIndicator
  it('does not trigger the default indicator if there is an optimistic update', async () => {
    const promiseA = Promise.resolve('Hi');
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));
    let update;
    /** 用 useOptimistic 生成 action 生命周期内的局部 Loading 状态。 */
    function App({children}) {
      const [state, setOptimistic] = useOptimistic('');
      update = setOptimistic;
      return (
        <div>
          {state}
          {children}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      React.startTransition(() => {
        root.render(<App>{promiseA}</App>);
      });
    });

    assertLog(['start', 'stop']);

    expect(root).toMatchRenderedOutput(<div>Hi</div>);

    await act(() => {
      React.startTransition(() => {
        update('Loading...');
        root.render(<App>{promiseB}</App>);
      });
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput(<div>Loading...Hi</div>);

    await act(async () => {
      await resolveB('Hello');
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given–When–Then：Given useTransition start 暴露 isPending Loading；When transition 等待 promiseB；Then局部 isPending UI 抑制根默认 indicator。通过 Loading...Hi 与无回调日志验证。 */
  // @gate enableDefaultTransitionIndicator
  it('does not trigger the default indicator if there is an isPending update', async () => {
    const promiseA = Promise.resolve('Hi');
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));
    let start;
    /** 用 useTransition.isPending 渲染 Loading，并暴露 start 触发器。 */
    function App({children}) {
      const [isPending, startTransition] = useTransition();
      start = startTransition;
      return (
        <div>
          {isPending ? 'Loading...' : ''}
          {children}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      React.startTransition(() => {
        root.render(<App>{promiseA}</App>);
      });
    });

    assertLog(['start', 'stop']);

    expect(root).toMatchRenderedOutput(<div>Hi</div>);

    await act(() => {
      start(() => {
        root.render(<App>{promiseB}</App>);
      });
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput(<div>Loading...Hi</div>);

    await act(async () => {
      await resolveB('Hello');
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given–When–Then：Given useTransition action 仅返回 promise、尚未 setState；When action pending 再解决；Then因应用没有自身 pending UI，默认 indicator 在 action 生命周期 start/stop。通过根不变仍有回调日志验证 async action。 */
  // @gate enableDefaultTransitionIndicator
  it('triggers the default indicator while an async transition is ongoing', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    let start;
    /** 仅返回稳定 Hi；pending 只存在于异步 action，不来自 render 输出。 */
    function App() {
      const [, startTransition] = useTransition();
      start = startTransition;
      return 'Hi';
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      root.render(<App />);
    });

    assertLog([]);

    await act(() => {
      // 启动异步 action，但尚未调用任何 setState。
      start(() => promise);
    });

    assertLog(['start']);

    await act(async () => {
      await resolve('Hello');
    });

    assertLog(['stop']);

    expect(root).toMatchRenderedOutput('Hi');
  });

  /** Given–When–Then：Given React.startTransition 的 isomorphic action 仅返回 promise；When action pending/完成；Then唯一已注册根的默认 indicator start/stop。通过 Hi 输出不变验证 action scope 也驱动根级 indicator。 */
  // @gate enableDefaultTransitionIndicator
  it('triggers the default indicator while an async transition is ongoing (isomorphic)', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** 仅返回稳定 Hi；pending 只存在于异步 action，不来自 render 输出。 */
    function App() {
      return 'Hi';
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      root.render(<App />);
    });

    assertLog([]);

    await act(() => {
      // 启动异步 action，但尚未调用任何 setState。
      React.startTransition(() => promise);
    });

    assertLog(['start']);

    await act(async () => {
      await resolve('Hello');
    });

    assertLog(['stop']);

    expect(root).toMatchRenderedOutput('Hi');
  });

  /** Given–When–Then：Given两个根注册不同默认 indicator；When无根归属的 isomorphic action pending；Then归属有歧义，两个 indicator 都不触发。通过空日志验证全局 action 的唯一根选择。 */
  it('does not triggers isomorphic async action default indicator if there are two different ones', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** 返回稳定 Hi，用于隔离多个根注册造成的 indicator 归属歧义。 */
    function App() {
      return 'Hi';
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    // 注册第二个根后，全局 action 无法唯一决定应使用哪个 indicator。
    ReactNoop.createRoot({
      /** 第二个根的独立 indicator；若 isomorphic action 归属不唯一，该回调不得被选择。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start2');
        return () => {
          Scheduler.log('stop2');
        };
      },
    });
    await act(() => {
      root.render(<App />);
    });

    assertLog([]);

    await act(() => {
      // 启动异步 action，但尚未调用任何 setState。
      React.startTransition(() => promise);
    });

    assertLog([]);

    await act(async () => {
      await resolve('Hello');
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput('Hi');
  });

  /** Given–When–Then：Given普通 state 更新先切到 Loading，isomorphic action 完成后再恢复 Hi；When promise pending；Then应用已有 loading mutation，默认 indicator 不触发。通过 Loading/Hi 输出与空日志验证。 */
  it('does not triggers isomorphic async action default indicator if there is a loading state', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    let update;
    /** 持有显式 Loading/Hi 状态，action pending 前先安排普通更新切换 UI。 */
    function App() {
      const [state, setState] = useState(false);
      update = setState;
      return state ? 'Loading' : 'Hi';
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(() => {
      root.render(<App />);
    });

    assertLog([]);

    await act(() => {
      update(true);
      React.startTransition(() => promise.then(() => update(false)));
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput('Loading');

    await act(async () => {
      await resolve('Hello');
    });

    assertLog([]);

    expect(root).toMatchRenderedOutput('Hi');
  });

  /** Given–When–Then：Given useDeferredValue 有初始 Hi，普通更新先提交 deferred 旧值再后台补 Hello/Bye；When两次按 paint 推进；Then这是 deferred render 而非 transition action，不触发默认 indicator。通过 Text 日志与输出验证。 */
  it('should not trigger for useDeferredValue (sync)', async () => {
    /** 记录并返回 deferred 文本，区分前台占位值与后台补全提交。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }
    /** 读取 deferred value 并交给 Text，暴露前台旧值与后台新值两次提交。 */
    function App({value}) {
      const deferredValue = useDeferredValue(value, 'Hi');
      return <Text text={deferredValue} />;
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(async () => {
      root.render(<App value="Hello" />);
      await waitForPaint(['Hi']);
      expect(root).toMatchRenderedOutput('Hi');
    });

    assertLog(['Hello']);

    expect(root).toMatchRenderedOutput('Hello');

    assertLog([]);

    await act(async () => {
      root.render(<App value="Bye" />);
      await waitForPaint(['Hello']);
      expect(root).toMatchRenderedOutput('Hello');
    });

    assertLog(['Bye']);

    expect(root).toMatchRenderedOutput('Bye');
  });

  /** Given–When–Then：Given transition 中 useDeferredValue 初次先显示 Hi；When后台值补为 Hello；Then root transition 本身短暂 start/stop，但 deferred 后续提交不额外触发 indicator。通过 paint 日志只有一对 start/stop 验证。 */
  // @gate enableDefaultTransitionIndicator
  it('should not trigger for useDeferredValue (transition)', async () => {
    /** 记录并返回 deferred 文本，区分前台占位值与后台补全提交。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }
    /** 读取 deferred value 并交给 Text，暴露前台旧值与后台新值两次提交。 */
    function App({value}) {
      const deferredValue = useDeferredValue(value, 'Hi');
      return <Text text={deferredValue} />;
    }

    const root = ReactNoop.createRoot({
      /** 记录默认 indicator 启动，并返回记录 stop 的清理函数，覆盖完整 pending 生命周期。 */
      onDefaultTransitionIndicator() {
        Scheduler.log('start');
        return () => {
          Scheduler.log('stop');
        };
      },
    });
    await act(async () => {
      React.startTransition(() => {
        root.render(<App value="Hello" />);
      });
      await waitForPaint(['start', 'Hi', 'stop']);
      expect(root).toMatchRenderedOutput('Hi');
    });

    assertLog(['Hello']);

    expect(root).toMatchRenderedOutput('Hello');
  });
});
