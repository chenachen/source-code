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

import {useInsertionEffect} from 'react';

/** 验证 `useEffectEvent` 的提交时更新、闭包新鲜度、调用阶段限制与 Activity 集成。 */
describe('useEffectEvent', () => {
  let React;
  let ReactNoop;
  let Scheduler;
  let act;
  let createContext;
  let useContext;
  let useState;
  let useEffectEvent;
  let useEffect;
  let useLayoutEffect;
  let useMemo;
  let waitForAll;
  let assertLog;
  let waitForThrow;
  let waitFor;

  /** 每个用例重置模块，并重新绑定 Effect Event、各类 Effect、Noop 渲染器与断言工具。 */
  beforeEach(() => {
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    act = require('internal-test-utils').act;
    createContext = React.createContext;
    useContext = React.useContext;
    useState = React.useState;
    useEffectEvent = React.useEffectEvent;
    useEffect = React.useEffect;
    useLayoutEffect = React.useLayoutEffect;
    useMemo = React.useMemo;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitForThrow = InternalTestUtils.waitForThrow;
    waitFor = InternalTestUtils.waitFor;
  });

  /** 把输入同步到调度日志与宿主输出；服务于“验证 `useEffectEvent` 的提交时更新、闭包新鲜度、调用阶段限制与 Activity 集成”场景。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /**
   * Given：更新 state 和 props 后调用 Effect Event，确认函数读取最新已提交闭包所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：更新 state 和 props 后调用 Effect Event，确认函数读取最新已提交闭包。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('memoizes basic case correctly', async () => {
    /** 定义 IncrementButton 类 fixture，在“更新 state 和 props 后调用 Effect Event，确认函数读取最新已提交闭包”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“更新 state 和 props 后调用 Effect Event，确认函数读取最新已提交闭包”场景。 */
    function Counter({incrementBy}) {
      const [count, updateCount] = useState(0);
      const onClick = useEffectEvent(() => updateCount(c => c + incrementBy));

      return (
        <>
          <IncrementButton onClick={() => onClick()} ref={button} />
          <Text text={'Count: ' + count} />
        </>
      );
    }

    const button = React.createRef(null);
    ReactNoop.render(<Counter incrementBy={1} />);
    await waitForAll(['Increment', 'Count: 0']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 0" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog(['Increment', 'Count: 1']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 1" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 事件应调用更新后的回调，并读取其闭包中的新值。
      'Count: 2',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 2" />
      </>,
    );

    // 增大 increment 属性值。
    ReactNoop.render(<Counter incrementBy={10} />);
    await waitForAll(['Increment', 'Count: 2']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 2" />
      </>,
    );

    // 事件读取新的属性值。
    await act(() => button.current.increment());
    assertLog(['Increment', 'Count: 12']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 12" />
      </>,
    );
  });

  /**
   * Given：在同一组件定义多个 Effect Event，确认各自队列与闭包互不覆盖所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在同一组件定义多个 Effect Event，确认各自队列与闭包互不覆盖。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('can be defined more than once', async () => {
    /** 定义 IncrementButton 类 fixture，在“在同一组件定义多个 Effect Event，确认各自队列与闭包互不覆盖”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** IncrementButton.multiply 封装 multiply 行为，并把结果暴露给当前场景的日志或断言。 */
      multiply = () => {
        this.props.onMouseEnter();
      };
      /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“在同一组件定义多个 Effect Event，确认各自队列与闭包互不覆盖”场景。 */
    function Counter({incrementBy}) {
      const [count, updateCount] = useState(0);
      const onClick = useEffectEvent(() => updateCount(c => c + incrementBy));
      const onMouseEnter = useEffectEvent(() => {
        updateCount(c => c * incrementBy);
      });

      return (
        <>
          <IncrementButton
            onClick={() => onClick()}
            onMouseEnter={() => onMouseEnter()}
            ref={button}
          />
          <Text text={'Count: ' + count} />
        </>
      );
    }

    const button = React.createRef(null);
    ReactNoop.render(<Counter incrementBy={5} />);
    await waitForAll(['Increment', 'Count: 0']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 0" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog(['Increment', 'Count: 5']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 5" />
      </>,
    );

    await act(() => button.current.multiply());
    assertLog(['Increment', 'Count: 25']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 25" />
      </>,
    );
  });

  /**
   * Given：通过对象方法调用 Effect Event，确认包装函数不会隐式保留调用方 `this`所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：通过对象方法调用 Effect Event，确认包装函数不会隐式保留调用方 `this`。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('does not preserve `this` in event functions', async () => {
    /** 定义 GreetButton 类 fixture，在“通过对象方法调用 Effect Event，确认包装函数不会隐式保留调用方 `this`”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class GreetButton extends React.PureComponent {
      /** GreetButton.greet 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      greet = () => {
        this.props.onClick();
      };
      /** 渲染 GreetButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text={'Say ' + this.props.hello} />;
      }
    }
    /** 作为 Greeter fixture 承载当前测试职责；服务于“通过对象方法调用 Effect Event，确认包装函数不会隐式保留调用方 `this`”场景。 */
    function Greeter({hello}) {
      const person = {
        /** Greeter.toString 提供可辨识的实例字符串，验证 Effect Event 不会继承调用方 `this`。 */
        toString() {
          return 'Jane';
        },
        /** Greeter.greet 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
        greet() {
          return updateGreeting(this + ' says ' + hello);
        },
      };
      const [greeting, updateGreeting] = useState('Seb says ' + hello);
      const onClick = useEffectEvent(person.greet);

      return (
        <>
          <GreetButton hello={hello} onClick={() => onClick()} ref={button} />
          <Text text={'Greeting: ' + greeting} />
        </>
      );
    }

    const button = React.createRef(null);
    ReactNoop.render(<Greeter hello={'hej'} />);
    await waitForAll(['Say hej', 'Greeting: Seb says hej']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Say hej" />
        <span prop="Greeting: Seb says hej" />
      </>,
    );

    await act(() => button.current.greet());
    assertLog(['Say hej', 'Greeting: undefined says hej']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Say hej" />
        <span prop="Greeting: undefined says hej" />
      </>,
    );
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在渲染阶段直接调用 Effect Event，确认开发态抛出阶段边界错误。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`useEffectEventImpl()` 的渲染阶段调用保护。
   */
  it('throws when called in render', async () => {
    /** 定义 IncrementButton 类 fixture，在“在渲染阶段直接调用 Effect Event，确认开发态抛出阶段边界错误”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };

      /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
    // 此调用应抛错。
        this.props.onClick();

        return <Text text="Increment" />;
      }
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“在渲染阶段直接调用 Effect Event，确认开发态抛出阶段边界错误”场景。 */
    function Counter({incrementBy}) {
      const [count, updateCount] = useState(0);
      const onClick = useEffectEvent(() => updateCount(c => c + incrementBy));

      return (
        <>
          <IncrementButton onClick={() => onClick()} />
          <Text text={'Count: ' + count} />
        </>
      );
    }

    ReactNoop.render(<Counter incrementBy={1} />);
    await waitForThrow(
      "A function wrapped in useEffectEvent can't be called during rendering.",
    );
    assertLog([]);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：事件闭包随更新变化时保持 Layout Effect 依赖稳定，同时让事件读到新值。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it("useLayoutEffect shouldn't re-fire when event handlers change", async () => {
    /** 定义 IncrementButton 类 fixture，在“事件闭包随更新变化时保持 Layout Effect 依赖稳定，同时让事件读到新值”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“事件闭包随更新变化时保持 Layout Effect 依赖稳定，同时让事件读到新值”场景。 */
    function Counter({incrementBy}) {
      const [count, updateCount] = useState(0);
      const increment = useEffectEvent(amount =>
        updateCount(c => c + (amount || incrementBy)),
      );

      useLayoutEffect(() => {
        Scheduler.log('Effect: by ' + incrementBy * 2);
        increment(incrementBy * 2);
      }, [incrementBy]);

      return (
        <>
          <IncrementButton onClick={() => increment()} ref={button} />
          <Text text={'Count: ' + count} />
        </>
      );
    }

    const button = React.createRef(null);
    ReactNoop.render(<Counter incrementBy={1} />);
    assertLog([]);
    await waitForAll([
      'Increment',
      'Count: 0',
      'Effect: by 2',
      'Increment',
      'Count: 2',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 2" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 依赖未变，因此 Effect 不应重新执行。
      'Count: 3',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 3" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 事件应调用更新后的回调，并读取其闭包中的新值。
      'Count: 4',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 4" />
      </>,
    );

    // 增大 increment 属性值。
    ReactNoop.render(<Counter incrementBy={10} />);
    await waitForAll([
      'Increment',
      'Count: 4',
      'Effect: by 20',
      'Increment',
      'Count: 24',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 24" />
      </>,
    );

    // 事件读取新的属性值。
    await act(() => button.current.increment());
    assertLog(['Increment', 'Count: 34']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 34" />
      </>,
    );
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：事件闭包随更新变化时保持 Passive Effect 依赖稳定，同时让事件读到新值。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it("useEffect shouldn't re-fire when event handlers change", async () => {
    /** 定义 IncrementButton 类 fixture，在“事件闭包随更新变化时保持 Passive Effect 依赖稳定，同时让事件读到新值”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“事件闭包随更新变化时保持 Passive Effect 依赖稳定，同时让事件读到新值”场景。 */
    function Counter({incrementBy}) {
      const [count, updateCount] = useState(0);
      const increment = useEffectEvent(amount =>
        updateCount(c => c + (amount || incrementBy)),
      );

      useEffect(() => {
        Scheduler.log('Effect: by ' + incrementBy * 2);
        increment(incrementBy * 2);
      }, [incrementBy]);

      return (
        <>
          <IncrementButton onClick={() => increment()} ref={button} />
          <Text text={'Count: ' + count} />
        </>
      );
    }

    const button = React.createRef(null);
    ReactNoop.render(<Counter incrementBy={1} />);
    await waitForAll([
      'Increment',
      'Count: 0',
      'Effect: by 2',
      'Increment',
      'Count: 2',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 2" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 依赖未变，因此 Effect 不应重新执行。
      'Count: 3',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 3" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 事件应调用更新后的回调，并读取其闭包中的新值。
      'Count: 4',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 4" />
      </>,
    );

    // 增大 increment 属性值。
    ReactNoop.render(<Counter incrementBy={10} />);
    await waitForAll([
      'Increment',
      'Count: 4',
      'Effect: by 20',
      'Increment',
      'Count: 24',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 24" />
      </>,
    );

    // 事件读取新的属性值。
    await act(() => button.current.increment());
    assertLog(['Increment', 'Count: 34']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 34" />
      </>,
    );
  });

  /**
   * Given：自定义 Hook 返回 Effect Event，确认调用方 Effect 不因闭包变化重新订阅所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：自定义 Hook 返回 Effect Event，确认调用方 Effect 不因闭包变化重新订阅。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('is stable in a custom hook', async () => {
    /** 定义 IncrementButton 类 fixture，在“自定义 Hook 返回 Effect Event，确认调用方 Effect 不因闭包变化重新订阅”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 作为自定义 Hook 封装当前机制并向调用组件返回稳定入口；服务于“自定义 Hook 返回 Effect Event，确认调用方 Effect 不因闭包变化重新订阅”场景。 */
    function useCount(incrementBy) {
      const [count, updateCount] = useState(0);
      const increment = useEffectEvent(amount =>
        updateCount(c => c + (amount || incrementBy)),
      );

      return [count, increment];
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“自定义 Hook 返回 Effect Event，确认调用方 Effect 不因闭包变化重新订阅”场景。 */
    function Counter({incrementBy}) {
      const [count, increment] = useCount(incrementBy);

      useEffect(() => {
        Scheduler.log('Effect: by ' + incrementBy * 2);
        increment(incrementBy * 2);
      }, [incrementBy]);

      return (
        <>
          <IncrementButton onClick={() => increment()} ref={button} />
          <Text text={'Count: ' + count} />
        </>
      );
    }

    const button = React.createRef(null);
    ReactNoop.render(<Counter incrementBy={1} />);
    await waitForAll([
      'Increment',
      'Count: 0',
      'Effect: by 2',
      'Increment',
      'Count: 2',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 2" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 依赖未变，因此 Effect 不应重新执行。
      'Count: 3',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 3" />
      </>,
    );

    await act(() => button.current.increment());
    assertLog([
      'Increment',
    // 事件应调用更新后的回调，并读取其闭包中的新值。
      'Count: 4',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 4" />
      </>,
    );

    // 增大 increment 属性值。
    ReactNoop.render(<Counter incrementBy={10} />);
    await waitForAll([
      'Increment',
      'Count: 4',
      'Effect: by 20',
      'Increment',
      'Count: 24',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 24" />
      </>,
    );

    // 事件读取新的属性值。
    await act(() => button.current.increment());
    assertLog(['Increment', 'Count: 34']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Increment" />
        <span prop="Count: 34" />
      </>,
    );
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：把事件声明放在 Insertion Effect 之后，确认提交时仍先更新事件实现。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`useEffectEventImpl()`、`mountEvent()` 与 `updateEvent()` 的提交队列。
   */
  it('is mutated before all other effects', async () => {
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“把事件声明放在 Insertion Effect 之后，确认提交时仍先更新事件实现”场景。 */
    function Counter({value}) {
      useInsertionEffect(() => {
        Scheduler.log('Effect value: ' + value);
        increment();
      }, [value]);

      // 虽然事件声明位于 Insertion Effect 之后，但事件实现应在该 Effect 执行前更新。
      const increment = useEffectEvent(() => {
        Scheduler.log('Event value: ' + value);
      });

      return <></>;
    }

    ReactNoop.render(<Counter value={1} />);
    await waitForAll(['Effect value: 1', 'Event value: 1']);

    await act(() => ReactNoop.render(<Counter value={2} />));
    assertLog(['Effect value: 2', 'Event value: 2']);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：交错注册事件、Insertion、Layout 与 Passive Effect，确认事件闭包先于各阶段可见。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`useEffectEventImpl()`、`mountEvent()` 与 `updateEvent()` 的提交队列。
   */
  it('fires all (interleaved) effects with useEffectEvent in correct order', async () => {
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“交错注册事件、Insertion、Layout 与 Passive Effect，确认事件闭包先于各阶段可见”场景。 */
    function CounterA({count}) {
      const onEvent = useEffectEvent(() => {
        return `A ${count}`;
      });

      useInsertionEffect(() => {
      // 调用事件函数，确认它读取到最新值。
        Scheduler.log(`Parent Insertion Create: ${onEvent()}`);
        return () => {
          Scheduler.log(`Parent Insertion Create: ${onEvent()}`);
        };
      });

      useLayoutEffect(() => {
        Scheduler.log(`Parent Layout Create: ${onEvent()}`);
        return () => {
          Scheduler.log(`Parent Layout Cleanup: ${onEvent()}`);
        };
      });

      useEffect(() => {
        Scheduler.log(`Parent Passive Create: ${onEvent()}`);
        return () => {
          Scheduler.log(`Parent Passive Destroy ${onEvent()}`);
        };
      });

      // 此调用刻意违反使用规则，只用于确认提交顺序正确。
      return <CounterB count={count} onEventParent={onEvent} />;
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“交错注册事件、Insertion、Layout 与 Passive Effect，确认事件闭包先于各阶段可见”场景。 */
    function CounterB({count, onEventParent}) {
      const onEvent = useEffectEvent(() => {
        return `${onEventParent()} B ${count}`;
      });

      useInsertionEffect(() => {
        Scheduler.log(`Child Insertion Create ${onEvent()}`);
        return () => {
          Scheduler.log(`Child Insertion Destroy ${onEvent()}`);
        };
      });

      useLayoutEffect(() => {
        Scheduler.log(`Child Layout Create ${onEvent()}`);
        return () => {
          Scheduler.log(`Child Layout Destroy ${onEvent()}`);
        };
      });

      useEffect(() => {
        Scheduler.log(`Child Passive Create ${onEvent()}`);
        return () => {
          Scheduler.log(`Child Passive Destroy ${onEvent()}`);
        };
      });

      return null;
    }

    await act(async () => {
      ReactNoop.render(<CounterA count={1} />);
    });

    assertLog([
      'Child Insertion Create A 1 B 1',
      'Parent Insertion Create: A 1',
      'Child Layout Create A 1 B 1',
      'Parent Layout Create: A 1',
      'Child Passive Create A 1 B 1',
      'Parent Passive Create: A 1',
    ]);

    await act(async () => {
      ReactNoop.render(<CounterA count={2} />);
    });

    assertLog([
      'Child Insertion Destroy A 2 B 2',
      'Child Insertion Create A 2 B 2',
      'Child Layout Destroy A 2 B 2',
      'Parent Insertion Create: A 2',
      'Parent Insertion Create: A 2',
      'Parent Layout Cleanup: A 2',
      'Child Layout Create A 2 B 2',
      'Parent Layout Create: A 2',
      'Child Passive Destroy A 2 B 2',
      'Parent Passive Destroy A 2',
      'Child Passive Create A 2 B 2',
      'Parent Passive Create: A 2',
    ]);

    // 卸载全部内容。
    await act(async () => {
      ReactNoop.render(null);
    });

    assertLog([
      'Parent Insertion Create: A 2',
      'Parent Layout Cleanup: A 2',
      'Child Insertion Destroy A 2 B 2',
      'Child Layout Destroy A 2 B 2',
      'Parent Passive Destroy A 2',
      'Child Passive Destroy A 2 B 2',
    ]);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 Activity 隐藏、更新与显示之间调用事件，确认可见提交边界决定闭包新鲜度。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`useEffectEventImpl()`、`mountEvent()` 与 `updateEvent()` 的提交队列。
   */
  it('correctly mutates effect event with Activity', async () => {
    let setState;
    let setChildState;
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“在 Activity 隐藏、更新与显示之间调用事件，确认可见提交边界决定闭包新鲜度”场景。 */
    function CounterA({count, hideChild}) {
      const [state, _setState] = useState(1);
      setState = _setState;
      const onEvent = useEffectEvent(() => {
        return `A ${count} ${state}`;
      });

      useInsertionEffect(() => {
      // 调用事件函数，确认它读取到最新值。
        Scheduler.log(`Parent Insertion Create: ${onEvent()}`);
        return () => {
          Scheduler.log(`Parent Insertion Create: ${onEvent()}`);
        };
      });

      useLayoutEffect(() => {
        Scheduler.log(`Parent Layout Create: ${onEvent()}`);
        return () => {
          Scheduler.log(`Parent Layout Cleanup: ${onEvent()}`);
        };
      });

      // 此调用刻意违反使用规则，只用于确认提交顺序正确。
      return (
        <React.Activity mode={hideChild ? 'hidden' : 'visible'}>
          <CounterB count={count} state={state} onEventParent={onEvent} />
        </React.Activity>
      );
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“在 Activity 隐藏、更新与显示之间调用事件，确认可见提交边界决定闭包新鲜度”场景。 */
    function CounterB({count, state, onEventParent}) {
      const [childState, _setChildState] = useState(1);
      setChildState = _setChildState;
      const onEvent = useEffectEvent(() => {
        return `${onEventParent()} B ${count} ${state} ${childState}`;
      });

      useInsertionEffect(() => {
        Scheduler.log(`Child Insertion Create ${onEvent()}`);
        return () => {
          Scheduler.log(`Child Insertion Destroy ${onEvent()}`);
        };
      });

      useLayoutEffect(() => {
        Scheduler.log(`Child Layout Create ${onEvent()}`);
        return () => {
          Scheduler.log(`Child Layout Destroy ${onEvent()}`);
        };
      });

      useEffect(() => {
        Scheduler.log(`Child Passive Create ${onEvent()}`);
        return () => {
          Scheduler.log(`Child Passive Destroy ${onEvent()}`);
        };
      });

      return null;
    }

    await act(async () => {
      ReactNoop.render(<CounterA count={1} hideChild={true} />);
      await waitFor([
        'Parent Insertion Create: A 1 1',
        'Parent Layout Create: A 1 1',
        'Child Insertion Create A 1 1 B 1 1 1',
      ]);
    });

    assertLog([]);

    await act(async () => {
      ReactNoop.render(<CounterA count={2} hideChild={true} />);

      await waitFor([
        'Parent Insertion Create: A 2 1',
        'Parent Insertion Create: A 2 1',
        'Parent Layout Cleanup: A 2 1',
        'Parent Layout Create: A 2 1',
        ...(gate('enableViewTransition') &&
        !gate('enableEffectEventMutationPhase')
          ? [
              'Child Insertion Destroy A 2 1 B 1 1 1',
              'Child Insertion Create A 2 1 B 1 1 1',
            ]
          : [
              'Child Insertion Destroy A 2 1 B 2 1 1',
              'Child Insertion Create A 2 1 B 2 1 1',
            ]),
      ]);
    });

    assertLog([]);

    await act(async () => {
      setState(2);

      await waitFor([
        'Parent Insertion Create: A 2 2',
        'Parent Insertion Create: A 2 2',
        'Parent Layout Cleanup: A 2 2',
        'Parent Layout Create: A 2 2',
        ...(gate('enableViewTransition') &&
        !gate('enableEffectEventMutationPhase')
          ? [
              'Child Insertion Destroy A 2 2 B 1 1 1',
              'Child Insertion Create A 2 2 B 1 1 1',
            ]
          : [
              'Child Insertion Destroy A 2 2 B 2 2 1',
              'Child Insertion Create A 2 2 B 2 2 1',
            ]),
      ]);
    });

    assertLog([]);

    await act(async () => {
      setChildState(2);

      await waitFor(
        gate('enableViewTransition') && !gate('enableEffectEventMutationPhase')
          ? [
              'Child Insertion Destroy A 2 2 B 1 1 1',
              'Child Insertion Create A 2 2 B 1 1 1',
            ]
          : [
              'Child Insertion Destroy A 2 2 B 2 2 2',
              'Child Insertion Create A 2 2 B 2 2 2',
            ],
      );
    });

    assertLog([]);

    await act(async () => {
      ReactNoop.render(<CounterA count={3} hideChild={true} />);

      await waitFor([
        'Parent Insertion Create: A 3 2',
        'Parent Insertion Create: A 3 2',
        'Parent Layout Cleanup: A 3 2',
        'Parent Layout Create: A 3 2',
      ]);
    });

    assertLog(
      gate('enableViewTransition') && !gate('enableEffectEventMutationPhase')
        ? [
            'Child Insertion Destroy A 3 2 B 1 1 1',
            'Child Insertion Create A 3 2 B 1 1 1',
          ]
        : [
            'Child Insertion Destroy A 3 2 B 3 2 2',
            'Child Insertion Create A 3 2 B 3 2 2',
          ],
    );

    await act(async () => {
      ReactNoop.render(<CounterA count={3} hideChild={false} />);

      await waitFor([
        ...(gate('enableViewTransition') &&
        !gate('enableEffectEventMutationPhase')
          ? [
              'Child Insertion Destroy A 3 2 B 1 1 1',
              'Child Insertion Create A 3 2 B 1 1 1',
            ]
          : [
              'Child Insertion Destroy A 3 2 B 3 2 2',
              'Child Insertion Create A 3 2 B 3 2 2',
            ]),
        'Parent Insertion Create: A 3 2',
        'Parent Insertion Create: A 3 2',
        'Parent Layout Cleanup: A 3 2',
        ...(gate('enableViewTransition') &&
        !gate('enableEffectEventMutationPhase')
          ? ['Child Layout Create A 3 2 B 1 1 1']
          : ['Child Layout Create A 3 2 B 3 2 2']),

        'Parent Layout Create: A 3 2',
      ]);
    });

    assertLog(
      gate('enableViewTransition') && !gate('enableEffectEventMutationPhase')
        ? ['Child Passive Create A 3 2 B 1 1 1']
        : ['Child Passive Create A 3 2 B 3 2 2'],
    );

    await act(async () => {
      ReactNoop.render(<CounterA count={3} hideChild={true} />);

      await waitFor([
        ...(gate('enableViewTransition') &&
        !gate('enableEffectEventMutationPhase')
          ? ['Child Layout Destroy A 3 2 B 1 1 1']
          : ['Child Layout Destroy A 3 2 B 3 2 2']),
        'Parent Insertion Create: A 3 2',
        'Parent Insertion Create: A 3 2',
        'Parent Layout Cleanup: A 3 2',
        'Parent Layout Create: A 3 2',
        ...(gate('enableViewTransition') &&
        !gate('enableEffectEventMutationPhase')
          ? ['Child Passive Destroy A 3 2 B 1 1 1']
          : ['Child Passive Destroy A 3 2 B 3 2 2']),
      ]);
    });

    assertLog(
      gate('enableViewTransition') && !gate('enableEffectEventMutationPhase')
        ? [
            'Child Insertion Destroy A 3 2 B 1 1 1',
            'Child Insertion Create A 3 2 B 1 1 1',
          ]
        : [
            'Child Insertion Destroy A 3 2 B 3 2 2',
            'Child Insertion Create A 3 2 B 3 2 2',
          ],
    );

    // 卸载全部内容。
    await act(async () => {
      ReactNoop.render(null);
    });

    assertLog([
      'Parent Insertion Create: A 3 2',
      'Parent Layout Cleanup: A 3 2',
      gate('enableViewTransition') && !gate('enableEffectEventMutationPhase')
        ? 'Child Insertion Destroy A 3 2 B 1 1 1'
        : 'Child Insertion Destroy A 3 2 B 3 2 2',
    ]);
  });

  /**
   * Given：把 Effect Event 放入依赖数组，确认当前实验实现不承诺稳定函数身份所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：把 Effect Event 放入依赖数组，确认当前实验实现不承诺稳定函数身份。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it("doesn't provide a stable identity", async () => {
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“把 Effect Event 放入依赖数组，确认当前实验实现不承诺稳定函数身份”场景。 */
    function Counter({shouldRender, value}) {
      const onClick = useEffectEvent(() => {
        Scheduler.log(
          'onClick, shouldRender=' + shouldRender + ', value=' + value,
        );
      });

      // `onClick` 不保证函数身份稳定，因此该 Effect 每次渲染都会执行。真实应用不应把
      // `useEffectEvent` 返回函数放入依赖数组；此处仅用于测试身份语义。
      useEffect(() => {
        onClick();
      }, [onClick]);

      useEffect(() => {
        onClick();
      }, [shouldRender]);

      return <></>;
    }

    ReactNoop.render(<Counter shouldRender={true} value={0} />);
    await waitForAll([
      'onClick, shouldRender=true, value=0',
      'onClick, shouldRender=true, value=0',
    ]);

    ReactNoop.render(<Counter shouldRender={true} value={1} />);
    await waitForAll(['onClick, shouldRender=true, value=1']);

    ReactNoop.render(<Counter shouldRender={false} value={2} />);
    await waitForAll([
      'onClick, shouldRender=false, value=2',
      'onClick, shouldRender=false, value=2',
    ]);
  });

  /**
   * Given：外部事件系统长期持有处理器，更新后调用时读取最新已提交值而无需重新订阅所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：外部事件系统长期持有处理器，更新后调用时读取最新已提交值而无需重新订阅。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('event handlers always see the latest committed value', async () => {
    let committedEventHandler = null;

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“外部事件系统长期持有处理器，更新后调用时读取最新已提交值而无需重新订阅”场景。 */
    function App({value}) {
      const event = useEffectEvent(() => {
        return 'Value seen by useEffectEvent: ' + value;
      });

      // 用 Effect 把事件处理器注册到外部事件系统（例如 addEventListener）。
      useEffect(
        () => {
        // 记录 Effect 执行；下方断言要求它只在首次渲染发生，更新时不再执行。
          Scheduler.log('Commit new event handler');
          committedEventHandler = event;
          return () => {
            committedEventHandler = null;
          };
        },
      // 依赖数组刻意省略事件函数，但它仍能读取最新 `value`；这是 Effect Event 区别于普通闭包的关键。
        [],
      );
      return 'Latest rendered value ' + value;
    }

    // 首次渲染。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App value={1} />);
    });
    assertLog(['Commit new event handler']);
    expect(root).toMatchRenderedOutput('Latest rendered value 1');
    expect(committedEventHandler()).toBe('Value seen by useEffectEvent: 1');

    // 执行更新。
    await act(() => {
      root.render(<App value={2} />);
    });
    // 事件处理器未列入依赖，因此不应提交新的外部订阅。
    assertLog([]);
    // 但既有事件处理器仍应读取到最新值。
    expect(root).toMatchRenderedOutput('Latest rendered value 2');
    expect(committedEventHandler()).toBe('Value seen by useEffectEvent: 2');
  });

  /**
   * Given：按文档聊天室示例切换 room 与 theme，确认只有连接参数变化才重连所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：按文档聊天室示例切换 room 与 theme，确认只有连接参数变化才重连。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('integration: implements docs chat room example', async () => {
    /** 创建当前用例所需的外部连接、thenable 或可控 fixture；服务于“按文档聊天室示例切换 room 与 theme，确认只有连接参数变化才重连”场景。 */
    function createConnection() {
      let connectedCallback;
      let timeout;
      return {
        /** createConnection.connect 模拟外部连接生命周期，向日志暴露订阅、连接或断开动作。 */
        connect() {
          timeout = setTimeout(() => {
            if (connectedCallback) {
              connectedCallback();
            }
          }, 100);
        },
        /** createConnection.on 模拟外部连接生命周期，向日志暴露订阅、连接或断开动作。 */
        on(event, callback) {
          if (connectedCallback) {
            throw Error('Cannot add the handler twice.');
          }
          if (event !== 'connected') {
            throw Error('Only "connected" event is supported.');
          }
          connectedCallback = callback;
        },
        /** createConnection.disconnect 模拟外部连接生命周期，向日志暴露订阅、连接或断开动作。 */
        disconnect() {
          clearTimeout(timeout);
        },
      };
    }

    /** 作为 ChatRoom fixture 承载当前测试职责；服务于“按文档聊天室示例切换 room 与 theme，确认只有连接参数变化才重连”场景。 */
    function ChatRoom({roomId, theme}) {
      const onConnected = useEffectEvent(() => {
        Scheduler.log('Connected! theme: ' + theme);
      });

      useEffect(() => {
        const connection = createConnection(roomId);
        connection.on('connected', () => {
          onConnected();
        });
        connection.connect();
        return () => connection.disconnect();
      }, [roomId]);

      return <Text text={`Welcome to the ${roomId} room!`} />;
    }

    await act(() =>
      ReactNoop.render(<ChatRoom roomId="general" theme="light" />),
    );

    assertLog(['Welcome to the general room!', 'Connected! theme: light']);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Welcome to the general room!" />,
    );

    // 只改变 roomId。
    await act(() =>
      ReactNoop.render(<ChatRoom roomId="music" theme="light" />),
    );
    assertLog([
      'Welcome to the music room!',
    // 应触发重新连接。
      'Connected! theme: light',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Welcome to the music room!" />,
    );

    // 只改变 theme。
    await act(() => ReactNoop.render(<ChatRoom roomId="music" theme="dark" />));
    // 不应触发重新连接。
    assertLog(['Welcome to the music room!']);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Welcome to the music room!" />,
    );

    // 再次只改变 roomId。
    await act(() =>
      ReactNoop.render(<ChatRoom roomId="travel" theme="dark" />),
    );
    assertLog([
      'Welcome to the travel room!',
    // 应触发重新连接。
      'Connected! theme: dark',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Welcome to the travel room!" />,
    );
  });

  /**
   * Given：按文档访问日志示例更新购物车数量，确认页面事件读取最新数量而不重跑页面 Effect所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：按文档访问日志示例更新购物车数量，确认页面事件读取最新数量而不重跑页面 Effect。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('integration: implements the docs logVisit example', async () => {
    /** 定义 AddToCartButton 类 fixture，在“按文档访问日志示例更新购物车数量，确认页面事件读取最新数量而不重跑页面 Effect”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class AddToCartButton extends React.PureComponent {
      /** AddToCartButton.addToCart 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      addToCart = () => {
        this.props.onClick();
      };
      /** 渲染 AddToCartButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return <Text text="Add to cart" />;
      }
    }
    const ShoppingCartContext = createContext(null);

    /** 作为 AppShell fixture 承载当前测试职责；服务于“按文档访问日志示例更新购物车数量，确认页面事件读取最新数量而不重跑页面 Effect”场景。 */
    function AppShell({children}) {
      const [items, updateItems] = useState([]);
      const value = useMemo(() => ({items, updateItems}), [items, updateItems]);

      return (
        <ShoppingCartContext.Provider value={value}>
          {children}
        </ShoppingCartContext.Provider>
      );
    }

    /** 作为 Page fixture 承载当前测试职责；服务于“按文档访问日志示例更新购物车数量，确认页面事件读取最新数量而不重跑页面 Effect”场景。 */
    function Page({url}) {
      const {items, updateItems} = useContext(ShoppingCartContext);
      const onClick = useEffectEvent(() => updateItems([...items, 1]));
      const numberOfItems = items.length;

      const onVisit = useEffectEvent(visitedUrl => {
        Scheduler.log(
          'url: ' + visitedUrl + ', numberOfItems: ' + numberOfItems,
        );
      });

      useEffect(() => {
        onVisit(url);
      }, [url]);

      return (
        <AddToCartButton
          onClick={() => {
            onClick();
          }}
          ref={button}
        />
      );
    }

    const button = React.createRef(null);
    await act(() =>
      ReactNoop.render(
        <AppShell>
          <Page url="/shop/1" />
        </AppShell>,
      ),
    );
    assertLog(['Add to cart', 'url: /shop/1, numberOfItems: 0']);
    await act(() => button.current.addToCart());
    assertLog(['Add to cart']);

    await act(() =>
      ReactNoop.render(
        <AppShell>
          <Page url="/shop/2" />
        </AppShell>,
      ),
    );
    assertLog(['Add to cart', 'url: /shop/2, numberOfItems: 1']);
  });

  /**
   * Given：在 memo 或 forwardRef 组件中更新 Context，确认 Effect Event 读取最新上下文所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 memo 或 forwardRef 组件中更新 Context，确认 Effect Event 读取最新上下文。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('reads the latest context value in memo Components', async () => {
    const MyContext = createContext('default');

    let logContextValue;
    const ContextReader = React.memo(function ContextReader() {
      const value = useContext(MyContext);
      Scheduler.log('ContextReader: ' + value);
      const fireLogContextValue = useEffectEvent(() => {
        Scheduler.log('ContextReader (Effect event): ' + value);
      });
      useEffect(() => {
        logContextValue = fireLogContextValue;
      }, []);
      return null;
    });

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在 memo 或 forwardRef 组件中更新 Context，确认 Effect Event 读取最新上下文”场景。 */
    function App({value}) {
      return (
        <MyContext.Provider value={value}>
          <ContextReader />
        </MyContext.Provider>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<App value="first" />));
    assertLog(['ContextReader: first']);

    logContextValue();

    assertLog(['ContextReader (Effect event): first']);

    await act(() => root.render(<App value="second" />));
    assertLog(['ContextReader: second']);

    logContextValue();
    assertLog(['ContextReader (Effect event): second']);
  });

  /**
   * Given：在 memo 或 forwardRef 组件中更新 Context，确认 Effect Event 读取最新上下文所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 memo 或 forwardRef 组件中更新 Context，确认 Effect Event 读取最新上下文。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`mountEvent()` 与 `updateEvent()` 的事件包装和闭包更新。
   */
  it('reads the latest context value in forwardRef Components', async () => {
    const MyContext = createContext('default');

    let logContextValue;
    const ContextReader = React.forwardRef(function ContextReader(props, ref) {
      const value = useContext(MyContext);
      Scheduler.log('ContextReader: ' + value);
      const fireLogContextValue = useEffectEvent(() => {
        Scheduler.log('ContextReader (Effect event): ' + value);
      });
      useEffect(() => {
        logContextValue = fireLogContextValue;
      }, []);
      return null;
    });

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在 memo 或 forwardRef 组件中更新 Context，确认 Effect Event 读取最新上下文”场景。 */
    function App({value}) {
      return (
        <MyContext.Provider value={value}>
          <ContextReader />
        </MyContext.Provider>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<App value="first" />));
    assertLog(['ContextReader: first']);

    logContextValue();

    assertLog(['ContextReader (Effect event): first']);

    await act(() => root.render(<App value="second" />));
    assertLog(['ContextReader: second']);

    logContextValue();
    assertLog(['ContextReader (Effect event): second']);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 Activity 隐藏、更新与显示之间调用事件，确认可见提交边界决定闭包新鲜度。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`useEffectEventImpl()`、`mountEvent()` 与 `updateEvent()` 的提交队列。
   */
  it('effect events are fresh inside Activity', async () => {
    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“在 Activity 隐藏、更新与显示之间调用事件，确认可见提交边界决定闭包新鲜度”场景。 */
    function Child({value}) {
      const getValue = useEffectEvent(() => {
        return value;
      });
      useInsertionEffect(() => {
        Scheduler.log('insertion create: ' + getValue());
        return () => {
          Scheduler.log('insertion destroy: ' + getValue());
        };
      });
      useLayoutEffect(() => {
        Scheduler.log('layout create: ' + getValue());
        return () => {
          Scheduler.log('layout destroy: ' + getValue());
        };
      });

      Scheduler.log('render: ' + value);
      return null;
    }

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在 Activity 隐藏、更新与显示之间调用事件，确认可见提交边界决定闭包新鲜度”场景。 */
    function App({value, mode}) {
      return (
        <React.Activity mode={mode}>
          <Child value={value} />
        </React.Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 以隐藏模式挂载。
    await act(async () => root.render(<App value={1} mode="hidden" />));
    assertLog(['render: 1', 'insertion create: 1']);

    // 更新后仍保持隐藏。
    await act(async () => root.render(<App value={2} mode="hidden" />));

    // `enableViewTransition` 下的已知缺陷：Insertion 与 Layout 阶段会看到旧闭包。
    assertLog([
      'render: 2',
      ...(gate('enableViewTransition') &&
      !gate('enableEffectEventMutationPhase')
        ? ['insertion destroy: 1', 'insertion create: 1']
        : ['insertion destroy: 2', 'insertion create: 2']),
    ]);

    // 切换为可见模式。
    await act(async () => root.render(<App value={2} mode="visible" />));

    // `enableViewTransition` 下的已知缺陷：即使切换为可见，仍会看到旧闭包。
    assertLog([
      'render: 2',
      ...(gate('enableViewTransition') &&
      !gate('enableEffectEventMutationPhase')
        ? ['insertion destroy: 1', 'insertion create: 1', 'layout create: 1']
        : ['insertion destroy: 2', 'insertion create: 2', 'layout create: 2']),
    ]);
  });
});
