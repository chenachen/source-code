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

  /** 读完 Web Stream 所有字节，解析后调用 Fizz 节点搬移/脚本 helper；本函数没有 await 该 helper 返回的 Promise。 */
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

  /** 记录当前阶段的文本并原样输出，用日志区分 deferred 初值、终值与深层 hydration。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** App 对 Final 使用 initialValue=Initial；浏览器流 SSR 文本应为 Initial，同一树 hydration 后变为 Final，验证 deferred 初始值维持服务器同构输出再安排客户端升级。 */
  it('returns initialValue argument, if provided', async () => {
    /** 对固定 Final 指定 Initial 初值，服务器与 hydration 首轮使用 Initial，随后客户端升级。 */
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

  /** SSR 中 B 使用 deferred Initial、C 位于更深 Suspense；分步 hydration 应先记录 A、B Initial、B Final，前三步 C ref 仍 null，最后才认领原 C 节点，验证 deferred 升级比剩余深层 hydration 更紧急且保持 C 宿主身份。 */
  it(
    'useDeferredValue during hydration has higher priority than remaining ' +
      'incremental hydration',
    async () => {
      /** 输出带明确 Initial/Final 标识的 deferred 值，让中层 hydration 后的升级时机可观察。 */
      function B() {
        const text = useDeferredValue('B [Final]', 'B [Initial]');
        return <Text text={text} />;
      }

      /** 组合同步 A、含 B 的 Suspense 和更深含 ref 的 C；ref 是否为 null 标识 C 是否已被 hydration 认领。 */
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
