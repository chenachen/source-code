/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let useEffect;

/** 验证组件性能轨道的 prop diff、成本上限、时间通道和 DOM-like/BigInt 安全格式化。 */
describe('ReactPerformanceTracks', () => {
  /** 保存 performance.measure 的不可变快照，供每个用例精确比较 DevTools detail。 */
  const performanceMeasureCalls = [];

  /** 清空测量，替换 performance.measure/console.timeStamp，并重载开启性能轨道的 React 模块。 */
  beforeEach(() => {
    performanceMeasureCalls.length = 0;
    Object.defineProperty(performance, 'measure', {
      value: jest.fn((measureName, reusableOptions) => {
        performanceMeasureCalls.push([
          measureName,
          {
            // React 会复用并修改传给 performance.measure 的 options；这里先复制快照。
            ...reusableOptions,
          },
        ]);
      }),
      configurable: true,
    });
    /** 为缺少原生 console.timeStamp 的 Node 环境安装空函数，随后 spy 捕获性能轨道参数；此赋值本身不保存日志。 */
    console.timeStamp = () => {};
    jest.spyOn(console, 'timeStamp').mockImplementation(() => {});

    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    useEffect = React.useEffect;
  });

  /** 按起止时间过滤轨道注册的 timeStamp 调用，保留 Scheduler 与 Components 的 span；读取后清空 mock。 */
  function getConsoleTimestampEntries() {
    try {
      return console.timeStamp.mock.calls.filter(call => {
        const [, startTime, endTime] = call;

        const isRegisterTrackCall = startTime !== 0.003 && endTime !== 0.003;
        return isRegisterTrackCall;
      });
    } finally {
      console.timeStamp.mockClear();
    }
  }

  /** Given–When–Then：Given items 从 [one,two] 更新为追加字符串 4 的数组；When App 每次 render 推进 10ms；Then 21–31 的 measure 记录 Changed Props、Array 与新增索引 2。当前 body 的前后数组内容不同，断言验证新增字段摘要。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('shows a hint if an update is triggered by a deeply equal object', async () => {
    /** 每次 render 推进 10ms，并注册依赖对应 prop 的空 effect，提供固定耗时夹具。 */
    const App = function App({items}) {
      Scheduler.unstable_advanceTime(10);
      useEffect(() => {}, [items]);
    };

    Scheduler.unstable_advanceTime(1);
    const items = ['one', 'two'];
    await act(() => {
      ReactNoop.render(<App items={items} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 11,
          start: 1,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;

    Scheduler.unstable_advanceTime(10);
    await act(() => {
      ReactNoop.render(<App items={items.concat('4')} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​App',
        {
          detail: {
            devtools: {
              color: 'primary-dark',
              properties: [
                ['Changed Props', ''],
                ['  items', 'Array'],
                ['+   2', '…'],
              ],
              tooltipText: 'App',
              track: 'Components ⚛',
            },
          },
          end: 31,
          start: 21,
        },
      ],
    ]);
  });

  /** Given–When–Then：Given 1000 项数组更新为 1001 项；When性能追踪生成 prop diff；Then发现前后数组宽度超过限制后停止深入比较，并输出前后对象超过 100 属性的提示。properties 断言验证宽对象的摘要。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('bails out of diffing wide arrays', async () => {
    /** 每次 render 推进 10ms，并注册依赖对应 prop 的空 effect，提供固定耗时夹具。 */
    const App = function App({items}) {
      Scheduler.unstable_advanceTime(10);
      React.useEffect(() => {}, [items]);
    };

    Scheduler.unstable_advanceTime(1);
    const items = Array.from({length: 1000}, (_, i) => i);
    await act(() => {
      ReactNoop.render(<App items={items} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 11,
          start: 1,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;

    Scheduler.unstable_advanceTime(10);
    await act(() => {
      ReactNoop.render(<App items={items.concat('-1')} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​App',
        {
          detail: {
            devtools: {
              color: 'primary-dark',
              properties: [
                ['Changed Props', ''],
                ['  items', 'Array'],
                [
                  'Previous object has more than 100 properties. React will not attempt to diff objects with too many properties.',
                  '',
                ],
                [
                  'Next object has more than 100 properties. React will not attempt to diff objects with too many properties.',
                  '',
                ],
              ],
              tooltipText: 'App',
              track: 'Components ⚛',
            },
          },
          end: 31,
          start: 21,
        },
      ],
    ]);
  });

  /** Given–When–Then：Given data.buffer 从 null 变为 1000 长度 Uint8Array；When记录 App 更新；Then diff 只显示 buffer 类型/长度，不展开每个索引。通过 measure properties 验证 typed data 摘要。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('does not show all properties of wide objects', async () => {
    /** render 推进 10ms；实际传入 data，故 items 始终为 undefined。轨道比较 data，无须 effect 依赖变化。 */
    const App = function App({items}) {
      Scheduler.unstable_advanceTime(10);
      React.useEffect(() => {}, [items]);
    };

    Scheduler.unstable_advanceTime(1);
    await act(() => {
      ReactNoop.render(<App data={{buffer: null}} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 11,
          start: 1,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;

    Scheduler.unstable_advanceTime(10);

    const bigData = new Uint8Array(1000);
    await act(() => {
      ReactNoop.render(<App data={{buffer: bigData}} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​App',
        {
          detail: {
            devtools: {
              color: 'primary-dark',
              properties: [
                ['Changed Props', ''],
                ['  data', ''],
                ['-   buffer', 'null'],
                ['+   buffer', 'Uint8Array(1000)'],
              ],
              tooltipText: 'App',
              track: 'Components ⚛',
            },
          },
          end: 31,
          start: 21,
        },
      ],
    ]);
  });

  /** Given–When–Then：Given buffer 从 Uint8Array(0) 变 Float32Array(1000)；When组件更新；Then追踪只报告类型和长度，避免逐项枚举冻结 render。通过精确 properties 验证 #36200。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('shows the type and length of typed arrays instead of enumerating them', async () => {
    /** 每次 render 推进 10ms，并注册依赖对应 prop 的空 effect，提供固定耗时夹具。 */
    const App = function App({buffer}) {
      Scheduler.unstable_advanceTime(10);
      React.useEffect(() => {}, [buffer]);
    };

    Scheduler.unstable_advanceTime(1);
    await act(() => {
      ReactNoop.render(<App buffer={new Uint8Array(0)} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 11,
          start: 1,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;

    Scheduler.unstable_advanceTime(10);

    // typed array 可能包含数百万元素；React 不能逐项枚举，
    // 否则会冻结渲染（#36200）。
    await act(() => {
      ReactNoop.render(<App buffer={new Float32Array(1000)} />);
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​App',
        {
          detail: {
            devtools: {
              color: 'primary-dark',
              properties: [
                ['Changed Props', ''],
                ['-\xa0buffer', 'Uint8Array(0)'],
                ['+\xa0buffer', 'Float32Array(1000)'],
              ],
              tooltipText: 'App',
              track: 'Components ⚛',
            },
          },
          end: 31,
          start: 21,
        },
      ],
    ]);
  });

  /** Given–When–Then：Given Left prop 变化耗时 5s，Right props 不变但仍耗时 10s；When更新提交；Then Left 用 performance.measure 记录 diff，Right 用 console.timeStamp span 保留无 prop 变化的耗时。通过两个通道验证完整组件轨道。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('includes console.timeStamp spans for Components with no prop changes', async () => {
    /** 消耗 5000ms 且接收可变 value，产生带 Changed Props 的显式 measure。 */
    function Left({value}) {
      Scheduler.unstable_advanceTime(5000);
    }
    /** 消耗 10000ms 但 props 不变，必须通过 console.timeStamp span 保留耗时。 */
    function Right() {
      Scheduler.unstable_advanceTime(10000);
    }

    await act(() => {
      ReactNoop.render(
        <>
          <Left value={1} />
          <Right />
        </>,
      );
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 5000,
          start: 0,
        },
      ],
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 15000,
          start: 5000,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;
    getConsoleTimestampEntries();

    Scheduler.unstable_advanceTime(1000);

    await act(() => {
      ReactNoop.render(
        <>
          <Left value={2} />
          <Right />
        </>,
      );
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​Left',
        {
          detail: {
            devtools: {
              color: 'error',
              properties: [
                ['Changed Props', ''],
                ['- value', '1'],
                ['+ value', '2'],
              ],
              tooltipText: 'Left',
              track: 'Components ⚛',
            },
          },
          end: 21000,
          start: 16000,
        },
      ],
    ]);
    expect(getConsoleTimestampEntries()).toEqual([
      ['Render', 16000, 31000, 'Blocking', 'Scheduler ⚛', 'primary-dark'],
      ['Right', 21000, 31000, 'Components ⚛', undefined, 'error'],
    ]);
    performanceMeasureCalls.length = 0;
  });

  /** Given–When–Then：Given深层 numbers 从 [1n] 变 [2n]；When生成 prop diff；Then追踪不因 BigInt 序列化抛错，并将前后值概括为 Array。通过嵌套 properties 验证安全格式化。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('can handle bigint in arrays', async () => {
    /** render 推进 10ms；实际传入 data，numbers 依赖保持 undefined。嵌套 BigInt diff 来自轨道的 props 比较。 */
    const App = function App({numbers}) {
      Scheduler.unstable_advanceTime(10);
      React.useEffect(() => {}, [numbers]);
    };

    Scheduler.unstable_advanceTime(1);
    await act(() => {
      ReactNoop.render(
        <App
          data={{
            deeply: {
              nested: {
                numbers: [1n],
              },
            },
          }}
        />,
      );
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 11,
          start: 1,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;

    Scheduler.unstable_advanceTime(10);

    await act(() => {
      ReactNoop.render(
        <App
          data={{
            deeply: {
              nested: {
                numbers: [2n],
              },
            },
          }}
        />,
      );
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​App',
        {
          detail: {
            devtools: {
              color: 'primary-dark',
              properties: [
                ['Changed Props', ''],
                ['  data', ''],
                ['    deeply', ''],
                ['      nested', ''],
                ['-       numbers', 'Array'],
                ['+       numbers', 'Array'],
              ],
              tooltipText: 'App',
              track: 'Components ⚛',
            },
          },
          end: 31,
          start: 21,
        },
      ],
    ]);
  });

  /** Given–When–Then：Given仿 HTMLIFrameElement 的 container 文本从 foo 变 bar，opaque contentWindow 禁止任意属性读取；When生成深层 diff；Then只访问允许字段、报告 iframe 内容变化，并识别另一个 window 深相等但引用不同。通过未抛代理错误与 properties 验证 DOM-like 特判。 */
  // @gate __DEV__ && enableComponentPerformanceTrack
  it('diffs HTML-like objects', async () => {
    /** 每次 render 推进 10ms，并注册依赖对应 prop 的空 effect，提供固定耗时夹具。 */
    const App = function App({container}) {
      Scheduler.unstable_advanceTime(10);
      React.useEffect(() => {}, [container]);
    };

    /** opaque origin contentWindow 的最小品牌对象，仅暴露 Symbol.toStringTag。 */
    class Window {}
    /** 用 Proxy 拒绝任意属性读取，检测 prop diff 是否越界遍历 Window。 */
    const createOpaqueOriginWindow = () => {
      return new Proxy(new Window(), {
        /** 只允许读取 Symbol.toStringTag（本 Window 没有定义它，结果为 undefined）；其他 named property 访问立即报错。 */
        get(target, prop) {
          if (prop === Symbol.toStringTag) {
            return target[Symbol.toStringTag];
          }
          // JavaScript 自身可能读取少量元属性，例如
          // Symbol.toStringTag，允许这些访问。
          // 其他访问一律抛错，确保 React 不扫描任意属性。
          throw new Error(
            `Failed to read named property '${String(prop)}' from Window`,
          );
        },
      });
    };

    /** 模拟可枚举 DOM-like iframe：包含文本、contentWindow、nodeType 和 HTML 品牌。 */
    class OpaqueOriginHTMLIFrameElement {
      /** 保存可变 textContent，作为两代 iframe prop diff 的真实变化。 */
      constructor(textContent) {
        this.textContent = textContent;
      }
      /** opaque Window 实例；React 只能识别品牌，不能深扫任意属性。 */
      contentWindow = createOpaqueOriginWindow();
      /** 元素节点标记，使 diff 进入 HTML-like 对象格式化路径。 */
      nodeType = 1;
      /** 浏览器品牌字符串，用于把模拟对象显示为 HTMLIFrameElement。 */
      [Symbol.toStringTag] = 'HTMLIFrameElement';
    }

    Scheduler.unstable_advanceTime(1);
    await act(() => {
      ReactNoop.render(
        <App
          container={new OpaqueOriginHTMLIFrameElement('foo')}
          contentWindow={createOpaqueOriginWindow()}
        />,
      );
    });

    expect(performanceMeasureCalls).toEqual([
      [
        'Mount',
        {
          detail: {
            devtools: {
              color: 'warning',
              properties: null,
              tooltipText: 'Mount',
              track: 'Components ⚛',
            },
          },
          end: 11,
          start: 1,
        },
      ],
    ]);
    performanceMeasureCalls.length = 0;

    Scheduler.unstable_advanceTime(10);

    await act(() => {
      ReactNoop.render(
        <App
          container={new OpaqueOriginHTMLIFrameElement('bar')}
          contentWindow={createOpaqueOriginWindow()}
        />,
      );
    });

    expect(performanceMeasureCalls).toEqual([
      [
        '​App',
        {
          detail: {
            devtools: {
              color: 'primary-dark',
              properties: [
                ['Changed Props', ''],
                ['- container', 'HTMLIFrameElement'],
                ['-   contentWindow', 'Window'],
                ['-   nodeType', '1'],
                ['-   textContent', '"foo"'],
                ['+ container', 'HTMLIFrameElement'],
                ['+   contentWindow', 'Window'],
                ['+   nodeType', '1'],
                ['+   textContent', '"bar"'],
                [
                  '  contentWindow',
                  'Referentially unequal but deeply equal objects. Consider memoization.',
                ],
              ],
              tooltipText: 'App',
              track: 'Components ⚛',
            },
          },
          end: 31,
          start: 21,
        },
      ],
    ]);
  });
});
