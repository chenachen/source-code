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
let waitForAll;
let act;
let assertConsoleErrorDev;

/** 验证 Suspense 的实验性 suspenseCallback 类型检查、thenable 集合收缩及嵌套边界归属。 */
describe('ReactSuspense', () => {
  /** 重置模块和根，并绑定全量冲刷、act 与开发控制台断言。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    act = InternalTestUtils.act;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** 创建可手动完成的 promise 及配套组件，返回同一 promise 身份供 callback Set 断言。 */
  function createThenable() {
    let completed = false;
    let resolve;
    const promise = new Promise(res => {
      /** 先把组件读取的完成标记设为 true，再解决 Promise 并触发 Suspense 重试。 */
      resolve = () => {
        completed = true;
        res();
      };
    });
    /** 未完成时抛出 promise，完成后返回 Done；是 Suspense 捕获 thenable 的最小载体。 */
    const PromiseComp = () => {
      if (!completed) {
        throw promise;
      }
      return 'Done';
    };
    return {promise, resolve, PromiseComp};
  }

  // 生产构建不发出此警告，因此即使 suspenseCallback 未启用，用例也会通过；
  // gate 只在开发构建要求启用该特性。
  /** Given–When–Then：Given Suspense 的 suspenseCallback 传入数字，随后对照省略该 prop；When PromiseComp 挂起；Then开发模式仅对错误类型发出预期警告，缺省回调无警告。通过控制台次数与 feature gate 分支验证 prop 类型门禁。 */
  // @gate enableSuspenseCallback || !__DEV__
  it('check type', async () => {
    const {PromiseComp} = createThenable();

    const elementBadType = (
      <React.Suspense suspenseCallback={1} fallback={'Waiting'}>
        <PromiseComp />
      </React.Suspense>
    );

    ReactNoop.render(elementBadType);
    await waitForAll([]);
    assertConsoleErrorDev(
      [
        'Unexpected type for suspenseCallback.',
        ...(gate('alwaysThrottleRetries')
          ? []
          : ['Unexpected type for suspenseCallback.']),
      ],
      {
        withoutStack: true,
      },
    );

    const elementMissingCallback = (
      <React.Suspense fallback={'Waiting'}>
        <PromiseComp />
      </React.Suspense>
    );

    ReactNoop.render(elementMissingCallback);
    await waitForAll([]);
    assertConsoleErrorDev([]);
  });

  /** Given–When–Then：Given单个 PromiseComp 挂起后解决；When边界从 Waiting 重试为 Done；Then callback 在挂起时收到含 promise 的 Set，完成后不再上报。通过 ops 集合与宿主输出验证边界 thenable 集合。 */
  // @gate enableSuspenseCallback
  it('1 then 0 suspense callback', async () => {
    const {promise, resolve, PromiseComp} = createThenable();

    let ops = [];
    /** 将 suspenseCallback 收到的 thenable Set 原样保存，保留集合身份与调用顺序供断言。 */
    const suspenseCallback = thenables => {
      ops.push(thenables);
    };

    const element = (
      <React.Suspense suspenseCallback={suspenseCallback} fallback={'Waiting'}>
        <PromiseComp />
      </React.Suspense>
    );

    ReactNoop.render(element);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Waiting');
    expect(ops).toEqual([
      new Set([promise]),
      ...(gate('alwaysThrottleRetries') ? [] : new Set([promise])),
    ]);
    ops = [];

    await act(() => resolve());
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Done');
    expect(ops).toEqual([]);
  });

  /** Given–When–Then：Given 同一边界含 promise1/promise2；When 首次挂起后依次解决两者并重渲染；Then 首轮至少报告 promise1，解决后两次报告只剩 promise2 的 Set，全部完成则不再调用 callback，输出 Waiting Tier 1→DoneDone。额外首轮期望受 alwaysThrottleRetries 控制，不把所有配置概括为固定 2→1 次数。 */
  // @gate enableSuspenseCallback
  it('2 then 1 then 0 suspense callback', async () => {
    const {
      promise: promise1,
      resolve: resolve1,
      PromiseComp: PromiseComp1,
    } = createThenable();
    const {
      promise: promise2,
      resolve: resolve2,
      PromiseComp: PromiseComp2,
    } = createThenable();

    let ops = [];
    /** 将 suspenseCallback1 收到的 thenable Set 原样保存，保留集合身份与调用顺序供断言。 */
    const suspenseCallback1 = thenables => {
      ops.push(thenables);
    };

    const element = (
      <React.Suspense
        suspenseCallback={suspenseCallback1}
        fallback={'Waiting Tier 1'}>
        <PromiseComp1 />
        <PromiseComp2 />
      </React.Suspense>
    );

    ReactNoop.render(element);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Waiting Tier 1');
    expect(ops).toEqual([
      new Set([promise1]),
      // 此历史断言在关闭节流时直接展开 Set 为 promise 项；它不是另一个 Set 回调的期望。
      ...(gate('alwaysThrottleRetries') ? [] : new Set([promise1, promise2])),
    ]);
    ops = [];

    await act(() => resolve1());
    ReactNoop.render(element);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Waiting Tier 1');
    expect(ops).toEqual([
      new Set([promise2]),
      // 预热仍未解决的主树。
      new Set([promise2]),
    ]);
    ops = [];

    await act(() => resolve2());
    ReactNoop.render(element);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('DoneDone');
    expect(ops).toEqual([]);
  });

  /** Given–When–Then：Given内外两层 Suspense 只有内层 PromiseComp 挂起；When协调器选择内层 fallback；Then仅内层 callback 收到 promise，外层保持空。通过 ops1/ops2 验证 thenable 只归属实际捕获层级。 */
  // @gate enableSuspenseCallback
  it('nested suspense promises are reported only for their tier', async () => {
    const {promise, PromiseComp} = createThenable();

    const ops1 = [];
    /** 将 suspenseCallback1 收到的 thenable Set 原样保存，保留集合身份与调用顺序供断言。 */
    const suspenseCallback1 = thenables => {
      ops1.push(thenables);
    };
    const ops2 = [];
    /** 将 suspenseCallback2 收到的 thenable Set 原样保存，保留集合身份与调用顺序供断言。 */
    const suspenseCallback2 = thenables => {
      ops2.push(thenables);
    };

    const element = (
      <React.Suspense
        suspenseCallback={suspenseCallback1}
        fallback={'Waiting Tier 1'}>
        <React.Suspense
          suspenseCallback={suspenseCallback2}
          fallback={'Waiting Tier 2'}>
          <PromiseComp />
        </React.Suspense>
      </React.Suspense>
    );

    ReactNoop.render(element);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Waiting Tier 2');
    expect(ops1).toEqual([]);
    expect(ops2).toEqual([
      new Set([promise]),
      ...(gate('alwaysThrottleRetries') ? [] : [new Set([promise])]),
    ]);
  });

  /** Given–When–Then：Given外层 promise1 与内层 promise2 竞争；When先解决外层、再解决内层；Then callback 所属从外层切到内层，最终全部清空。通过两级输出与 Set 日志验证每次提交的捕获边界。 */
  // @gate enableSuspenseCallback
  it('competing suspense promises', async () => {
    const {
      promise: promise1,
      resolve: resolve1,
      PromiseComp: PromiseComp1,
    } = createThenable();
    const {
      promise: promise2,
      resolve: resolve2,
      PromiseComp: PromiseComp2,
    } = createThenable();

    let ops1 = [];
    /** 将 suspenseCallback1 收到的 thenable Set 原样保存，保留集合身份与调用顺序供断言。 */
    const suspenseCallback1 = thenables => {
      ops1.push(thenables);
    };
    let ops2 = [];
    /** 将 suspenseCallback2 收到的 thenable Set 原样保存，保留集合身份与调用顺序供断言。 */
    const suspenseCallback2 = thenables => {
      ops2.push(thenables);
    };

    const element = (
      <React.Suspense
        suspenseCallback={suspenseCallback1}
        fallback={'Waiting Tier 1'}>
        <React.Suspense
          suspenseCallback={suspenseCallback2}
          fallback={'Waiting Tier 2'}>
          <PromiseComp2 />
        </React.Suspense>
        <PromiseComp1 />
      </React.Suspense>
    );

    ReactNoop.render(element);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Waiting Tier 1');
    expect(ops1).toEqual([new Set([promise1])]);
    expect(ops2).toEqual([]);
    ops1 = [];
    ops2 = [];

    await act(() => resolve1());
    expect(ReactNoop).toMatchRenderedOutput('Waiting Tier 2Done');
    expect(ops1).toEqual([]);
    expect(ops2).toEqual([new Set([promise2]), new Set([promise2])]);
    ops1 = [];
    ops2 = [];

    await act(() => resolve2());
    expect(ReactNoop).toMatchRenderedOutput('DoneDone');
    expect(ops1).toEqual([]);
    expect(ops2).toEqual([]);
  });
});
