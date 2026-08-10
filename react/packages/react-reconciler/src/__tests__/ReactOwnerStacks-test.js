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
let ReactNoopServer;
let Scheduler;
let act;
let advanceTimersByTime;
let assertLog;
let serverAct;
let waitFor;

/** 验证开发 owner stack 的捕获上下文、调用点链、限流截断及 Fiber/Fizz 挂起续跑的重置策略。 */
describe('ReactOwnerStacks', () => {
  /** 安装确定性 performance 时钟与 timer 推进入口，重置模块并绑定客户端/服务端渲染工具。 */
  beforeEach(function () {
    let time = 10;
    /** 同时推进 Jest timer 和本地 performance 时钟，保持限流窗口的两个时间源一致。 */
    advanceTimersByTime = timeMS => {
      jest.advanceTimersByTime(timeMS);
      time += timeMS;
    };

    /** 每次读取递增 1ms 的 performance.now 替身，使 owner 调用点限流可确定复现。 */
    const now = jest.fn().mockImplementation(() => {
      return time++;
    });
    Object.defineProperty(performance, 'timeOrigin', {
      value: time,
      configurable: true,
    });
    Object.defineProperty(performance, 'now', {
      value: now,
      configurable: true,
    });

    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    ReactNoopServer = require('react-noop-renderer/server');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    serverAct = require('internal-test-utils').serverAct;
    waitFor = require('internal-test-utils').waitFor;
  });

  /** 把真实文件/行列调用点归一化为 (at **)，仅保留 owner 名称与顺序供稳定断言。 */
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      str.replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }

  /** Given–When–Then：Given生产构建；When检查 captureOwnerStack 导出；Then fb 构建保留值为 undefined 的属性，其他构建完全不导出。通过属性存在性验证条件导出边界。 */
  it('behavior in production', () => {
    if (!__DEV__) {
      if (gate('fb')) {
        expect(React).toHaveProperty('captureOwnerStack', undefined);
      } else {
        expect(React).not.toHaveProperty('captureOwnerStack');
      }
    }
  });

  /** Given–When–Then：Given Foo 创建 Bar、Bar 创建 Baz；When Baz render 中调用 captureOwnerStack；Then返回 Bar→Foo 的 owner 链，不包含宿主 div。通过规范化调用点后的字符串验证 owner 而非 parent Fiber。 */
  // @gate __DEV__
  it('can get the component owner stacks during rendering in dev', async () => {
    let stack;

    /** 创建 Bar 的直接 owner，作为 owner 链外层节点。 */
    function Foo() {
      return <Bar />;
    }
    /** 经宿主 div 创建 Baz；证明 owner 栈忽略宿主父子层级。 */
    function Bar() {
      return (
        <div>
          <Baz />
        </div>
      );
    }
    /** 在 render 内捕获当前 owner stack，并返回稳定 span。 */
    function Baz() {
      stack = React.captureOwnerStack();
      return <span>hi</span>;
    }

    await act(() => {
      ReactNoop.render(
        <div>
          <Foo />
        </div>,
      );
    });

    expect(normalizeCodeLocInfo(stack)).toBe(
      '\n    in Bar (at **)' + '\n    in Foo (at **)',
    );
  });

  /** Given–When–Then：Given调用发生在 render 前和一次提交后；When直接执行 captureOwnerStack；Then两次都返回 null。验证 owner 栈只在开发 render 上下文中可用。 */
  it('returns null outside of render', async () => {
    // 难以用 gate 表达：部分生产构建仍保留 captureOwnerStack，但只返回 null。
    if (__DEV__) {
      expect(React.captureOwnerStack()).toBe(null);

      await act(() => {
        ReactNoop.render(<div />);
      });

      expect(React.captureOwnerStack()).toBe(null);
    }
  });

  /** Given–When–Then：Given大量兄弟创建调用点直到 ownerStackLimit；When立即重渲染、再推进 1001ms 后第三次渲染；Then variant 在截断后返回 UnknownOwner，时间窗口重置后重新允许捕获。通过栈值和零残留 timer 验证限流与定时重置。 */
  // @gate __DEV__
  it('cuts off at the owner stack limit', async () => {
    /** 生成指定数量的无输出兄弟，再依次渲染两个捕获点以跨过 ownerStackLimit。 */
    function App({siblingsBeforeStackOne}) {
      const children = [];
      for (
        let i = 0;
        i <
        siblingsBeforeStackOne -
          // <App /> 的调用点。
          1 -
          // 预留一个位置，使 OwnerStackOne 恰好位于截断前。
          1;
        i++
      ) {
        children.push(<Component key={i} />);
      }
      children.push(<OwnerStackOne key="stackOne" />);
      children.push(<OwnerStackTwo key="stackTwo" />);

      return children;
    }

    /** 不产生输出的兄弟，仅用于消耗 owner stack 调用点捕获额度。 */
    function Component() {
      return null;
    }

    let stackOne;
    /** 在截断前捕获第一份 owner 栈，并于异步场景记录 render 到达点。 */
    function OwnerStackOne() {
      stackOne = React.captureOwnerStack();
    }

    let stackTwo;
    /** 在截断后或 ping 续跑后捕获第二份栈，用于判断额度是否重置。 */
    function OwnerStackTwo() {
      stackTwo = React.captureOwnerStack();
    }

    await act(() => {
      ReactNoop.render(
        <App
          key="one"
          // variant 中使用 ownerStackLimit 对应规模，确保可观察截断。
          siblingsBeforeStackOne={500}
        />,
      );
    });

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      pendingTimers: 0,
      stackOne: '\n    in App (at **)',
      stackTwo: __VARIANT__
        ? // 在截断后立即捕获。
          '\n    in UnknownOwner (at **)'
        : // 非 variant 构建不会达到该上限。
          '\n    in App (at **)',
    });

    await act(() => {
      ReactNoop.render(
        <App
          // TODO: Owner Stack 应在重新渲染时更新。
          key="two"
          siblingsBeforeStackOne={0}
        />,
      );
    });

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      pendingTimers: 0,
      stackOne: __VARIANT__
        ? // 立即重渲染，尚未经过足够时间重置上限。
          '\n    in UnknownOwner (at **)'
        : // 非 variant 构建不会达到该上限。
          '\n    in App (at **)',
      stackTwo: __VARIANT__
        ? // 立即重渲染，尚未经过足够时间重置上限。
          '\n    in UnknownOwner (at **)'
        : // 非 variant 构建不会达到该上限。
          '\n    in App (at **)',
    });

    // 推进超过重置间隔的时间，开启新的捕获额度。
    advanceTimersByTime(1001);

    await act(() => {
      ReactNoop.render(
        <App
          // TODO: Owner Stack 应在重新渲染时更新。
          key="three"
          // 重置发生在 <App /> 之后，因此需要多渲染一个兄弟，
          // 才能复现初次 key=one 的相同截断位置。
          siblingsBeforeStackOne={501}
        />,
      );
    });

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      pendingTimers: 0,
      stackOne: '\n    in App (at **)',
      stackTwo: __VARIANT__
        ? // 在截断后立即捕获。
          '\n    in UnknownOwner (at **)'
        : // 非 variant 构建不会达到该上限。
          '\n    in App (at **)',
    });
  });

  /** Given–When–Then：Given Fiber render 达到 owner 栈上限，OwnerStackDelayed 因 1000ms promise 挂起；When timer 解决后通过 ping 继续同一 render；Then不会在续跑中重置上限，variant 仍得到 UnknownOwner。通过分片日志、timer 数和栈验证重置只在新 render 开始。 */
  // @gate __DEV__
  it('Fiber: resets the owner stack limit periodically', async () => {
    /** 生成直到限流边界的兄弟，并追加即时与 promise 延迟的两个捕获点。 */
    function App({siblingsBeforeStackOne, timeout}) {
      const children = [];
      for (
        let i = 0;
        i <
        siblingsBeforeStackOne -
          // <App /> 的调用点。
          1 -
          // 预留一个位置，使 OwnerStackOne 恰好位于截断前。
          1;
        i++
      ) {
        children.push(<Component key={i} />);
      }
      children.push(<OwnerStackOne key="stackOne" />);
      children.push(<OwnerStackDelayed key="stackTwo" timeout={timeout} />);

      return children;
    }

    /** 不产生输出的兄弟，仅用于消耗 owner stack 调用点捕获额度。 */
    function Component() {
      return null;
    }

    let stackOne;
    /** 在截断前捕获第一份 owner 栈，并于异步场景记录 render 到达点。 */
    function OwnerStackOne() {
      Scheduler.log('render OwnerStackOne');
      stackOne = React.captureOwnerStack();
    }

    let stackTwo;
    /** 在截断后或 ping 续跑后捕获第二份栈，用于判断额度是否重置。 */
    function OwnerStackTwo() {
      Scheduler.log('render OwnerStackTwo');
      stackTwo = React.captureOwnerStack();
    }
    /** 先 use(timeout) 挂起；promise 解决后再渲染 OwnerStackTwo，制造跨时间的同轮续跑。 */
    function OwnerStackDelayed({timeout}) {
      Scheduler.log('render OwnerStackDelayed');
      React.use(timeout);
      return <OwnerStackTwo />;
    }

    React.startTransition(() => {
      ReactNoop.render(
        <App
          key="one"
          // variant 中使用 ownerStackLimit 对应规模，确保可观察截断。
          siblingsBeforeStackOne={500}
          timeout={
            new Promise(resolve =>
              setTimeout(
                resolve,
                // 必须大于或等于 owner 栈额度重置间隔。
                1000,
              ),
            )
          }
        />,
      );
    });

    await waitFor(['render OwnerStackOne', 'render OwnerStackDelayed']);

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      // 唯一 pending timer 来自 timeout。
      pendingTimers: 1,
      stackOne: '\n    in App (at **)',
      stackTwo: undefined,
    });

    // 推进 timer 以解决 timeout promise。
    advanceTimersByTime(1000);

    await waitFor(['render OwnerStackDelayed', 'render OwnerStackTwo']);

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      pendingTimers: 0,
      stackOne: '\n    in App (at **)',
      stackTwo: __VARIANT__
        ? // Fiber 只有开始新 render 才重置额度；
          // 此处只是 ping 后续跑。
          '\n    in UnknownOwner (at **)' + '\n    in UnknownOwner (at **)'
        : // 非 variant 构建不会达到该上限。
          '\n    in OwnerStackDelayed (at **)' + '\n    in App (at **)',
    });
  });

  /** Given–When–Then：Given Fizz 服务端 render 达到上限并因 promise 挂起；When serverAct 推进 1000ms 恢复 segment；Then与 Fiber ping 一致，续跑不会开启新限流窗口。通过服务端日志、timer 与 owner 栈验证 Fizz 路径。 */
  // @gate __DEV__
  it('Fizz: resets the owner stack limit periodically', async () => {
    /** 生成直到限流边界的兄弟，并追加即时与 promise 延迟的两个捕获点。 */
    function App({siblingsBeforeStackOne, timeout}) {
      const children = [];
      for (
        let i = 0;
        i <
        siblingsBeforeStackOne -
          // <App /> 的调用点。
          1 -
          // 预留一个位置，使 OwnerStackOne 恰好位于截断前。
          1;
        i++
      ) {
        children.push(<Component key={i} />);
      }
      children.push(<OwnerStackOne key="stackOne" />);
      children.push(<OwnerStackDelayed key="stackTwo" timeout={timeout} />);

      return children;
    }

    /** 不产生输出的兄弟，仅用于消耗 owner stack 调用点捕获额度。 */
    function Component() {
      return null;
    }

    let stackOne;
    /** 在截断前捕获第一份 owner 栈，并于异步场景记录 render 到达点。 */
    function OwnerStackOne() {
      Scheduler.log('render OwnerStackOne');
      stackOne = React.captureOwnerStack();
    }

    let stackTwo;
    /** 在截断后或 ping 续跑后捕获第二份栈，用于判断额度是否重置。 */
    function OwnerStackTwo() {
      Scheduler.log('render OwnerStackTwo');
      stackTwo = React.captureOwnerStack();
    }
    /** 先 use(timeout) 挂起；promise 解决后再渲染 OwnerStackTwo，制造跨时间的同轮续跑。 */
    function OwnerStackDelayed({timeout}) {
      Scheduler.log('render OwnerStackDelayed');
      React.use(timeout);
      return <OwnerStackTwo />;
    }

    ReactNoopServer.render(
      <App
        key="one"
        // variant 中使用 ownerStackLimit 对应规模，确保可观察截断。
        siblingsBeforeStackOne={500}
        timeout={
          new Promise(resolve =>
            setTimeout(
              resolve,
              // 必须大于或等于 owner 栈额度重置间隔。
              1000,
            ),
          )
        }
      />,
    );

    assertLog(['render OwnerStackOne', 'render OwnerStackDelayed']);

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      // 唯一 pending timer 来自 timeout。
      pendingTimers: 1,
      stackOne: '\n    in App (at **)',
      stackTwo: undefined,
    });

    await serverAct(() => {
      advanceTimersByTime(1000);
    });

    expect({
      pendingTimers: jest.getTimerCount(),
      stackOne: normalizeCodeLocInfo(stackOne),
      stackTwo: normalizeCodeLocInfo(stackTwo),
    }).toEqual({
      pendingTimers: 0,
      stackOne: '\n    in App (at **)',
      stackTwo: __VARIANT__
        ? // Fiber 只有开始新 render 才重置额度；
          // 此处只是 ping 后续跑。
          '\n    in UnknownOwner (at **)' + '\n    in UnknownOwner (at **)'
        : // 非 variant 构建不会达到该上限。
          '\n    in OwnerStackDelayed (at **)' + '\n    in App (at **)',
    });
  });
});
