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
let ReactTestRenderer;
let act;
let assertConsoleWarnDev;
let useState;
let useTransition;

/** DEV 在一次最外层 transition 更新超过此数量的 Fiber 时发出订阅检查提示。 */
const SUSPICIOUS_NUMBER_OF_FIBERS_UPDATED = 10;

// 每例重置模块并重新取得 renderer/act，隔离最外层 transition 的 DEV Fiber 计数。
describe('ReactStartTransition', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactTestRenderer = require('react-test-renderer');
    ({act, assertConsoleWarnDev} = require('internal-test-utils'));
    useState = React.useState;
    useTransition = React.useTransition;
  });

  /**
   * 从 level 0 到 10 挂载 11 个订阅者，再一次性派发所有 setter，超过 DEV 的 10 个 Fiber 阈值。
   * 分别从 React.startTransition 与 useTransition 返回的启动函数触发，断言两条入口都输出提示。
   */
  it('Warns if a suspicious number of fibers are updated inside startTransition', async () => {
    const subs = new Set();
    /** 获取本实例 useState setter 并加入 subs Set；每次 render 重复加入同一 setter，不注册外部订阅或清理，仅构造批量派发 fixture。 */
    const useUserSpaceSubscription = () => {
      const setState = useState(0)[1];
      subs.add(setState);
    };

    let triggerHookTransition;

    /** 递归渲染 level=0..10 共十一实例，每层登记 setter，根捕获 useTransition 启动函数；level=10 返回 null。 */
    const Component = ({level}) => {
      useUserSpaceSubscription();
      if (level === 0) {
        triggerHookTransition = useTransition()[1];
      }
      if (level < SUSPICIOUS_NUMBER_OF_FIBERS_UPDATED) {
        return <Component level={level + 1} />;
      }
      return null;
    };

    await act(() => {
      ReactTestRenderer.create(<Component level={0} />, {
        unstable_isConcurrent: true,
      });
    });

    await act(() => {
      React.startTransition(() => {
        subs.forEach(setState => {
          setState(state => state + 1);
        });
      });
    });
    assertConsoleWarnDev([
      'Detected a large number of updates inside startTransition. ' +
        'If this is due to a subscription please re-write it to use React provided hooks. ' +
        'Otherwise concurrent mode guarantees are off the table.',
    ]);

    await act(() => {
      triggerHookTransition(() => {
        subs.forEach(setState => {
          setState(state => state + 1);
        });
      });
    });
    assertConsoleWarnDev([
      'Detected a large number of updates inside startTransition. ' +
        'If this is due to a subscription please re-write it to use React provided hooks. ' +
        'Otherwise concurrent mode guarantees are off the table.',
    ]);
  });
});
