/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

/** 提供跨 SSR、客户端渲染与 hydration 的统一场景展开器；每个 render 入口返回可断言的 DOM 节点。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;
let forwardRef;
let memo;
let yieldedValues;
let log;
let clearLog;

/** 重置 React/client/server 和 forwardRef/memo 引用，并清空 yieldedValues；log/clearLog 随模块隔离重建，供比较器与 Text 的实际调用日志断言。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  forwardRef = React.forwardRef;
  memo = React.memo;

  yieldedValues = [];
  /** 把每次 Text 渲染或比较器输出追加到当前日志，保留调用先后而不操作 DOM。 */
  log = value => {
    yieldedValues.push(value);
  };
  /** 返回上一批日志数组后用新数组重置，确保下一次检查不混入已消费记录。 */
  clearLog = () => {
    const ret = yieldedValues;
    yieldedValues = [];
    return ret;
  };

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 从集成工具取模式重置器和五模式测试展开器；itRenders 的每个定义复用同一场景回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 在服务端、客户端与 hydration 模式中执行同一特殊类型 fixture；
   * When 渲染 ForwardRef 组件及其子节点；
   * Then 断言包装类型不改变输出宿主结构。
   *
   * 验证机制：集成工具串联 react-dom server/client 适配边界并比较 DOM；完整 Fizz 状态机位于范围外
   * 的 `packages/react-server`。
   */
  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；forwardRef 将 ref 透传给输出 div 的函数组件；返回节点应为 DIV且文本 Test，验证包装类型维持宿主输出；本例不另断言 ref.current。 */
  itRenders('a forwardedRef component and its children', async render => {
    /** 将 label 输出到 div，forwardedRef 作为普通 prop 接到宿主 ref，用于 forwardRef 包装测试。 */
    const FunctionComponent = ({label, forwardedRef}) => (
      <div ref={forwardedRef}>{label}</div>
    );
    const WrappedFunctionComponent = forwardRef((props, ref) => (
      <FunctionComponent {...props} forwardedRef={ref} />
    ));

    const ref = React.createRef();
    const element = await render(
      <WrappedFunctionComponent ref={ref} label="Test" />,
    );
    const parent = element.parentNode;
    const div = parent.childNodes[0];
    expect(div.tagName).toBe('DIV');
    expect(div.textContent).toBe('Test');
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；Profiler 包裹 Test div且 onRender 为 mock；节点应为 DIV且文本 Test，验证 profiler 无宿主包装；本例不检查计时回调。 */
  itRenders('a Profiler component and its children', async render => {
    const element = await render(
      <React.Profiler id="profiler" onRender={jest.fn()}>
        <div>Test</div>
      </React.Profiler>,
    );
    const parent = element.parentNode;
    const div = parent.childNodes[0];
    expect(div.tagName).toBe('DIV');
    expect(div.textContent).toBe('Test');
  });

  describe('memoized function components', () => {
    beforeEach(() => {
      resetModules();
    });

    /** 记录 text 后输出 span，让首次 memo 构建与比较器调用可从日志区分。 */
    function Text({text}) {
      log(text);
      return <span>{text}</span>;
    }

    /** 把 count 格式化为 Count 文本并交给 Text，作为 memo 的被包装组件。 */
    function Counter({count}) {
      return <Text text={'Count: ' + count} />;
    }

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；memo 包装 Counter 且 count=0；DOM 文本应为 Count: 0，验证 memo 组件可完成各入口初次渲染。 */
    itRenders('basic render', async render => {
      const MemoCounter = memo(Counter);
      const domNode = await render(<MemoCounter count={0} />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；memo(forwardRef(RefCounter)) 读取 ref.current=0；渲染日志仅 Count: 0，验证 ref 参与包装组件输入并到达 Text。 */
    itRenders('composition with forwardRef', async render => {
      /** 读取传入 ref.current 作为 Counter.count，验证 memo 与 forwardRef 的组合输入。 */
      const RefCounter = (props, ref) => <Counter count={ref.current} />;
      const MemoRefCounter = memo(forwardRef(RefCounter));

      const ref = React.createRef();
      ref.current = 0;
      await render(<MemoRefCounter ref={ref} />);

      expect(clearLog()).toEqual(['Count: 0']);
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；memo 的 comparator 固定返回 false，初次 count=0；日志仅 Count: 0，验证首次渲染不会调用比较器。 */
    itRenders('with comparator', async render => {
      const MemoCounter = memo(Counter, (oldProps, newProps) => false);
      await render(<MemoCounter count={0} />);
      expect(clearLog()).toEqual(['Count: 0']);
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；比较器若调用就记录 Old/New count，初次只给 count=0；日志仅 Count: 0，验证各模式的首次构建不会产生比较日志，本例没有执行后续更新。 */
    itRenders(
      'comparator functions are not invoked on the server',
      async render => {
        const MemoCounter = React.memo(Counter, (oldProps, newProps) => {
          log(`Old count: ${oldProps.count}, New count: ${newProps.count}`);
          return oldProps.count === newProps.count;
        });

        await render(<MemoCounter count={0} />);
        expect(clearLog()).toEqual(['Count: 0']);
      },
    );
  });
});
