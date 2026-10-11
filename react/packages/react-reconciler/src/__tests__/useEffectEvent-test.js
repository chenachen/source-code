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

  /** 每个用例重新绑定 Effect Event、各类 Effect、Noop 渲染器与断言工具；此回调没有调用 resetModules。 */
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

  /** 把输入同步到调度日志与宿主输出。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /** count=0、incrementBy=1；两次点击得 2，props 改为 10 后下一次得 12，验证共享事件 ref 读取已提交新闭包。 */
  it('memoizes basic case correctly', async () => {
    /** 通过实例方法转调 onClick/onMouseEnter，PureComponent 渲染 Increment 日志，ref 提供测试触发入口。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 输出固定 Increment；render 阶段非法调用的场景在输出前转调 onClick 并抛错。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 维护 count；点击按已提交 incrementBy 增加，props 更新不直接改变 count。 */
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

  /** count=0、incrementBy=5；调用加法事件得 5，再调用乘法事件得 25，验证两个事件实现各自保存。 */
  it('can be defined more than once', async () => {
    /** 通过实例方法转调 onClick/onMouseEnter，PureComponent 渲染 Increment 日志，ref 提供测试触发入口。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 转调 onMouseEnter，使第二个 Effect Event 按最新 incrementBy 乘计数。 */
      multiply = () => {
        this.props.onMouseEnter();
      };
      /** 输出固定 Increment；render 阶段非法调用的场景在输出前转调 onClick 并抛错。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 维护 count，并用两个独立 Effect Event 分别按 incrementBy 加法和乘法更新。 */
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

  /** hello=hej，初始问候为 Seb says hej；调用 person.greet 的事件包装器后得到 undefined says hej，验证 apply(undefined,args) 不继承 person 接收者。 */
  it('does not preserve `this` in event functions', async () => {
    /** 提供 greet 实例入口转调 onClick，并输出当前 hello 的按钮文本。 */
    class GreetButton extends React.PureComponent {
      /** GreetButton.greet 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      greet = () => {
        this.props.onClick();
      };
      /** 输出 Say 加当前 hello，以按钮日志对照事件问候语。 */
      render() {
        return <Text text={'Say ' + this.props.hello} />;
      }
    }
    /** 把依赖 this 的 person.greet 交给 Effect Event，观察包装器调用时的 this 与最新 hello。 */
    function Greeter({hello}) {
      const person = {
        /** Greeter.toString 提供可辨识的实例字符串，验证 Effect Event 不会继承调用方 `this`。 */
        toString() {
          return 'Jane';
        },
        /** Greeter.greet 是传给 useEffectEvent 的原始对象方法；包装器以 undefined 为 this 调用它。 */
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

  /** Counter 定义事件并传给类子组件；子组件在 render 中调用 onClick，waitForThrow 验证渲染阶段错误，Scheduler 日志为空。该检查不以 DEV 为条件。 */
  it('throws when called in render', async () => {
    /** 通过实例方法转调 onClick/onMouseEnter，PureComponent 渲染 Increment 日志，ref 提供测试触发入口。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };

      /** 输出固定 Increment；render 阶段非法调用的场景在输出前转调 onClick 并抛错。 */
      render() {
    // 此调用应抛错。
        this.props.onClick();

        return <Text text="Increment" />;
      }
    }

    /** 定义计数事件后传给类组件；类 render 调用它必须先抛阶段错误。 */
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

  /** layout effect 只依赖 incrementBy：初挂 1 时 count 从 0 到 2，两次点击到 4 不重跑 effect；prop 改为 10 时 effect 到 24、点击到 34，验证省略事件依赖仍读取新值。 */
  it("useLayoutEffect shouldn't re-fire when event handlers change", async () => {
    /** 通过实例方法转调 onClick/onMouseEnter，PureComponent 渲染 Increment 日志，ref 提供测试触发入口。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 输出固定 Increment；render 阶段非法调用的场景在输出前转调 onClick 并抛错。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** layout effect 仅依赖 incrementBy 并调用双倍增量，按钮无 amount 时采用当前 incrementBy。 */
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

  /** passive effect 只依赖 incrementBy：初挂到 2，两次点击到 4 不重跑 effect；prop 改为 10 时 effect 到 24、点击到 34，验证省略事件依赖而非事件身份稳定。 */
  it("useEffect shouldn't re-fire when event handlers change", async () => {
    /** 通过实例方法转调 onClick/onMouseEnter，PureComponent 渲染 Increment 日志，ref 提供测试触发入口。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 输出固定 Increment；render 阶段非法调用的场景在输出前转调 onClick 并抛错。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** passive effect 仅依赖 incrementBy 并调用双倍增量，按钮采用当前 incrementBy。 */
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

  /** useCount 返回 count 与事件；调用方 effect 仅依赖 incrementBy，初挂到 2、点击到 4、prop=10 到 24/34。验证旧包装器共享实现 ref，并未断言返回函数身份稳定。 */
  it('is stable in a custom hook', async () => {
    /** 通过实例方法转调 onClick/onMouseEnter，PureComponent 渲染 Increment 日志，ref 提供测试触发入口。 */
    class IncrementButton extends React.PureComponent {
      /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      increment = () => {
        this.props.onClick();
      };
      /** 输出固定 Increment；render 阶段非法调用的场景在输出前转调 onClick 并抛错。 */
      render() {
        return <Text text="Increment" />;
      }
    }

    /** 返回 count 与 Effect Event；函数身份可以变化，但任一旧包装器都通过共享 ref 读取最新已提交实现。 */
    function useCount(incrementBy) {
      const [count, updateCount] = useState(0);
      const increment = useEffectEvent(amount =>
        updateCount(c => c + (amount || incrementBy)),
      );

      return [count, increment];
    }

    /** 使用自定义 useCount 的事件；passive effect 仅依赖 incrementBy，验证省略事件依赖仍读新闭包。 */
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

  /** 事件声明在 insertion effect 之后；value 从 1 改为 2，effect 与事件日志均读本轮 value，验证提交先发布事件实现再运行 insertion create。 */
  it('is mutated before all other effects', async () => {
    /** 不持有 count state；insertion effect 调用后声明的事件，二者都记录当前 value。 */
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

  /** 父子各注册三类 effect，count=1→2→卸载；更新的 create/cleanup 均读取新 A2/B2，删除读取最后提交值。Parent insertion cleanup 复用 Create 标签，断言保留该文字。 */
  it('fires all (interleaved) effects with useEffectEvent in correct order', async () => {
    /** 父级三类 effect 都调用读 count 的事件，并把事件传给子级测试跨组件提交顺序。 */
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

    /** 子级事件先调用父事件，再拼接自己的 count，三类 effect create/cleanup 都读取该组合。 */
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

  /** Activity 隐藏预渲染并更新父/子 state，再揭示和隐藏；insertion 在隐藏时仍执行，layout/passive 到揭示才连接。enableViewTransition && !enableEffectEventMutationPhase 分支保留旧子闭包，其余分支读新值。 */
  it('correctly mutates effect event with Activity', async () => {
    let setState;
    let setChildState;
    /** 持有父 state 与 count，Activity 控制子树隐藏；父 insertion/layout 事件对照隐藏子树闭包。 */
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

    /** 持有 childState，并在事件里拼接父事件、count、父 state 与子 state，观察隐藏提交的两种 flag 行为。 */
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

  /** 同一事件用于两份 passive effect：依赖 [onClick] 与 [shouldRender]。true/0 初挂调用两次，true/1 更新一次，false/2 更新两次，验证事件函数身份每轮变化。 */
  it("doesn't provide a stable identity", async () => {
    /** 定义读 shouldRender/value 的事件；两份 passive effect 分别依赖事件身份与 shouldRender。 */
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

  /** 外部事件系统长期持有处理器，更新后调用时读取最新已提交值而无需重新订阅。 */
  it('event handlers always see the latest committed value', async () => {
    let committedEventHandler = null;

    /** 只在首次 passive create 保存事件到外部变量，cleanup 清空；后续仅更新事件共享 ref 的实现。 */
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

  /** 按文档聊天室示例切换 room 与 theme，确认只有连接参数变化才重连。 */
  it('integration: implements docs chat room example', async () => {
    /** 创建只支持 connected 的连接模拟器：connect 延迟 100ms 调用已登记处理器，disconnect 取消 timer；roomId 实参未被此 fixture 消费。 */
    function createConnection() {
      let connectedCallback;
      let timeout;
      return {
        /** 安排 100ms timer，届时若已登记 connectedCallback 则调用；连接方法自身不写日志。 */
        connect() {
          timeout = setTimeout(() => {
            if (connectedCallback) {
              connectedCallback();
            }
          }, 100);
        },
        /** 只接受一次 connected 订阅；重复登记或其他事件名抛错，不写日志。 */
        on(event, callback) {
          if (connectedCallback) {
            throw Error('Cannot add the handler twice.');
          }
          if (event !== 'connected') {
            throw Error('Only "connected" event is supported.');
          }
          connectedCallback = callback;
        },
        /** 取消 connect 的 timer；保留 callback 变量但不再发出本次完成通知。 */
        disconnect() {
          clearTimeout(timeout);
        },
      };
    }

    /** 只按 roomId 建立连接，连接回调通过 Effect Event 读取最新 theme。 */
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

  /** 按文档访问日志示例更新购物车数量，确认页面事件读取最新数量而不重跑页面 Effect。 */
  it('integration: implements the docs logVisit example', async () => {
    /** 提供 ref.addToCart() 转调购物车事件，并输出 Add to cart 作为重渲染日志。 */
    class AddToCartButton extends React.PureComponent {
      /** AddToCartButton.addToCart 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
      addToCart = () => {
        this.props.onClick();
      };
      /** 输出固定 Add to cart，记录购物车变化带来的 render。 */
      render() {
        return <Text text="Add to cart" />;
      }
    }
    const ShoppingCartContext = createContext(null);

    /** 管理购物车 items 并通过 Context 发布 items/updateItems，供访问日志事件读取。 */
    function AppShell({children}) {
      const [items, updateItems] = useState([]);
      const value = useMemo(() => ({items, updateItems}), [items, updateItems]);

      return (
        <ShoppingCartContext.Provider value={value}>
          {children}
        </ShoppingCartContext.Provider>
      );
    }

    /** 只按 url 触发访问 Effect；Effect Event 在调用时读取最新购物车数量。 */
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

  /** Provider first→second，memo Consumer 因 Context 变化重渲染；首次 effect 保存的事件两次调用分别读 first/second。 */
  it('reads the latest context value in memo Components', async () => {
    const MyContext = createContext('default');

    let logContextValue;
    const ContextReader = React.memo(/** 读取 Context 并登记依赖；首次 effect 保存事件包装器，更新不重新保存也读取最新值。 */ function ContextReader() {
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

    /** 用 Provider 发布 value，memo Consumer 的 Context 依赖仍触发更新。 */
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

  /** Provider first→second，forwardRef Consumer 读取新 Context；首次 effect 保存的事件两次调用分别读 first/second，ref 未参与本例。 */
  it('reads the latest context value in forwardRef Components', async () => {
    const MyContext = createContext('default');

    let logContextValue;
    const ContextReader = React.forwardRef(/** 读取 Context；未消费 props/ref，首次 effect 保存的包装器仍须读取最新 Context 闭包。 */ function ContextReader(props, ref) {
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

    /** 用 Provider 发布 value，forwardRef Consumer 读取 Context；本例不使用 ref。 */
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

  /** Activity 隐藏初挂 value=1，隐藏更新为 2，再揭示；insertion 一直执行、layout 在揭示 create。两组 flag 断言分别记录旧 1 或新 2 的事件闭包。 */
  it('effect events are fresh inside Activity', async () => {
    /** 记录子组件渲染与提交，供父子顺序断言使用。 */
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

    /** 把 value 传入 Activity 的 Child，以 mode 切换隐藏和可见提交。 */
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
