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

/** 验证 `useRef` 对象的初始化、跨渲染身份，以及 Effect 与渲染外读写示例。 */
describe('useRef', () => {
  let React;
  let ReactNoop;
  let Scheduler;
  let act;
  let useCallback;
  let useEffect;
  let useLayoutEffect;
  let useRef;
  let useState;
  let waitForAll;
  let assertLog;

  /** 每个用例重新绑定 React、Noop 渲染器、Hook API 与调度日志断言工具。 */
  beforeEach(() => {
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    act = require('internal-test-utils').act;
    useCallback = React.useCallback;
    useEffect = React.useEffect;
    useLayoutEffect = React.useLayoutEffect;
    useRef = React.useRef;
    useState = React.useState;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
  });

  /** 把文本同时写入调度日志和宿主输出，供渲染次数与最终内容的双重断言使用。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /**
   * Given：防抖 Hook 用 `useRef(-1)` 保存当前定时器标识。
   * When：连续调用回调并推进 Jest 虚拟时间。
   * Then：只有最后一次参数在完整延迟后写入日志。
   *
   * 验证机制：分段推进时钟并多次检查空日志，证明 ref 保存的是同一份可变定时器状态。
   * 对应源码：`mountRef()` 初始化对象，后续渲染由 `updateRef()` 返回同一对象。
   */
  it('creates a ref object initialized with the provided value', async () => {
    jest.useFakeTimers();

    /** 用 ref 持有跨调用共享的定时器，并返回按依赖稳定的防抖回调。 */
    function useDebouncedCallback(callback, ms, inputs) {
      const timeoutID = useRef(-1);
      useEffect(() => {
        return /** 卸载时清除尚未触发的定时器，防止 fixture 离开树后继续回调。 */ function unmount() {
          clearTimeout(timeoutID.current);
        };
      }, []);
      const debouncedCallback = useCallback(
        (...args) => {
          clearTimeout(timeoutID.current);
          timeoutID.current = setTimeout(callback, ms, ...args);
        },
        [callback, ms],
      );
      return useCallback(debouncedCallback, inputs);
    }

    let ping;
    /** 挂载防抖 Hook，并把可触发的稳定回调暴露给测试步骤。 */
    function App() {
      ping = useDebouncedCallback(
        value => {
          Scheduler.log('ping: ' + value);
        },
        100,
        [],
      );
      return null;
    }

    await act(() => {
      ReactNoop.render(<App />);
    });
    assertLog([]);

    ping(1);
    ping(2);
    ping(3);

    assertLog([]);

    jest.advanceTimersByTime(100);

    assertLog(['ping: 3']);

    ping(4);
    jest.advanceTimersByTime(20);
    ping(5);
    ping(6);
    jest.advanceTimersByTime(80);

    assertLog([]);

    jest.advanceTimersByTime(20);
    assertLog(['ping: 6']);
  });

  /**
   * Given：组件把首轮 `useRef` 返回值另存到 state，并在渲染阶段连续更新计数。
   * When：发生同轮重渲染以及随后一次根更新。
   * Then：每次获得的 ref 都与首轮对象严格相同。
   *
   * 验证机制：对象不同时主动抛错，并用宿主日志确认所有重渲染均执行完毕。
   * 对应源码：`updateRef()` 直接返回当前 Hook 的 `memoizedState`。
   */
  it('should return the same ref during re-renders', async () => {
    /** 连续触发渲染阶段更新，并以首轮 state 快照检查 ref 身份是否稳定。 */
    function Counter() {
      const ref = useRef('val');
      const [count, setCount] = useState(0);
      const [firstRef] = useState(ref);

      if (firstRef !== ref) {
        throw new Error('should never change');
      }

      if (count < 3) {
        setCount(count + 1);
      }

      return <Text text={count} />;
    }

    ReactNoop.render(<Counter />);
    await waitForAll([3]);

    ReactNoop.render(<Counter />);
    await waitForAll([3]);
  });

  if (__DEV__) {
    /** 场景：把 ref 分别附到宿主节点与类组件并完成更新，验证合法 ref 目标不会产生开发态告警。 */
    it('should never warn when attaching to children', async () => {
      /** 提供可接收类组件 ref 的最小实例目标。 */
      class Component extends React.Component {
        /** 类 fixture 不输出宿主内容，只用于建立实例 ref。 */
        render() {
          return null;
        }
      }

      /** 为每个阶段创建宿主 ref 与类实例 ref，并通过 key 强制覆盖挂载和更新目标。 */
      function Example({phase}) {
        const hostRef = useRef();
        const classRef = useRef();
        return (
          <>
            <div key={`host-${phase}`} ref={hostRef} />
            <Component key={`class-${phase}`} ref={classRef} />
          </>
        );
      }

      await act(() => {
        ReactNoop.render(<Example phase="mount" />);
      });
      await act(() => {
        ReactNoop.render(<Example phase="update" />);
      });
    });

    /**
     * Given：两个空 ref 在渲染中仅于初值为空时完成一次惰性初始化。
     * When：组件挂载后再以同一元素更新。
     * Then：两轮渲染都不产生 ref 访问告警。
     *
     * 验证机制：开发态测试环境会把意外告警提升为失败，第二轮更新覆盖已初始化分支。
     * 对应源码：`mountRef()` 创建普通 current 对象，`updateRef()` 复用它；本版本没有运行时 ref 读写校验。
     */
    it('should not warn about lazy init during render', async () => {
      /** 在渲染中按 `null`/`undefined` 哨兵各执行一次 ref 惰性初始化。 */
      function Example() {
        const ref1 = useRef(null);
        const ref2 = useRef(undefined);
        // 此读取用于判定一次性惰性初始化，因此在渲染阶段是安全的。
        if (ref1.current === null) {
          ref1.current = 123;
        }
        if (ref2.current === undefined) {
          ref2.current = 123;
        }
        return null;
      }

      await act(() => {
        ReactNoop.render(<Example />);
      });

      // 更新后 ref 已有值，同一模式仍不应产生告警。
      await act(() => {
        ReactNoop.render(<Example />);
      });
    });

    /** 场景：在 Layout Effect 中写入空 ref 并触发更新，验证提交阶段的惰性初始化不会被误报。 */
    it('should not warn about lazy init outside of render', async () => {
      /** 在布局阶段初始化两个 ref，并用 state 更新确保该访问跨过一次提交。 */
      function Example() {
        // eslint-disable-next-line no-unused-vars
        const [didMount, setDidMount] = useState(false);
        const ref1 = useRef(null);
        const ref2 = useRef(undefined);
        useLayoutEffect(() => {
          ref1.current = 123;
          ref2.current = 123;
          setDidMount(true);
        }, []);
        return null;
      }

      await act(() => {
        ReactNoop.render(<Example />);
      });
    });

    /**
     * Given：ref 初值为 `123`，布局与被动 Effect 依次读取并改写它。
     * When：提交组件，由 act 冲刷布局与被动 Effect，再调用一次 flushPassiveEffects。
     * Then：两个 Effect 都观察到前一阶段提交的值，且不产生访问告警。
     *
     * 验证机制：逐次断言 `123 → 456 → 789`，同时覆盖布局阶段与被动阶段。
     * 对应源码：ref 是普通对象；layout 与 passive Effect 按提交阶段依次修改同一 current 槽。
     */
    it('should not warn about reads or writes within effect', async () => {
      /** 在 Layout Effect 和 Passive Effect 中串联读取、写入同一个 ref。 */
      function Example() {
        const ref = useRef(123);
        useLayoutEffect(() => {
          expect(ref.current).toBe(123);
          ref.current = 456;
          expect(ref.current).toBe(456);
        }, []);
        useEffect(() => {
          expect(ref.current).toBe(456);
          ref.current = 789;
          expect(ref.current).toBe(789);
        }, []);
        return null;
      }

      await act(() => {
        ReactNoop.render(<Example />);
      });

      ReactNoop.flushPassiveEffects();
    });

    /**
     * Given：组件已提交并把 ref 对象暴露给模拟事件步骤。
     * When：在渲染阶段之外读取、改写并再次读取 `current`。
     * Then：值从 `123` 更新为 `456`，且不产生开发态告警。
     *
     * 验证机制：挂载后的两次读取断言 123→456；本用例没有再次 render 来单独验证跨 render 身份。
     * 对应源码：`mountRef()` 返回普通 current 对象，渲染外可直接读写该字段。
     */
    it('should not warn about reads or writes outside of render phase (e.g. event handler)', async () => {
      let ref;
      /** 创建 ref 并把对象暴露给渲染外的模拟事件处理步骤。 */
      function Example() {
        ref = useRef(123);
        return null;
      }

      await act(() => {
        ReactNoop.render(<Example />);
      });

      expect(ref.current).toBe(123);
      ref.current = 456;
      expect(ref.current).toBe(456);
    });
  }
});
