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

/** SSR/客户端集成辅助器工厂；itRenders的错误markup模式比较恢复文本后提前结束，不返回给本例后续日志和DOM断言。 */
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

/**
 * 重置renderer模块、Hook函数引用与日志数组，保持五种模式的dispatcher及警告缓存独立；安装yieldValue/clearLog供fixture记录调用顺序。
 * @returns 当前ReactDOMClient与ReactDOMServer引用。
 */
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
  /**
   * 把值追加到当前模式的yieldedValues，记录组件render、memo计算和effect执行顺序。
   * @param value - 当前可观察日志值，可为数字、文字或函数引用。
   * @returns 无返回值。
   */
  yieldValue = value => {
    yieldedValues.push(value);
  };
  /**
   * 交出本轮完整日志数组并更换为空数组，避免后续push改变已经保存的断言输入。
   * @returns 清空前的日志数组。
   */
  clearLog = () => {
    const ret = yieldedValues;
    yieldedValues = [];
    return ret;
  };

  // 将本模式重新装载的renderer引用交给集成测试辅助器。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 模块重置、五模式渲染、三路径报错包装器及SSR入口；clientRenderOnBadMarkup用来给恢复重试设置不同诊断预算。 */
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

  /**
   * 记录props.text后返回span；父组件render-phase重试未提交的中间Text不一定被执行，因此日志可区分父重试与最终输出。
   * @param props - text为待记录并展示的值。
   * @returns 文本span。
   */
  function Text(props) {
    yieldValue(props.text);
    return <span>{props.text}</span>;
  }

  describe('useState', () => {
    /** Given：Counter以useState(0)初始化；When：交给 render 渲染；Then：DOM文本为Count: 0。目的：SSR及客户端dispatcher可读取初始state。 */
    itRenders('basic render', async render => {
      /**
       * 读取useState的0初值，不调用setter。
       * @param props - 本fixture未使用。
       * @returns Count: 0的span。
       */
      function Counter(props) {
        const [count] = useState(0);
        return <span>Count: {count}</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    /** Given：Counter用函数初始器返回0；When：交给 render 渲染；Then：DOM文本为Count: 0。目的：惰性初始state被使用。 */
    itRenders('lazy state initialization', async render => {
      /**
       * 用函数初始器提供0，覆盖惰性state初始化。
       * @param props - 本fixture未使用。
       * @returns Count前缀与当前state的span。
       */
      function Counter(props) {
        const [count] = useState(() => {
          return 0;
        });
        return <span>Count: {count}</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    /** Given：父Counter为0，子UpdateCount在自己的render中调用父setter；When：调用 serverRender；Then：仅调用serverRender且DOM仍为Count: 0。目的：SSR跨组件setter不驱动父组件的render-phase重渲染。 */
    it('does not trigger a re-renders when updater is invoked outside current render function', async () => {
      /**
       * 在子组件render中尝试更新父Counter；SSR不会把它作为父的本组件render-phase更新。
       * @param setCount - 绑定父Counter的setter。
       * @param count - 父本轮传下的数值，低于3时尝试加1。
       * @param children - 旧count对应的文本。
       * @returns 显示children的span。
       */
      function UpdateCount({setCount, count, children}) {
        if (count < 3) {
          setCount(c => c + 1);
        }
        return <span>{children}</span>;
      }
      /**
       * 持有count=0并把setter交给子UpdateCount，制造跨组件render调用更新。
       * @returns 包含UpdateCount的div。
       */
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

    /** Given：类Counter.render调用useState；When：由 itThrowsWhenRendering 驱动 render；Then：itThrowsWhenRendering要求Invalid hook call错误。目的：Hook不能在类render中读取函数组件状态。 */
    itThrowsWhenRendering(
      'if used inside a class component',
      async render => {
        /** 故意在类render调用Hook的非法使用fixture。 */
        class Counter extends React.Component {
          /**
           * 调用useState来触发Invalid hook call；后续Text返回路径不应成功。
           * @returns 若未报错则会返回Text元素，正常预期是抛错。
           */
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

    /** Given：Counter每轮count<12时连续派发三个加1函数action；When：交给 render 渲染；Then：DOM为Count: 12。目的：本组件render-phase更新按顺序累计并重复到稳定。 */
    itRenders('multiple times when an updater is called', async render => {
      /**
       * 每次count<12时排三个函数式加1，当前组件重渲染直到12。
       * @returns 仅稳定轮会继续渲染的Count文本Text元素。
       */
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

    /** Given：Counter在count<3时派发count+1；When：交给 render 渲染；Then：DOM为Count: 3。目的：重渲染持续至本轮不再新增更新。 */
    itRenders('until there are no more new updates', async render => {
      /**
       * 每次count<3时排count+1，验证重试直到不再新增action。
       * @returns 当前Count的span。
       */
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

    /** Given：Counter每次render都派发count+1；When：由 itThrowsWhenRendering 驱动 render；Then：错误包含Too many re-renders。目的：无限render-phase更新受迭代上限约束。 */
    itThrowsWhenRendering(
      'after too many iterations',
      async render => {
        /**
         * 无条件排count+1，故意触发服务器/客户端重渲染上限。
         * @returns 当前count的span；实际整体渲染最终抛错。
         */
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
    /** Given：useReducer初值0，reducer仅increment时加1；When：交给 render 渲染；Then：日志为Render: 0及0，SPAN文本0。目的：初值进入reducer Hook而非自动派发action。 */
    itRenders('with initial state', async render => {
      /**
       * increment加1，其余action返回旧state。
       * @param state - 当前计数。
       * @param action - 测试派发的increment或其他输入。
       * @returns 下一个计数。
       */
      function reducer(state, action) {
        return action === 'increment' ? state + 1 : state;
      }
      /**
       * 只读取useReducer初值0并记录父render日志。
       * @returns 显示0的Text元素。
       */
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

    /** Given：useReducer初值0且initializer加1；When：交给 render 渲染；Then：日志为Render: 1及1，SPAN文本1。目的：第三参数初始化函数决定首个state。 */
    itRenders('lazy initialization', async render => {
      /**
       * increment加1，其余action维持state；本场景只检查第三参数initializer，未派发action。
       * @param state - 初始化后计数。
       * @param action - reducer接收的动作。
       * @returns 下一计数。
       */
      function reducer(state, action) {
        return action === 'increment' ? state + 1 : state;
      }
      /**
       * 用c=>c+1把useReducer初值0变为1，记录最终初始化结果。
       * @returns 显示1的Text元素。
       */
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

    /** Given：Counter在count<3时派发increment；When：交给 render 渲染；Then：日志依次Render: 0/1/2/3及最终3，SPAN文本3。目的：中间组件render重试与最终Text渲染有不同调用次数。 */
    itRenders(
      'multiple times when updates happen during the render phase',
      async render => {
        /**
         * 把increment转为state+1，供同组件render-phase重试消费。
         * @param state - 前一轮计数。
         * @param action - 本例为increment。
         * @returns 新计数，未知动作保留旧值。
         */
        function reducer(state, action) {
          return action === 'increment' ? state + 1 : state;
        }
        /**
         * count<3时在render派发increment并记录每轮Render日志。
         * @returns 当前计数的Text元素，最终输出3。
         */
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

    /** Given：state保存reducerA，每轮同时increment并换成加10的B或加1的A；When：交给 render 渲染；Then：日志0→10→11→21及Text 21，SPAN文本21。目的：待处理action使用重渲染时的reducer而非dispatch时的版本。 */
    itRenders(
      'using reducer passed at time of render, not time of dispatch',
      async render => {
        // 这个测试稍显刻意，但展示了一个微妙的边缘情况。

        // Reducer A 每次加 1，Reducer B 每次加 10。
        /**
         * 为increment加1、reset清零；每轮与reducerB交换以区分dispatch时和下轮render时使用的函数。
         * @param state - 累计计数。
         * @param action - increment或reset。
         * @returns 新计数；其他action没有返回值。
         */
        function reducerA(state, action) {
          switch (action) {
            case 'increment':
              return state + 1;
            case 'reset':
              return 0;
          }
        }
        /**
         * 为increment加10、reset清零，作为交替reducer的较大步长。
         * @param state - 累计计数。
         * @param action - increment或reset。
         * @returns 新计数；其他action没有返回值。
         */
        function reducerB(state, action) {
          switch (action) {
            case 'increment':
              return state + 10;
            case 'reset':
              return 0;
          }
        }

        /**
         * 在计数未达20时同时派发increment并切换reducer；下轮按新reducer消费，得到0/10/11/21。
         * @returns 计数Text元素。
         */
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
    /** Given：CapitalizedText输入hello，useMemo依赖text；When：交给 render 渲染；Then：日志只有Capitalize hello及HELLO，SPAN文本HELLO。目的：memo计算值交给后续Text组件。 */
    itRenders('basic render', async render => {
      /**
       * 按text依赖memo化大写结果，记录工厂是否调用。
       * @param props - text是hello。
       * @returns 大写值的Text元素。
       */
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

    /** Given：LazyCompute不传deps而computeA返回A；When：交给 render 渲染；Then：日志为compute A及A，SPAN文本A。目的：无依赖数组也能在该次render计算值，本例没有后续更新比较。 */
    itRenders('if no inputs are provided', async render => {
      /**
       * 将props.compute交给没有deps的useMemo。
       * @param props - compute是返回A并记录日志的函数。
       * @returns 计算结果的Text元素。
       */
      function LazyCompute(props) {
        const computed = useMemo(props.compute);
        return <Text text={computed} />;
      }

      /**
       * 记录compute A并返回A，作为useMemo无deps输入。
       * @returns 字符串A。
       */
      function computeA() {
        yieldValue('compute A');
        return 'A';
      }

      const domNode = await render(<LazyCompute compute={computeA} />);
      expect(clearLog()).toEqual(['compute A', 'A']);
      expect(domNode.tagName).toEqual('SPAN');
      expect(domNode.textContent).toEqual('A');
    });

    /** Given：CapitalizedText初始hello并在render改成hello, world.；When：交给 render 渲染；Then：两次大写计算日志后只有最终HELLO, WORLD.，SPAN为该值。目的：render-phase更新改变依赖后重算memo。 */
    itRenders(
      'multiple times when updates happen during the render phase',
      async render => {
        /**
         * 从props.text建state，在hello时排新文本；依赖变化使下一render重新计算大写。
         * @param props - text初值hello。
         * @returns 稳定大写文本的Text元素。
         */
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

    /** Given：text初始hello、count=0，每轮增count，到2时改text；When：交给 render 渲染；Then：计算hello仅一次，count日志0/1/2后计算新文本，再记3和最终大写文本。目的：无关state重试复用memo，依赖变化才重算。 */
    itRenders(
      'should only invoke the memoized function when the inputs change',
      async render => {
        /**
         * 用count制造多次无关state重试，count为2时改text；memo只依赖text，因此日志能区分缓存命中与重算。
         * @param props - text初值hello。
         * @returns memo化大写文本的Text元素。
         */
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

    /** Given：App在useMemo工厂内调用useState；When：交给 render 渲染；Then：render错误预算通常1、坏markup重试为2；可返回模式的文本为hi。目的：嵌套Hook用法产生诊断但该fixture仍返回hi。 */
    itRenders('with a warning for useState inside useMemo', async render => {
      /**
       * 故意在useMemo计算工厂中调用useState；返回hi以观察警告后仍能完成渲染。
       * @returns hi。
       */
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

    /** Given：App在useState初始器内调用useRef(0)；When：交给 render 渲染；Then：错误预算通常1、坏markup为2；可返回模式文本为0。目的：嵌套初始化Hook被诊断，不把警告误作渲染失败。 */
    itRenders('with a warning for useRef inside useState', async render => {
      /**
       * 故意在useState初始器中调用useRef，触发嵌套Hook诊断。
       * @returns 初始state数值0。
       */
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
    /** Given：Counter用useRef给span引用；When：交给 render 渲染；Then：DOM文本Hi。目的：SSR不需要挂载ref就能输出内容。 */
    itRenders('basic render', async render => {
      /**
       * 用useRef创建span引用；SSR只输出内容，不挂载ref。
       * @param props - 本fixture未使用。
       * @returns 带ref且文本Hi的span。
       */
      function Counter(props) {
        const ref = useRef();
        return <span ref={ref}>Hi</span>;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('Hi');
    });

    /** Given：Counter在render把state从0增加到3并每轮读取useRef；When：交给 render 渲染；Then：日志0/1/2/3、DOM为Count: 3。目的：ref Hook可随同render-phase重试消费。 */
    itRenders(
      'multiple times when updates happen during the render phase',
      async render => {
        /**
         * 在render把count递增到3，并每次创建/读取ref Hook且记录count。
         * @param props - 本fixture未使用。
         * @returns 当前Count的引用span。
         */
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

    /** Given：Counter记录首个ref并在后续render校验身份，最终清空共享firstRef；When：交给 render 渲染；Then：日志0/1/2/3、DOM为Count: 3且未抛should never change。目的：同次挂载重渲染保留ref对象，清空记录避免跨模式互相干扰。 */
    itRenders(
      'always return the same reference through multiple renders',
      async render => {
        let firstRef = null;
        /**
         * 比较同次挂载每轮useRef身份，若变化主动抛错；达到3后清空firstRef，避免下一模式被旧记录污染。
         * @param props - 本fixture未使用。
         * @returns Count引用span。
         */
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
    /** Given：Counter的effect记录invoked on client，Text记录Count: 0；When：交给 render 渲染；Then：SPAN文本Count: 0且每个成功返回模式的clearLog存入yields。目的：本用例收集证据；后一个用例才比较服务器未执行effect与客户端执行。 */
    itRenders('should ignore effects on the server', async render => {
      /**
       * 注册只在客户端执行的passive create，并由Text记录Count；跨模式日志由后一个测试核对。
       * @param props - count为0。
       * @returns Count文本的Text元素。
       */
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

    /** Given：前一itRenders已累积四个返回模式的yields；When：直接比较收集数组；Then：与两组Count: 0及两组Count: 0/invoked on client严格相等。目的：错误markup模式提前结束不push；SSR不运行effect而客户端挂载运行。 */
    it('verifies yields in order', () => {
      expect(yields).toEqual([
        ['Count: 0'], // 服务器端渲染（Server-side Rendering, SSR）
        ['Count: 0'], // 服务器流
        ['Count: 0', 'invoked on client'], // 客户端全新渲染
        ['Count: 0', 'invoked on client'], // 已hydrate的渲染
        // 错误标记场景在辅助函数检查文本内容后结束，不返回本用例的日志。
      ]);
    });
  });

  describe('useCallback', () => {
    /** Given：Counter把会yield的函数传给useCallback但不调用；When：交给 render 渲染；Then：日志仅Count: 0，SPAN文本Count: 0。目的：useCallback返回函数引用而不执行它。 */
    itRenders('should not invoke the passed callbacks', async render => {
      /**
       * 向useCallback传入带日志的函数但不调用，验证Hook只保存引用。
       * @param props - count为0。
       * @returns Count文本。
       */
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

    /** Given：Counter输入count=2，取useCallback函数后在render传increment=3；When：交给 render 渲染；Then：日志与SPAN均为Count: 5。目的：回调可由用户在render中显式调用。 */
    itRenders('should support render time callbacks', async render => {
      /**
       * 取得useCallback返回的函数并在render手动传3调用。
       * @param props - count为2，回调按其加increment。
       * @returns Count: 5的Text元素。
       */
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

    /** Given：text初始hello、count反复递增，到2时改text，useCallback依赖text；When：交给 render 渲染；Then：前三个函数引用相等、第四不同，结果和SPAN为HELLO, WORLD.。目的：引用仅在依赖变更时更换。 */
    itRenders(
      'should only change the returned reference when the inputs change',
      async render => {
        /**
         * 按text依赖缓存大写回调，每轮记录函数引用；无关count更新不更换函数，text更新更换。
         * @param props - text初值hello。
         * @returns 显式调用缓存函数后生成的Text元素。
         */
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
    /** Given：forwardRef Counter接current=0的ref，imperative工厂若执行就抛错；When：调用 serverRender；Then：serverRender完成、日志及SPAN为Count: 0。目的：SSR不调用useImperativeHandle的create，不覆写ref.current。 */
    it('should not be invoked on the server', async () => {
      /**
       * 接forwardRef转发的ref，注册一旦执行即抛错的imperative create；SSR只读取现有ref.current。
       * @param props - label为Count。
       * @param ref - 调用者预置current=0的引用。
       * @returns Count: 0的Text元素。
       */
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
    /** Given：Counter注册一执行就抛错的useInsertionEffect；When：调用 serverRender；Then：serverRender错误预算1，日志及SPAN为Count: 0。目的：服务器记录该Hook诊断而不运行effect create。 */
    it('should warn when invoked during render', async () => {
      /**
       * 注册一执行就抛错的InsertionEffect，服务器只记录警告而不执行create。
       * @returns Count: 0的Text元素。
       */
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
    /** Given：Counter注册一执行就抛错的useLayoutEffect；When：调用 serverRender；Then：serverRender错误预算1，日志及SPAN为Count: 0。目的：服务器记录layout Hook诊断而不执行create。 */
    it('should warn when invoked during render', async () => {
      /**
       * 注册一执行就抛错的LayoutEffect，服务器只记录警告而不执行create。
       * @returns Count: 0的Text元素。
       */
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
    /** Given：类Counter.render调用useContext；When：由 itThrowsWhenRendering 驱动 render；Then：itThrowsWhenRendering要求Invalid hook call。目的：Context Hook也不能从类render调用。 */
    itThrowsWhenRendering(
      'if used inside a class component',
      async render => {
        const Context = React.createContext({}, () => {});
        /** 在类render中错误调用useContext的fixture。 */
        class Counter extends React.Component {
          /**
           * 读取Context Hook以触发非法类Hook调用，不能从后续Text得到成功结果。
           * @returns 正常预期是抛Invalid hook call。
           */
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
    /** Given：App的reducer内调用useRef，初值0且render派发一次；When：调用 serverRender；Then：捕获错误非undefined且消息含Rendered more hooks than during the previous render。目的：reducer重试新增Hook打破同组件Hook数量，不仅核对标题中的warn。 */
    it('warns when calling useRef inside useReducer', async () => {
      /**
       * reducer运行时新增useRef，在首次render派发action触发重试，故意改变该组件Hook数量。
       * @returns reducer计数；整体渲染应抛Hook数量错误。
       */
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

  /** Given：Provider从App传入foo=1/bar=3/baz=5，类包装内部重复useContext；When：交给 render 渲染；Then：日志Foo: 1, Bar: 3及Baz: 5，根含两个对应SPAN。目的：同一Context可在同次函数render反复读取，并穿过类包装。 */
  itRenders(
    'can use the same context multiple times in the same function',
    async render => {
      const Context = React.createContext({foo: 0, bar: 0, baz: 0});

      /**
       * 由props组装Context的foo/bar/baz值，包住children。
       * @param props - foo/bar/baz是提供值，children是消费组件树。
       * @returns Context Provider元素。
       */
      function Provider(props) {
        return (
          <Context.Provider
            value={{foo: props.foo, bar: props.bar, baz: props.baz}}>
            {props.children}
          </Context.Provider>
        );
      }

      /**
       * 在同次函数render两次读取同一Context，分别取foo与bar。
       * @returns Foo/Bar组合文本。
       */
      function FooAndBar() {
        const {foo} = useContext(Context);
        const {bar} = useContext(Context);
        return <Text text={`Foo: ${foo}, Bar: ${bar}`} />;
      }

      /**
       * 读取同一个Provider中的baz。
       * @returns Baz文本。
       */
      function Baz() {
        const {baz} = useContext(Context);
        return <Text text={'Baz: ' + baz} />;
      }

      /** 只转发children的类包装，不消费Context。 */
      class Indirection extends React.Component {
        /**
         * 保持组件嵌套而不新增宿主节点。
         * @returns 原this.props.children。
         */
        render() {
          return this.props.children;
        }
      }

      /**
       * 通过多层Indirection包住两个Context消费者。
       * @param props - foo/bar/baz传给Provider。
       * @returns 包含两个最终span的div。
       */
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
    /** Given：Counter调用useDebugValue(123)并渲染返回值typeof；When：交给 render 渲染；Then：DOM文本undefined。目的：调试Hook没有可供UI使用的返回值。 */
    itRenders('is a noop', async render => {
      /**
       * 调用useDebugValue并把其返回值的typeof交给Text。
       * @param props - 本fixture未使用。
       * @returns 显示undefined的Text元素。
       */
      function Counter(props) {
        const debugValue = useDebugValue(123);
        return <Text text={typeof debugValue} />;
      }

      const domNode = await render(<Counter />);
      expect(domNode.textContent).toEqual('undefined');
    });
  });

  describe('readContext', () => {
    /**
     * 读取当前内部dispatcher并只转发Context；调用方传的额外旧bit参数被此函数忽略。
     * @param Context - 当前Context对象。
     * @returns dispatcher.readContext的当前值。
     */
    function readContext(Context) {
      const dispatcher =
        React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
      return dispatcher.readContext(Context);
    }

    /** Given：Provider传1/3/5，类Indirection的SCU返回false，FooAndBar重复readContext；When：交给 render 渲染；Then：日志与两个SPAN为Foo: 1, Bar: 3和Baz: 5。目的：仅验证首次Context读取；wrapper忽略额外bit参数，不证明选择性位传播。 */
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

        /**
         * 组装同一Context的foo/bar/baz提供值；createContext的旧第二参数不构成本用例的位传播证据。
         * @param props - 提供字段及children。
         * @returns Context Provider元素。
         */
        function Provider(props) {
          return (
            <Context.Provider
              value={{foo: props.foo, bar: props.bar, baz: props.baz}}>
              {props.children}
            </Context.Provider>
          );
        }

        /**
         * 两次通过内部readContext读取同一Context，取foo/bar；额外bit参数不被wrapper转发。
         * @returns Foo/Bar文本。
         */
        function FooAndBar() {
          const {foo} = readContext(Context, 0b001);
          const {bar} = readContext(Context, 0b010);
          return <Text text={`Foo: ${foo}, Bar: ${bar}`} />;
        }

        /**
         * 读取Context的baz，旧bit输入在wrapper处被忽略。
         * @returns Baz文本。
         */
        function Baz() {
          const {baz} = readContext(Context, 0b100);
          return <Text text={'Baz: ' + baz} />;
        }

        /** 带固定false SCU的类包装；本例只有首次挂载，不验证更新时的Context穿透。 */
        class Indirection extends React.Component {
          /**
           * 拒绝后续props更新；首次挂载不会调用此判断。
           * @returns false。
           */
          shouldComponentUpdate() {
            return false;
          }
          /**
           * 转发children，不增加宿主包装。
           * @returns 原this.props.children。
           */
          render() {
            return this.props.children;
          }
        }

        /**
         * 把Provider值经多层类包装送到两个内部Context消费者。
         * @param props - foo=1、bar=3、baz=5。
         * @returns 含两个Text输出span的div。
         */
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

    /** Given：Context默认42，分别在useMemo工厂与reducer中调用内部readContext；When：交给 render 渲染；Then：Memo返回42且警告预算1（坏markup2）；其余可返回模式继续渲染Reducer并得42、预算1。目的：错误markup在第一个render提前结束，不能算执行了第二个Reducer断言。 */
    itRenders('with a warning inside useMemo and useReducer', async render => {
      const Context = React.createContext(42);

      /**
       * 在useMemo工厂读取内部Context，触发渲染外读取的诊断但获得默认42。
       * @param props - 本fixture未使用。
       * @returns 显示42的Text元素。
       */
      function ReadInMemo(props) {
        const count = React.useMemo(() => readContext(Context), []);
        return <Text text={count} />;
      }

      /**
       * reducer读取Context，初始count不是42时排action让下一轮取得42；读取位置产生警告。
       * @param props - 本fixture未使用。
       * @returns 当前计数的Text元素。
       */
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

  /** Given：ThrowingComponent从0派发到3后抛错，之后立即SSR一个useState(0)组件；When：先调用失败的 renderToString，再立即调用成功的 renderToString 并解析HTML；Then：首renderToString抛指定错误；下一字符串解析后首元素文本0。目的：错误后的服务器Hook状态被清理，不污染下一次独立请求。 */
  it('renders successfully after a component using hooks throws an error', () => {
    /**
     * render-phase reducer每轮加1，到3抛指定Error，验证失败请求的Hook清理。
     * @returns 未达3时的数值div；稳定返回不会发生。
     */
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

    /**
     * 在前一SSR请求失败后独立读取useState初值0。
     * @returns 显示0的div，证明旧请求Hook状态不泄漏。
     */
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
