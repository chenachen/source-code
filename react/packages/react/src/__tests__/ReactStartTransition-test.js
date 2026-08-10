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

/** 表示一次 transition 中触发“订阅式大量更新”警告的 Fiber 数量阈值。 */
const SUSPICIOUS_NUMBER_OF_FIBERS_UPDATED = 10;

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
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“Warns if a suspicious number of fibers are updated inside startTransition”场景的唯一关键操作。
   * Then：断言 startTransition 的订阅式大量更新诊断 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('Warns if a suspicious number of fibers are updated inside startTransition', async () => {
    const subs = new Set();
    /** 实现“Warns if a suspicious number of fibers are updated inside startTransition”场景所需的“useUserSpaceSubscription”测试夹具行为。 */
    const useUserSpaceSubscription = () => {
      const setState = useState(0)[1];
      subs.add(setState);
    };

    let triggerHookTransition;

    /** 作为“Warns if a suspicious number of fibers are updated inside startTransition”场景的函数夹具，返回待协调内容或触发目标行为。 */
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
