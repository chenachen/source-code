/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {
  insertNodesAndExecuteScripts,
  getVisibleChildren,
} from '../test-utils/FizzTestUtils';
import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;

let act;
let serverAct;
let assertLog;
let waitForPaint;
let container;
let React;
let Scheduler;
let ReactDOMServer;
let ReactDOMClient;
let useDeferredValue;
let Suspense;

describe('ReactDOMFizzForm', () => {
  beforeEach(() => {
    jest.resetModules();
    Scheduler = require('scheduler');
    patchMessageChannel();
    act = require('internal-test-utils').act;
    serverAct = require('internal-test-utils').serverAct;
    React = require('react');
    ReactDOMServer = require('react-dom/server.browser');
    ReactDOMClient = require('react-dom/client');
    useDeferredValue = React.useDeferredValue;
    Suspense = React.Suspense;
    assertLog = require('internal-test-utils').assertLog;
    waitForPaint = require('internal-test-utils').waitForPaint;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `readIntoContainer`：封装当前用例复用的操作、回调或断言步骤。 */
  async function readIntoContainer(stream) {
    const reader = stream.getReader();
    let result = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      result += Buffer.from(value).toString('utf8');
    }
    const temp = document.createElement('div');
    temp.innerHTML = result;
    insertNodesAndExecuteScripts(temp, container, null);
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「returns initialValue argument, if provided」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('returns initialValue argument, if provided', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return useDeferredValue('Final', 'Initial');
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    expect(container.textContent).toEqual('Initial');

    // hydration 完成后更新为最终值。
    await act(() => ReactDOMClient.hydrateRoot(container, <App />));
    expect(container.textContent).toEqual('Final');
  });

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'useDeferredValue during hydration has higher priority than remaining ' +
      'incremental hydration',
    async () => {
      /** `B`：封装当前用例复用的操作、回调或断言步骤。 */
      function B() {
        const text = useDeferredValue('B [Final]', 'B [Initial]');
        return <Text text={text} />;
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <div>
            <span>
              <Text text="A" />
            </span>
            <Suspense fallback={<Text text="Loading..." />}>
              <span>
                <B />
              </span>
              <div>
                <Suspense fallback={<Text text="Loading..." />}>
                  <span id="C" ref={cRef}>
                    <Text text="C" />
                  </span>
                </Suspense>
              </div>
            </Suspense>
          </div>
        );
      }

      const cRef = React.createRef();

      const stream = await serverAct(() =>
        ReactDOMServer.renderToReadableStream(<App />),
      );
      await readIntoContainer(stream);
      assertLog(['A', 'B [Initial]', 'C']);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span>A</span>
          <span>B [Initial]</span>
          <div>
            <span id="C">C</span>
          </div>
        </div>,
      );

      const serverRenderedC = document.getElementById('C');

      // 客户端先水合初始值，再升级为最终值。
      await act(async () => {
        ReactDOMClient.hydrateRoot(container, <App />);

        // 首先水合最外层 Suspense 边界。
        await waitForPaint(['A']);
        expect(cRef.current).toBe(null);

        // 接着水合下一层。该层包含 useDeferredValue，因此应先升级其值，再继续水合更深层级。
        await waitForPaint(['B [Initial]']);
        expect(getVisibleChildren(container)).toEqual(
          <div>
            <span>A</span>
            <span>B [Initial]</span>
            <div>
              <span id="C">C</span>
            </div>
          </div>,
        );
        expect(cRef.current).toBe(null);

        // 本次绘制只应更新 B；C 仍应保持脱水状态。
        await waitForPaint(['B [Final]']);
        expect(getVisibleChildren(container)).toEqual(
          <div>
            <span>A</span>
            <span>B [Final]</span>
            <div>
              <span id="C">C</span>
            </div>
          </div>,
        );
        expect(cRef.current).toBe(null);
      });
      // 最后水合 C。
      assertLog(['C']);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span>A</span>
          <span>B [Final]</span>
          <div>
            <span id="C">C</span>
          </div>
        </div>,
      );
      expect(cRef.current).toBe(serverRenderedC);
    },
  );
});
