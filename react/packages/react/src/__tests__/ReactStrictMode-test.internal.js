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

  // 每例重置模块；levels 内另清空 log，以日志比较严格检查发生范围和阶段。
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

    /** 记录 label 的 render、layout/passive setup 和返回的 cleanup；不输出宿主节点，供严格模式日志顺序。 */
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

    /** 普通 createRoot 直接挂 A，没有 StrictMode；日志为一次 render、layout setup、passive setup，验证默认根不启用严格重放。 */
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
      /** 仅 DEV 定义本例：createRoot({unstable_strictMode:true}) 挂 A，日志双 render、首次两 effect setup、两 cleanup、再两 setup，验证根选项启用严格检查。 */
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

      /** 仅 DEV 定义本例：普通根的直接 StrictMode 包 A，日志双 render及 layout/passive setup→cleanup→setup，验证显式顶层边界。 */
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

      /** 仅 DEV 定义本例：根 Fragment 并列普通 A 与 StrictMode 下 B；A 单 render/effect，B 双 render且 effect 重放，验证严格级别局限于该后代。 */
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

      /** 仅 DEV 定义本例：Wrapper 下并列 A 与嵌套 StrictMode B；B 双 render但两 effect 只 setup 一次，A 也一次，验证此结构的初挂 effect 重放边界；被注释的 cleanup/setup 行未参与期望。 */
      it('should support nested strict mode on initial mount', async () => {
        /** 直接返回 children，给 StrictMode 添加普通函数祖先以检查嵌套初挂行为。 */
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
          // 本例的 StrictMode 嵌在 Wrapper 下：B 的 render 双调用，但初次 effect 只记录一次 setup。
          // 'B: useLayoutEffect unmount',
          // 'B: useEffect unmount',
          // 'B: useLayoutEffect mount',
          // 'B: useEffect mount',
        ]);
      });
    }
  });
});
