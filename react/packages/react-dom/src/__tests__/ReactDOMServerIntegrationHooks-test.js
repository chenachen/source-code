/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

/* eslint-disable no-func-assign */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;
let useState;
let useReducer;
let useEffect;
let useContext;
let useCallback;
let useMemo;
let useRef;
let useImperativeHandle;
let useInsertionEffect;
let useLayoutEffect;
let useDebugValue;
let forwardRef;
let yieldedValues;
let yieldValue;
let clearLog;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();

  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  useState = React.useState;
  useReducer = React.useReducer;
  useEffect = React.useEffect;
  useContext = React.useContext;
  useCallback = React.useCallback;
  useMemo = React.useMemo;
  useRef = React.useRef;
  useDebugValue = React.useDebugValue;
  useImperativeHandle = React.useImperativeHandle;
  useInsertionEffect = React.useInsertionEffect;
  useLayoutEffect = React.useLayoutEffect;
  forwardRef = React.forwardRef;

  yieldedValues = [];
  yieldValue = value => {
    yieldedValues.push(value);
  };
  clearLog = () => {
    const ret = yieldedValues;
    yieldedValues = [];
    return ret;
  };

    // 将这些方法暴露给测试辅助函数。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{ resetModules, itRenders, itThrowsWhenRendering, clientRenderOnBadMarkup, serverRender, }`：保存当前测试场景复用的夹具、状态或回调。 */
const {
  resetModules,
  itRenders,
  itThrowsWhenRendering,
  clientRenderOnBadMarkup,
  serverRender,
} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerHooks', () => {
  beforeEach(() => {
    resetModules();
  });

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text(props) {
    yieldValue(props.text);
    return <span>{props.text}</span>;
  }

  describe('useState', () => {
    itRenders('basic render', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        const [count] = useState(0);
        return <span>Count: {count}</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    itRenders('lazy state initialization', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        const [count] = useState(() => {
          return 0;
        });
        return <span>Count: {count}</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「does not trigger a re-renders when updater is invoked outside current render function」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it('does not trigger a re-renders when updater is invoked outside current render function', async () => {
      /** `UpdateCount`：封装当前用例复用的操作、回调或断言步骤。 */
      function UpdateCount({setCount, count, children}) {
        if (count < 3) {
          setCount(c => c + 1);
        }
        return <span>{children}</span>;
      }
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        const [count, setCount] = useState(0);
        return (
          <div>
            <UpdateCount setCount={setCount} count={count}>
              Count: {count}
            </UpdateCount>
          </div>
        );
      }

      const domNode = await serverRender(<Counter />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    itThrowsWhenRendering(
      'if used inside a class component',
      async render => {
        /** `Counter`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class Counter extends React.Component {
          /** `Counter.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            const [count] = useState(0);
            return <Text text={count} />;
          }
        }

        return render(<Counter />);
      },
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    );

    itRenders('multiple times when an updater is called', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        const [count, setCount] = useState(0);
        if (count < 12) {
          setCount(c => c + 1);
          setCount(c => c + 1);
          setCount(c => c + 1);
        }
        return <Text text={'Count: ' + count} />;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Count: 12');
    });

    itRenders('until there are no more new updates', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        const [count, setCount] = useState(0);
        if (count < 3) {
          setCount(count + 1);
        }
        return <span>Count: {count}</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Count: 3');
    });

    itThrowsWhenRendering(
      'after too many iterations',
      async render => {
        /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
        function Counter() {
          const [count, setCount] = useState(0);
          setCount(count + 1);
          return <span>{count}</span>;
        }
        return render(<Counter />);
      },
      'Too many re-renders. React limits the number of renders to prevent ' +
        'an infinite loop.',
    );
  });

  describe('useReducer', () => {
    itRenders('with initial state', async render => {
      /** `reducer`：封装当前用例复用的操作、回调或断言步骤。 */
      function reducer(state, action) {
        return action === 'increment' ? state + 1 : state;
      }
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        const [count] = useReducer(reducer, 0);
        yieldValue('Render: ' + count);
        return <Text text={count} />;
      }

      const domNode = await render(<Counter />);

      expect(clearLog()).toEqual(['Render: 0', 0]);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('0');
    });

    itRenders('lazy initialization', async render => {
      /** `reducer`：封装当前用例复用的操作、回调或断言步骤。 */
      function reducer(state, action) {
        return action === 'increment' ? state + 1 : state;
      }
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        const [count] = useReducer(reducer, 0, c => c + 1);
        yieldValue('Render: ' + count);
        return <Text text={count} />;
      }

      const domNode = await render(<Counter />);

      expect(clearLog()).toEqual(['Render: 1', 1]);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('1');
    });

    itRenders(
      'multiple times when updates happen during the render phase',
      async render => {
        /** `reducer`：封装当前用例复用的操作、回调或断言步骤。 */
        function reducer(state, action) {
          return action === 'increment' ? state + 1 : state;
        }
        /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
        function Counter() {
          const [count, dispatch] = useReducer(reducer, 0);
          if (count < 3) {
            dispatch('increment');
          }
          yieldValue('Render: ' + count);
          return <Text text={count} />;
        }

        const domNode = await render(<Counter />);

        expect(clearLog()).toEqual([
          'Render: 0',
          'Render: 1',
          'Render: 2',
          'Render: 3',
          3,
        ]);
        expect(domNode.tagName).toEqual('SPAN');
        expect(domNode.textContent).toEqual('3');
      },
    );

    itRenders(
      'using reducer passed at time of render, not time of dispatch',
      async render => {
        // 这个测试稍显刻意，但展示了一个微妙的边缘情况。

        // Reducer A 每次加 1，Reducer B 每次加 10。
        /** `reducerA`：封装当前用例复用的操作、回调或断言步骤。 */
        function reducerA(state, action) {
          switch (action) {
            case 'increment':
              return state + 1;
            case 'reset':
              return 0;
          }
        }
        /** `reducerB`：封装当前用例复用的操作、回调或断言步骤。 */
        function reducerB(state, action) {
          switch (action) {
            case 'increment':
              return state + 10;
            case 'reset':
              return 0;
          }
        }

        /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
        function Counter() {
          const [reducer, setReducer] = useState(() => reducerA);
          const [count, dispatch] = useReducer(reducer, 0);
          if (count < 20) {
            dispatch('increment');
            // 每次递增时交换 reducer。
            if (reducer === reducerA) {
              setReducer(() => reducerB);
            } else {
              setReducer(() => reducerA);
            }
          }
          yieldValue('Render: ' + count);
          return <Text text={count} />;
        }

        const domNode = await render(<Counter />);

        expect(clearLog()).toEqual([
          // 计数器应该交替增加10和1，直到达到21。
          'Render: 0',
          'Render: 10',
          'Render: 11',
          'Render: 21',
          21,
        ]);
        expect(domNode.tagName).toEqual('SPAN');
        expect(domNode.textContent).toEqual('21');
      },
    );
  });

  describe('useMemo', () => {
    itRenders('basic render', async render => {
      /** `CapitalizedText`：封装当前用例复用的操作、回调或断言步骤。 */
      function CapitalizedText(props) {
        const text = props.text;
        const capitalizedText = useMemo(() => {
          yieldValue(`Capitalize '${text}'`);
          return text.toUpperCase();
        }, [text]);
        return <Text text={capitalizedText} />;
      }

      const domNode = await render(<CapitalizedText text="hello" />);
      expect(clearLog()).toEqual(["Capitalize 'hello'", 'HELLO']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('HELLO');
    });

    itRenders('if no inputs are provided', async render => {
      /** `LazyCompute`：封装当前用例复用的操作、回调或断言步骤。 */
      function LazyCompute(props) {
        const computed = useMemo(props.compute);
        return <Text text={computed} />;
      }

      /** `computeA`：封装当前用例复用的操作、回调或断言步骤。 */
      function computeA() {
        yieldValue('compute A');
        return 'A';
      }

      const domNode = await render(<LazyCompute compute={computeA} />);
      expect(clearLog()).toEqual(['compute A', 'A']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('A');
    });

    itRenders(
      'multiple times when updates happen during the render phase',
      async render => {
        /** `CapitalizedText`：封装当前用例复用的操作、回调或断言步骤。 */
        function CapitalizedText(props) {
          const [text, setText] = useState(props.text);
          const capitalizedText = useMemo(() => {
            yieldValue(`Capitalize '${text}'`);
            return text.toUpperCase();
          }, [text]);

          if (text === 'hello') {
            setText('hello, world.');
          }
          return <Text text={capitalizedText} />;
        }

        const domNode = await render(<CapitalizedText text="hello" />);
        expect(clearLog()).toEqual([
          "Capitalize 'hello'",
          "Capitalize 'hello, world.'",
          'HELLO, WORLD.',
        ]);
        expect(domNode.tagName).toEqual('SPAN');
        expect(domNode.textContent).toEqual('HELLO, WORLD.');
      },
    );

    itRenders(
      'should only invoke the memoized function when the inputs change',
      async render => {
        /** `CapitalizedText`：封装当前用例复用的操作、回调或断言步骤。 */
        function CapitalizedText(props) {
          const [text, setText] = useState(props.text);
          const [count, setCount] = useState(0);
          const capitalizedText = useMemo(() => {
            yieldValue(`Capitalize '${text}'`);
            return text.toUpperCase();
          }, [text]);

          yieldValue(count);

          if (count < 3) {
            setCount(count + 1);
          }

          if (text === 'hello' && count === 2) {
            setText('hello, world.');
          }
          return <Text text={capitalizedText} />;
        }

        const domNode = await render(<CapitalizedText text="hello" />);
        expect(clearLog()).toEqual([
          "Capitalize 'hello'",
          0,
          1,
          2,
          // `capitalizedText` 只在文本变化时重新计算。
          "Capitalize 'hello, world.'",
          3,
          'HELLO, WORLD.',
        ]);
        expect(domNode.tagName).toEqual('SPAN');
        expect(domNode.textContent).toEqual('HELLO, WORLD.');
      },
    );

    itRenders('with a warning for useState inside useMemo', async render => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        useMemo(() => {
          useState();
          return 0;
        });
        return 'hi';
      }
      const domNode = await render(
        <App />,
        render === clientRenderOnBadMarkup
          ? // 水合不匹配时会重试，因此警告会再次记录。
            2
          : 1,
      );
      expect(domNode.textContent).toEqual('hi');
    });

    itRenders('with a warning for useRef inside useState', async render => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        const [value] = useState(() => {
          useRef(0);
          return 0;
        });
        return value;
      }

      const domNode = await render(
        <App />,
        render === clientRenderOnBadMarkup
          ? // 水合不匹配时会重试，因此警告会再次记录。
            2
          : 1,
      );
      expect(domNode.textContent).toEqual('0');
    });
  });

  describe('useRef', () => {
    itRenders('basic render', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        const ref = useRef();
        return <span ref={ref}>Hi</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Hi');
    });

    itRenders(
      'multiple times when updates happen during the render phase',
      async render => {
        /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
        function Counter(props) {
          const [count, setCount] = useState(0);
          const ref = useRef();

          if (count < 3) {
            const newCount = count + 1;
            setCount(newCount);
          }

          yieldValue(count);

          return <span ref={ref}>Count: {count}</span>;
        }

        const domNode = await render(<Counter />);
        expect(clearLog()).toEqual([0, 1, 2, 3]);
        expect(domNode.textContent).toEqual('Count: 3');
      },
    );

    itRenders(
      'always return the same reference through multiple renders',
      async render => {
        let firstRef = null;
        /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
        function Counter(props) {
          const [count, setCount] = useState(0);
          const ref = useRef();
          if (firstRef === null) {
            firstRef = ref;
          } else if (firstRef !== ref) {
            throw new Error('should never change');
          }

          if (count < 3) {
            setCount(count + 1);
          } else {
            firstRef = null;
          }

          yieldValue(count);

          return <span ref={ref}>Count: {count}</span>;
        }

        const domNode = await render(<Counter />);
        expect(clearLog()).toEqual([0, 1, 2, 3]);
        expect(domNode.textContent).toEqual('Count: 3');
      },
    );
  });

  describe('useEffect', () => {
    const yields = [];
    itRenders('should ignore effects on the server', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        useEffect(() => {
          yieldValue('invoked on client');
        });
        return <Text text={'Count: ' + props.count} />;
      }

      const domNode = await render(<Counter count={0} />);
      yields.push(clearLog());
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('Count: 0');
    });

    /** 测试场景：验证「verifies yields in order」描述的渲染、交互或错误处理结果。 */
    it('verifies yields in order', () => {
      expect(yields).toEqual([
        ['Count: 0'], // 服务器端渲染（Server-side Rendering, SSR）
        ['Count: 0'], // 服务器流
        ['Count: 0', 'invoked on client'], // 清理渲染
        ['Count: 0', 'invoked on client'], // 已hydrate的渲染
        // 无响应，因为有坏的 HTML 标记。
      ]);
    });
  });

  describe('useCallback', () => {
    itRenders('should not invoke the passed callbacks', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        useCallback(() => {
          yieldValue('should not be invoked');
        });
        return <Text text={'Count: ' + props.count} />;
      }
      const domNode = await render(<Counter count={0} />);
      expect(clearLog()).toEqual(['Count: 0']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('Count: 0');
    });

    itRenders('should support render time callbacks', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        const renderCount = useCallback(increment => {
          return 'Count: ' + (props.count + increment);
        });
        return <Text text={renderCount(3)} />;
      }
      const domNode = await render(<Counter count={2} />);
      expect(clearLog()).toEqual(['Count: 5']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('Count: 5');
    });

    itRenders(
      'should only change the returned reference when the inputs change',
      async render => {
        /** `CapitalizedText`：封装当前用例复用的操作、回调或断言步骤。 */
        function CapitalizedText(props) {
          const [text, setText] = useState(props.text);
          const [count, setCount] = useState(0);
          const capitalizeText = useCallback(() => text.toUpperCase(), [text]);
          yieldValue(capitalizeText);
          if (count < 3) {
            setCount(count + 1);
          }
          if (text === 'hello' && count === 2) {
            setText('hello, world.');
          }
          return <Text text={capitalizeText()} />;
        }

        const domNode = await render(<CapitalizedText text="hello" />);
        const [first, second, third, fourth, result] = clearLog();
        expect(first).toBe(second);
        expect(second).toBe(third);
        expect(third).not.toBe(fourth);
        expect(result).toEqual('HELLO, WORLD.');
        expect(domNode.tagName).toEqual('SPAN');
        expect(domNode.textContent).toEqual('HELLO, WORLD.');
      },
    );
  });

  describe('useImperativeHandle', () => {
    /** 测试场景：验证「should not be invoked on the server」描述的渲染、交互或错误处理结果。 */
    it('should not be invoked on the server', async () => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props, ref) {
        useImperativeHandle(ref, () => {
          throw new Error('should not be invoked');
        });
        return <Text text={props.label + ': ' + ref.current} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef();
      counter.current = 0;
      const domNode = await serverRender(
        <Counter label="Count" ref={counter} />,
      );
      expect(clearLog()).toEqual(['Count: 0']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('Count: 0');
    });
  });
  describe('useInsertionEffect', () => {
    /** 测试场景：验证「should warn when invoked during render」描述的渲染、交互或错误处理结果。 */
    it('should warn when invoked during render', async () => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        useInsertionEffect(() => {
          throw new Error('should not be invoked');
        });

        return <Text text="Count: 0" />;
      }
      const domNode = await serverRender(<Counter />, 1);
      expect(clearLog()).toEqual(['Count: 0']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('Count: 0');
    });
  });

  describe('useLayoutEffect', () => {
    /** 测试场景：验证「should warn when invoked during render」描述的渲染、交互或错误处理结果。 */
    it('should warn when invoked during render', async () => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter() {
        useLayoutEffect(() => {
          throw new Error('should not be invoked');
        });

        return <Text text="Count: 0" />;
      }
      const domNode = await serverRender(<Counter />, 1);
      expect(clearLog()).toEqual(['Count: 0']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('Count: 0');
    });
  });

  describe('useContext', () => {
    itThrowsWhenRendering(
      'if used inside a class component',
      async render => {
        const Context = React.createContext({}, () => {});
        /** `Counter`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class Counter extends React.Component {
          /** `Counter.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            const [count] = useContext(Context);
            return <Text text={count} />;
          }
        }

        return render(<Counter />);
      },
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    );
  });

  describe('invalid hooks', () => {
    /** 测试场景：验证「warns when calling useRef inside useReducer」描述的渲染、交互或错误处理结果。 */
    it('warns when calling useRef inside useReducer', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        const [value, dispatch] = useReducer((state, action) => {
          useRef(0);
          return state + 1;
        }, 0);
        if (value === 0) {
          dispatch();
        }
        return value;
      }

      let error;
      try {
        await serverRender(<App />);
      } catch (x) {
        error = x;
      }
      expect(error).not.toBe(undefined);
      expect(error.message).toContain(
        'Rendered more hooks than during the previous render',
      );
    });
  });

  itRenders(
    'can use the same context multiple times in the same function',
    async render => {
      const Context = React.createContext({foo: 0, bar: 0, baz: 0});

      /** `Provider`：封装当前用例复用的操作、回调或断言步骤。 */
      function Provider(props) {
        return (
          <Context.Provider
            value={{foo: props.foo, bar: props.bar, baz: props.baz}}>
            {props.children}
          </Context.Provider>
        );
      }

      /** `FooAndBar`：封装当前用例复用的操作、回调或断言步骤。 */
      function FooAndBar() {
        const {foo} = useContext(Context);
        const {bar} = useContext(Context);
        return <Text text={`Foo: ${foo}, Bar: ${bar}`} />;
      }

      /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
      function Baz() {
        const {baz} = useContext(Context);
        return <Text text={'Baz: ' + baz} />;
      }

      /** `Indirection`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Indirection extends React.Component {
        /** `Indirection.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return this.props.children;
        }
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App(props) {
        return (
          <div>
            <Provider foo={props.foo} bar={props.bar} baz={props.baz}>
              <Indirection>
                <Indirection>
                  <FooAndBar />
                </Indirection>
                <Indirection>
                  <Baz />
                </Indirection>
              </Indirection>
            </Provider>
          </div>
        );
      }

      const domNode = await render(<App foo={1} bar={3} baz={5} />);
      expect(clearLog()).toEqual(['Foo: 1, Bar: 3', 'Baz: 5']);
      expect(domNode.childNodes.length).toBe(2);
      expect(domNode.firstChild.tagName).toEqual('SPAN');
      expect(domNode.firstChild.textContent).toEqual('Foo: 1, Bar: 3');
      expect(domNode.lastChild.tagName).toEqual('SPAN');
      expect(domNode.lastChild.textContent).toEqual('Baz: 5');
    },
  );

  describe('useDebugValue', () => {
    itRenders('is a noop', async render => {
      /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
      function Counter(props) {
        const debugValue = useDebugValue(123);
        return <Text text={typeof debugValue} />;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('undefined');
    });
  });

  describe('readContext', () => {
    /** `readContext`：封装当前用例复用的操作、回调或断言步骤。 */
    function readContext(Context) {
      const dispatcher =
        React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
      return dispatcher.readContext(Context);
    }

    itRenders(
      'can read the same context multiple times in the same function',
      async render => {
        const Context = React.createContext(
          {foo: 0, bar: 0, baz: 0},
          (a, b) => {
            let result = 0;
            if (a.foo !== b.foo) {
              result |= 0b001;
            }
            if (a.bar !== b.bar) {
              result |= 0b010;
            }
            if (a.baz !== b.baz) {
              result |= 0b100;
            }
            return result;
          },
        );

        /** `Provider`：封装当前用例复用的操作、回调或断言步骤。 */
        function Provider(props) {
          return (
            <Context.Provider
              value={{foo: props.foo, bar: props.bar, baz: props.baz}}>
              {props.children}
            </Context.Provider>
          );
        }

        /** `FooAndBar`：封装当前用例复用的操作、回调或断言步骤。 */
        function FooAndBar() {
          const {foo} = readContext(Context, 0b001);
          const {bar} = readContext(Context, 0b010);
          return <Text text={`Foo: ${foo}, Bar: ${bar}`} />;
        }

        /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
        function Baz() {
          const {baz} = readContext(Context, 0b100);
          return <Text text={'Baz: ' + baz} />;
        }

        /** `Indirection`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class Indirection extends React.Component {
          /** `Indirection.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          shouldComponentUpdate() {
            return false;
          }
          /** `Indirection.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return this.props.children;
          }
        }

        /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App(props) {
          return (
            <div>
              <Provider foo={props.foo} bar={props.bar} baz={props.baz}>
                <Indirection>
                  <Indirection>
                    <FooAndBar />
                  </Indirection>
                  <Indirection>
                    <Baz />
                  </Indirection>
                </Indirection>
              </Provider>
            </div>
          );
        }

        const domNode = await render(<App foo={1} bar={3} baz={5} />);
        expect(clearLog()).toEqual(['Foo: 1, Bar: 3', 'Baz: 5']);
        expect(domNode.childNodes.length).toBe(2);
        expect(domNode.firstChild.tagName).toEqual('SPAN');
        expect(domNode.firstChild.textContent).toEqual('Foo: 1, Bar: 3');
        expect(domNode.lastChild.tagName).toEqual('SPAN');
        expect(domNode.lastChild.textContent).toEqual('Baz: 5');
      },
    );

    itRenders('with a warning inside useMemo and useReducer', async render => {
      const Context = React.createContext(42);

      /** `ReadInMemo`：封装当前用例复用的操作、回调或断言步骤。 */
      function ReadInMemo(props) {
        const count = React.useMemo(() => readContext(Context), []);
        return <Text text={count} />;
      }

      /** `ReadInReducer`：封装当前用例复用的操作、回调或断言步骤。 */
      function ReadInReducer(props) {
        const [count, dispatch] = React.useReducer(() => readContext(Context));
        if (count !== 42) {
          dispatch();
        }
        return <Text text={count} />;
      }

      const domNode1 = await render(
        <ReadInMemo />,
        render === clientRenderOnBadMarkup
          ? // 水合不匹配时会重试，因此警告会再次记录。
            2
          : 1,
      );
      expect(domNode1.textContent).toEqual('42');

      const domNode2 = await render(<ReadInReducer />, 1);
      expect(domNode2.textContent).toEqual('42');
    });
  });

  /** 测试场景：验证「renders successfully after a component using hooks throws an error」描述的渲染、交互或错误处理结果。 */
  it('renders successfully after a component using hooks throws an error', () => {
    /** `ThrowingComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    function ThrowingComponent() {
      const [value, dispatch] = useReducer((state, action) => {
        return state + 1;
      }, 0);

      // 重渲染阶段计数过高时抛错。
      if (value >= 3) {
        throw new Error('Error from ThrowingComponent');
      } else {
        // 触发组件的重新渲染。
        dispatch();
      }

      return <div>{value}</div>;
    }

    /** `NonThrowingComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    function NonThrowingComponent() {
      const [count] = useState(0);
      return <div>{count}</div>;
    }

    // 首先， 渲染一个组件，在其重新渲染时会因 dispatch 调用而抛出错误。
    expect(() => ReactDOMServer.renderToString(<ThrowingComponent />)).toThrow(
      'Error from ThrowingComponent',
    );

    // 接着确认：错误发生后仍可立即渲染使用 Hook 的函数组件，说明内部 Hook 状态已经重置。
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(
      <NonThrowingComponent />,
    );
    expect(container.children[0].textContent).toEqual('0');
  });
});
