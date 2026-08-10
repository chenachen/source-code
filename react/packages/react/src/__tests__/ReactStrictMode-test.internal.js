/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactStrictMode', () => {
  let React;
  let ReactDOMClient;
  let act;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');

    act = require('internal-test-utils').act;
  });

  describe('levels', () => {
    let log;

    beforeEach(() => {
      log = [];
    });

    /** 作为“levels”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Component({label}) {
      React.useEffect(() => {
        log.push(`${label}: useEffect mount`);
        return () => log.push(`${label}: useEffect unmount`);
      });

      React.useLayoutEffect(() => {
        log.push(`${label}: useLayoutEffect mount`);
        return () => log.push(`${label}: useLayoutEffect unmount`);
      });

      log.push(`${label}: render`);

      return null;
    }

    /**
     * Given：已建立该文件所需的 renderer、容器与测试夹具。
     * When：执行“should default to not strict”场景的唯一关键操作。
     * Then：断言 StrictMode 的内部重复执行与 Effect 重放契约 的可观察结果。
     *
     * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
     */
    it('should default to not strict', async () => {
      await act(() => {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        root.render(<Component label="A" />);
      });

      expect(log).toEqual([
        'A: render',
        'A: useLayoutEffect mount',
        'A: useEffect mount',
      ]);
    });

    if (__DEV__) {
      /**
       * 场景：“should support enabling strict mode via createRoot option”。
       * 机制：验证StrictMode 的内部重复执行与 Effect 重放契约，锁定可观察结果与失败边界。
       */
      it('should support enabling strict mode via createRoot option', async () => {
        await act(() => {
          const container = document.createElement('div');
          const root = ReactDOMClient.createRoot(container, {
            unstable_strictMode: true,
          });
          root.render(<Component label="A" />);
        });

        expect(log).toEqual([
          'A: render',
          'A: render',
          'A: useLayoutEffect mount',
          'A: useEffect mount',
          'A: useLayoutEffect unmount',
          'A: useEffect unmount',
          'A: useLayoutEffect mount',
          'A: useEffect mount',
        ]);
      });

      /**
       * 场景：“should include legacy + strict effects mode”。
       * 机制：验证StrictMode 的内部重复执行与 Effect 重放契约，锁定可观察结果与失败边界。
       */
      it('should include legacy + strict effects mode', async () => {
        await act(() => {
          const container = document.createElement('div');
          const root = ReactDOMClient.createRoot(container);
          root.render(
            <React.StrictMode>
              <Component label="A" />
            </React.StrictMode>,
          );
        });

        expect(log).toEqual([
          'A: render',
          'A: render',
          'A: useLayoutEffect mount',
          'A: useEffect mount',
          'A: useLayoutEffect unmount',
          'A: useEffect unmount',
          'A: useLayoutEffect mount',
          'A: useEffect mount',
        ]);
      });

      /**
       * 场景：“should allow level to be increased with nesting”。
       * 机制：验证StrictMode 的内部重复执行与 Effect 重放契约，锁定可观察结果与失败边界。
       */
      it('should allow level to be increased with nesting', async () => {
        await act(() => {
          const container = document.createElement('div');
          const root = ReactDOMClient.createRoot(container);
          root.render(
            <>
              <Component label="A" />
              <React.StrictMode>
                <Component label="B" />,
              </React.StrictMode>
              ,
            </>,
          );
        });

        expect(log).toEqual([
          'A: render',
          'B: render',
          'B: render',
          'A: useLayoutEffect mount',
          'B: useLayoutEffect mount',
          'A: useEffect mount',
          'B: useEffect mount',
          'B: useLayoutEffect unmount',
          'B: useEffect unmount',
          'B: useLayoutEffect mount',
          'B: useEffect mount',
        ]);
      });

      /**
       * 场景：“should support nested strict mode on initial mount”。
       * 机制：验证StrictMode 的内部重复执行与 Effect 重放契约，锁定可观察结果与失败边界。
       */
      it('should support nested strict mode on initial mount', async () => {
        /** 作为“should support nested strict mode on initial mount”场景的函数夹具，返回待协调内容或触发目标行为。 */
        function Wrapper({children}) {
          return children;
        }
        await act(() => {
          const container = document.createElement('div');
          const root = ReactDOMClient.createRoot(container);
          root.render(
            <Wrapper>
              <Component label="A" />
              <React.StrictMode>
                <Component label="B" />,
              </React.StrictMode>
              ,
            </Wrapper>,
          );
        });

        expect(log).toEqual([
          'A: render',
          'B: render',
          'B: render',
          'A: useLayoutEffect mount',
          'B: useLayoutEffect mount',
          'A: useEffect mount',
          'B: useEffect mount',
      // TODO：以下 Effect 卸载与重新挂载顺序当前尚未实现，暂不纳入期望数组。
          // 'B: useLayoutEffect unmount',
          // 'B: useEffect unmount',
          // 'B: useLayoutEffect mount',
          // 'B: useEffect mount',
        ]);
      });
    }
  });
});
