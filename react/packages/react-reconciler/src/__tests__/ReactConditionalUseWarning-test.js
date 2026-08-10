/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let act;
let assertLog;
let use;
let Suspense;
let startTransition;

/** 覆盖 use(thenable) 在挂起前后条件调用不一致时的开发警告及合法无条件调用对照。 */
describe('conditional use warning', () => {
  /** 重置模块并绑定 use、Suspense、transition 与日志工具，隔离 thenable 追踪状态。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    use = React.use;
    Suspense = React.Suspense;
    startTransition = React.startTransition;
  });

  /** Given Async 首次 use(promise) 挂起，promise 解决后因外部 cache 分支跳过 use；When transition 重试并再次普通渲染；Then开发模式只报告一次 conditional-use 错误。通过 Suspense 输出、Error 对象和去重次数验证 useThenable 的调用一致性检查。 */
  // @gate __DEV__ && enableConditionalUseWarning
  it('warns if use(promise) is called conditionally based on a cache', async () => {
    let cachedValue;
    let resolve;
    const promise = new Promise(r => {
      resolve = value => {
        cachedValue = value;
        r(value);
      };
    });

    /** 记录并返回文本，使 fallback、解析结果与重试轮次可见。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    /** cache 未命中时调用 use 挂起，命中后绕过 use；刻意制造两次 render 的 Hook/thenable 调用不一致。 */
    function Async() {
      if (cachedValue !== undefined) {
        return <Text text={cachedValue} />;
      }
      return <Text text={use(promise)} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="Initial" />
        </Suspense>,
      );
    });
    assertLog(['Initial']);
    expect(root).toMatchRenderedOutput('Initial');

    spyOnDev(console, 'error').mockImplementation(() => {});
    try {
      await act(() => {
        startTransition(() => {
          root.render(
            <Suspense fallback={<Text text="Loading..." />}>
              <Async />
            </Suspense>,
          );
        });
      });
      assertLog(['Loading...']);
      expect(root).toMatchRenderedOutput('Initial');

      await act(() => resolve('Async'));
      assertLog(['Async']);
      expect(root).toMatchRenderedOutput('Async');

      expect(console.error).toHaveBeenCalledTimes(1);
      const warning = console.error.mock.calls[0][0];
      expect(warning).toBeInstanceOf(Error);
      expect(warning.message).toBe(
        'This library called use() to suspend in a previous render but ' +
          'did not call use() when it finished. This indicates an incorrect use of use(). ' +
          'Learn more: https://react.dev/warnings/conditional-use-of-use',
      );

      await act(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <Async />
          </Suspense>,
        );
      });
      assertLog(['Async']);
      expect(root).toMatchRenderedOutput('Async');
      expect(console.error).toHaveBeenCalledTimes(1);
    } finally {
      if (__DEV__) {
        console.error.mockRestore();
      }
    }
  });

  /** Given Async 每轮都无条件调用 use(promise)；When从 fallback 解析为 Async 并再次渲染；Then结果稳定且控制台无警告。通过日志、宿主输出与 console.error 验证合法 use 重试路径。 */
  it('does not warn if use(promise) is called unconditionally', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });

    /** 记录并返回文本，使 fallback、解析结果与重试轮次可见。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    /** 每轮都调用 use 读取同一 promise，作为不会触发条件调用警告的对照。 */
    function Async() {
      return <Text text={use(promise)} />;
    }

    const root = ReactNoop.createRoot();
    spyOnDev(console, 'error').mockImplementation(() => {});
    try {
      await act(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <Async />
          </Suspense>,
        );
      });
      assertLog(['Loading...']);
      expect(root).toMatchRenderedOutput('Loading...');

      await act(() => resolve('Async'));
      assertLog(['Async']);
      expect(root).toMatchRenderedOutput('Async');

      await act(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <Async />
          </Suspense>,
        );
      });
      assertLog(['Async']);
      expect(root).toMatchRenderedOutput('Async');
      if (__DEV__) {
        expect(console.error).not.toHaveBeenCalled();
      }
    } finally {
      if (__DEV__) {
        console.error.mockRestore();
      }
    }
  });
});
