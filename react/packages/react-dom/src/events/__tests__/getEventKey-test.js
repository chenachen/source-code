/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;

let act;

describe('getEventKey', () => {
  let container;
  let root;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');

    act = require('internal-test-utils').act;

    // 容器必须挂载才能触发事件。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
    root = null;
  });

  describe('when key is implemented in a browser', () => {
    describe('when key is not normalized', () => {
      /**
       * 代表场景（Given–When–Then）：
       * Given 当前文件已建立所需 DOM、React 根与测试夹具；
       * When 执行「returns a normalized value」描述的渲染或交互；
       * Then 通过本用例的 DOM、日志或调度断言确认行为。
       *
       * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
       */
      it('returns a normalized value', async () => {
        let key = null;
        /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class Comp extends React.Component {
          /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <input onKeyDown={e => (key = e.key)} />;
          }
        }

        await act(() => {
          root.render(<Comp />);
        });

        const nativeEvent = new KeyboardEvent('keydown', {
          key: 'Del',
          bubbles: true,
          cancelable: true,
        });
        container.firstChild.dispatchEvent(nativeEvent);
        expect(key).toBe('Delete');
      });
    });

    describe('when key is normalized', () => {
      /** 测试场景：验证「returns a key」描述的渲染、交互或错误处理结果。 */
      it('returns a key', async () => {
        let key = null;
        /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class Comp extends React.Component {
          /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <input onKeyDown={e => (key = e.key)} />;
          }
        }

        await act(() => {
          root.render(<Comp />);
        });

        const nativeEvent = new KeyboardEvent('keydown', {
          key: 'f',
          bubbles: true,
          cancelable: true,
        });
        container.firstChild.dispatchEvent(nativeEvent);
        expect(key).toBe('f');
      });
    });
  });

  describe('when key is not implemented in a browser', () => {
    describe('when event type is keypress', () => {
      describe('when charCode is 13', () => {
        /** 测试场景：验证「returns "Enter"」描述的渲染、交互或错误处理结果。 */
        it('returns "Enter"', async () => {
          let key = null;
          /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
          class Comp extends React.Component {
            /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
            render() {
              return <input onKeyPress={e => (key = e.key)} />;
            }
          }

          await act(() => {
            root.render(<Comp />);
          });

          const nativeEvent = new KeyboardEvent('keypress', {
            charCode: 13,
            bubbles: true,
            cancelable: true,
          });
          container.firstChild.dispatchEvent(nativeEvent);
          expect(key).toBe('Enter');
        });
      });

      describe('when charCode is not 13', () => {
        /** 测试场景：验证「returns a string from a charCode」描述的渲染、交互或错误处理结果。 */
        it('returns a string from a charCode', async () => {
          let key = null;
          /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
          class Comp extends React.Component {
            /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
            render() {
              return <input onKeyPress={e => (key = e.key)} />;
            }
          }

          await act(() => {
            root.render(<Comp />);
          });

          const nativeEvent = new KeyboardEvent('keypress', {
            charCode: 65,
            bubbles: true,
            cancelable: true,
          });
          container.firstChild.dispatchEvent(nativeEvent);
          expect(key).toBe('A');
        });
      });
    });

    describe('when event type is keydown or keyup', () => {
      describe('when keyCode is recognized', () => {
        /** 测试场景：验证「returns a translated key」描述的渲染、交互或错误处理结果。 */
        it('returns a translated key', async () => {
          let key = null;
          /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
          class Comp extends React.Component {
            /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
            render() {
              return <input onKeyDown={e => (key = e.key)} />;
            }
          }

          await act(() => {
            root.render(<Comp />);
          });

          const nativeEvent = new KeyboardEvent('keydown', {
            keyCode: 45,
            bubbles: true,
            cancelable: true,
          });
          container.firstChild.dispatchEvent(nativeEvent);
          expect(key).toBe('Insert');
        });
      });

      describe('when keyCode is not recognized', () => {
        /** 测试场景：验证「returns Unidentified」描述的渲染、交互或错误处理结果。 */
        it('returns Unidentified', async () => {
          let key = null;
          /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
          class Comp extends React.Component {
            /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
            render() {
              return <input onKeyDown={e => (key = e.key)} />;
            }
          }

          await act(() => {
            root.render(<Comp />);
          });

          const nativeEvent = new KeyboardEvent('keydown', {
            keyCode: 1337,
            bubbles: true,
            cancelable: true,
          });
          container.firstChild.dispatchEvent(nativeEvent);
          expect(key).toBe('Unidentified');
        });
      });
    });
  });
});
