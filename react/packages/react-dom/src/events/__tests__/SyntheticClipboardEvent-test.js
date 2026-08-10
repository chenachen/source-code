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
        /**
         * 代表场景（Given–When–Then）：
         * Given 当前文件已建立所需 DOM、React 根与测试夹具；
         * When 执行「returns event's clipboardData」描述的渲染或交互；
         * Then 通过本用例的 DOM、日志或调度断言确认行为。
         *
         * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
         */
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
          /** `eventHandler`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** 测试场景：验证「is able to `preventDefault` and `stopPropagation`」描述的渲染、交互或错误处理结果。 */
    it('is able to `preventDefault` and `stopPropagation`', async () => {
      let expectedCount = 0;

      /** `eventHandler`：封装当前用例复用的操作、回调或断言步骤。 */
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
