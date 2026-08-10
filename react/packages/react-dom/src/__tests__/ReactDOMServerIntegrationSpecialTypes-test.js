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

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;
let forwardRef;
let memo;
let yieldedValues;
let log;
let clearLog;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  forwardRef = React.forwardRef;
  memo = React.memo;

  yieldedValues = [];
  log = value => {
    yieldedValues.push(value);
  };
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

/** `{resetModules, itRenders}`：保存当前测试场景复用的夹具、状态或回调。 */
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
  itRenders('a forwardedRef component and its children', async render => {
    /** `FunctionComponent`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    function Text({text}) {
      log(text);
      return <span>{text}</span>;
    }

    /** `Counter`：封装当前用例复用的操作、回调或断言步骤。 */
    function Counter({count}) {
      return <Text text={'Count: ' + count} />;
    }

    itRenders('basic render', async render => {
      const MemoCounter = memo(Counter);
      const domNode = await render(<MemoCounter count={0} />);
      expect(domNode.textContent).toEqual('Count: 0');
    });

    itRenders('composition with forwardRef', async render => {
      /** `RefCounter`：封装当前用例复用的操作、回调或断言步骤。 */
      const RefCounter = (props, ref) => <Counter count={ref.current} />;
      const MemoRefCounter = memo(forwardRef(RefCounter));

      const ref = React.createRef();
      ref.current = 0;
      await render(<MemoRefCounter ref={ref} />);

      expect(clearLog()).toEqual(['Count: 0']);
    });

    itRenders('with comparator', async render => {
      const MemoCounter = memo(Counter, (oldProps, newProps) => false);
      await render(<MemoCounter count={0} />);
      expect(clearLog()).toEqual(['Count: 0']);
    });

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
