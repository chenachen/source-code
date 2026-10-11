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

describe('SyntheticClipboardEvent', () => {
  let container;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    // 容器必须挂载才能触发事件。
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  describe('ClipboardEvent interface', () => {
    describe('clipboardData', () => {
      describe('when event has clipboardData', () => {

        /** 为 copy/cut/paste 注册同一 handler，向三个原生 Event 手工附加同一个 clipboardData 对象；三个合成回调都应保持该对象身份，计数为 3，验证剪贴板字段复制不克隆数据。 */
        it("returns event's clipboardData", async () => {
          let expectedCount = 0;

          // 模拟剪贴板数据，因为 jsdom 实现中没有构造函数。
          const clipboardData = {
            dropEffect: null,
            effectAllowed: null,
            files: null,
            items: null,
            types: null,
          };

          /** 核对每个合成剪贴板事件的 clipboardData 与 fixture 对象同一，并累计 copy/cut/paste 三次调用。 */
          const eventHandler = event => {
            expect(event.clipboardData).toBe(clipboardData);
            expectedCount++;
          };
          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(
              <div
                onCopy={eventHandler}
                onCut={eventHandler}
                onPaste={eventHandler}
              />,
            );
          });

          const div = container.firstChild;

          let event;
          event = document.createEvent('Event');
          event.initEvent('copy', true, true);
          event.clipboardData = clipboardData;
          await act(() => {
            div.dispatchEvent(event);
          });
          event = document.createEvent('Event');
          event.initEvent('cut', true, true);
          event.clipboardData = clipboardData;
          await act(() => {
            div.dispatchEvent(event);
          });

          event = document.createEvent('Event');
          event.initEvent('paste', true, true);
          event.clipboardData = clipboardData;
          await act(() => {
            div.dispatchEvent(event);
          });

          expect(expectedCount).toBe(3);
        });
      });
    });
  });

  describe('EventInterface', () => {

    /** 对 copy/cut/paste 各派发一次可取消冒泡事件；每次 handler 检查默认与传播查询分别从 false 变为 true，计数为 3，验证剪贴板事件复用基础 SyntheticEvent 状态方法。 */
    it('is able to `preventDefault` and `stopPropagation`', async () => {
      let expectedCount = 0;

      /** 核对剪贴板合成事件取消默认和停止传播后的查询值，再累计三种事件的执行次数。 */
      const eventHandler = event => {
        expect(event.isDefaultPrevented()).toBe(false);
        event.preventDefault();
        expect(event.isDefaultPrevented()).toBe(true);
        expect(event.isPropagationStopped()).toBe(false);
        event.stopPropagation();
        expect(event.isPropagationStopped()).toBe(true);
        expectedCount++;
      };

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <div
            onCopy={eventHandler}
            onCut={eventHandler}
            onPaste={eventHandler}
          />,
        );
      });

      const div = container.firstChild;

      let event;
      event = document.createEvent('Event');
      event.initEvent('copy', true, true);
      div.dispatchEvent(event);

      event = document.createEvent('Event');
      event.initEvent('cut', true, true);
      div.dispatchEvent(event);

      event = document.createEvent('Event');
      event.initEvent('paste', true, true);
      div.dispatchEvent(event);

      expect(expectedCount).toBe(3);
    });
  });
});
