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

      /** input 收到原生 key=Del 的 keydown；onKeyDown 读取的 key 应为 Delete，验证旧草案键名查别名表归一化。 */
      it('returns a normalized value', async () => {
        let key = null;

        /** 提供读取 key 的 input 类 fixture，接收旧 Del 键名场景。 */
        class Comp extends React.Component {

          /** 通过 onKeyDown 保存归一化 key，测试读取 handler 结果而非直接调用内部 helper。 */
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

      /** input 收到原生 key=f 的 keydown；回调 key 应保持 f，验证已规范字符键直接透传。 */
      it('returns a key', async () => {
        let key = null;

        /** 提供规范字符键 f 的宿主事件读取 fixture。 */
        class Comp extends React.Component {

          /** 保存 onKeyDown 的 key，检查已规范值不会被别名转换。 */
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

        /** 原生没有 key 的 keypress 带 charCode=13；合成 key 应为 Enter，验证回车兼具字符事件语义的专门分支。 */
        it('returns "Enter"', async () => {
          let key = null;

          /** 提供 Enter 字符编码的 keypress fixture。 */
          class Comp extends React.Component {

            /** 通过 onKeyPress 保存 key，覆盖 charCode=13 的专门映射。 */
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

        /** 原生没有 key 的 keypress 带 charCode=65；合成 key 应为 A，验证字符编码转换而非特殊 keyCode 表。 */
        it('returns a string from a charCode', async () => {
          let key = null;

          /** 提供普通字符编码 keypress fixture。 */
          class Comp extends React.Component {

            /** 读取 onKeyPress.key，覆盖 charCode=65 转 A 的字符回退。 */
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

        /** 原生没有 key 的 keydown 带 keyCode=45；合成 key 应为 Insert，验证功能键编码回退表。 */
        it('returns a translated key', async () => {
          let key = null;

          /** 提供功能键 keyCode 的 keydown fixture。 */
          class Comp extends React.Component {

            /** 读取 onKeyDown.key，检查编码 45 对应 Insert。 */
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

        /** 原生没有 key 的 keydown 带未知 keyCode=1337；合成 key 应为 Unidentified，验证未识别编码不会被猜测为普通字符。 */
        it('returns Unidentified', async () => {
          let key = null;

          /** 提供未识别编码的 keydown fixture。 */
          class Comp extends React.Component {

            /** 保存 onKeyDown.key，检查未知 1337 取 Unidentified。 */
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
