/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

describe('ReactDOMEventListener', () => {
  let React;
  let OuterReactDOMClient;
  let InnerReactDOM;
  let InnerReactDOMClient;
  let act;
  let container;
  let root;

  beforeEach(() => {
    window.TextEvent = function () {};
    jest.resetModules();
    jest.isolateModules(() => {
      React = require('react');
      act = require('internal-test-utils').act;
      OuterReactDOMClient = require('react-dom/client');
    });
    jest.isolateModules(() => {
      InnerReactDOM = require('react-dom');
      InnerReactDOMClient = require('react-dom/client');
    });
    expect(OuterReactDOMClient).not.toBe(InnerReactDOMClient);
  });

  afterEach(async () => {
    await cleanup();
  });

  /** `cleanup`：封装当前用例复用的操作、回调或断言步骤。 */
  async function cleanup() {
    if (container) {
      await act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
      container = null;
    }
  }

  /** `render`：封装当前用例复用的操作、回调或断言步骤。 */
  async function render(tree) {
    await cleanup();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = OuterReactDOMClient.createRoot(container);
    await act(() => {
      root.render(tree);
    });
  }

  describe('bubbling events', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「onAnimationEnd」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
     */
    it('onAnimationEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAnimationEnd',
        reactEventType: 'animationend',
        nativeEvent: 'animationend',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('animationend', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onAnimationIteration」描述的渲染、交互或错误处理结果。 */
    it('onAnimationIteration', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAnimationIteration',
        reactEventType: 'animationiteration',
        nativeEvent: 'animationiteration',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('animationiteration', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onAnimationStart」描述的渲染、交互或错误处理结果。 */
    it('onAnimationStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAnimationStart',
        reactEventType: 'animationstart',
        nativeEvent: 'animationstart',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('animationstart', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onAuxClick」描述的渲染、交互或错误处理结果。 */
    it('onAuxClick', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAuxClick',
        reactEventType: 'auxclick',
        nativeEvent: 'auxclick',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new KeyboardEvent('auxclick', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onBlur」描述的渲染、交互或错误处理结果。 */
    it('onBlur', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onBlur',
        reactEventType: 'blur',
        nativeEvent: 'focusout',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('focusout', {
            bubbles: true,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    // 该测试在仅供 WWW 使用的 legacy 模式下会失败，因为该模式模拟 React 16，把 click 处理器挂到
    // document 上。
    // @gate !enableLegacyFBSupport
    /** 测试场景：验证「onClick」描述的渲染、交互或错误处理结果。 */
    it('onClick', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onClick',
        reactEventType: 'click',
        nativeEvent: 'click',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.click();
        },
      });
    });

    /** 测试场景：验证「onContextMenu」描述的渲染、交互或错误处理结果。 */
    it('onContextMenu', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onContextMenu',
        reactEventType: 'contextmenu',
        nativeEvent: 'contextmenu',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onCopy」描述的渲染、交互或错误处理结果。 */
    it('onCopy', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onCopy',
        reactEventType: 'copy',
        nativeEvent: 'copy',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('copy', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onCut」描述的渲染、交互或错误处理结果。 */
    it('onCut', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onCut',
        reactEventType: 'cut',
        nativeEvent: 'cut',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('cut', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDoubleClick」描述的渲染、交互或错误处理结果。 */
    it('onDoubleClick', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDoubleClick',
        reactEventType: 'dblclick',
        nativeEvent: 'dblclick',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new KeyboardEvent('dblclick', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDrag」描述的渲染、交互或错误处理结果。 */
    it('onDrag', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDrag',
        reactEventType: 'drag',
        nativeEvent: 'drag',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('drag', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDragEnd」描述的渲染、交互或错误处理结果。 */
    it('onDragEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragEnd',
        reactEventType: 'dragend',
        nativeEvent: 'dragend',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('dragend', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDragEnter」描述的渲染、交互或错误处理结果。 */
    it('onDragEnter', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragEnter',
        reactEventType: 'dragenter',
        nativeEvent: 'dragenter',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('dragenter', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDragExit」描述的渲染、交互或错误处理结果。 */
    it('onDragExit', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragExit',
        reactEventType: 'dragexit',
        nativeEvent: 'dragexit',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('dragexit', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDragLeave」描述的渲染、交互或错误处理结果。 */
    it('onDragLeave', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragLeave',
        reactEventType: 'dragleave',
        nativeEvent: 'dragleave',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('dragleave', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDragOver」描述的渲染、交互或错误处理结果。 */
    it('onDragOver', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragOver',
        reactEventType: 'dragover',
        nativeEvent: 'dragover',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('dragover', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDragStart」描述的渲染、交互或错误处理结果。 */
    it('onDragStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragStart',
        reactEventType: 'dragstart',
        nativeEvent: 'dragstart',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('dragstart', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onDrop」描述的渲染、交互或错误处理结果。 */
    it('onDrop', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDrop',
        reactEventType: 'drop',
        nativeEvent: 'drop',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('drop', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onFocus」描述的渲染、交互或错误处理结果。 */
    it('onFocus', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onFocus',
        reactEventType: 'focus',
        nativeEvent: 'focusin',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('focusin', {
            bubbles: true,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onGotPointerCapture」描述的渲染、交互或错误处理结果。 */
    it('onGotPointerCapture', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onGotPointerCapture',
        reactEventType: 'gotpointercapture',
        nativeEvent: 'gotpointercapture',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('gotpointercapture', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onKeyDown」描述的渲染、交互或错误处理结果。 */
    it('onKeyDown', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onKeyDown',
        reactEventType: 'keydown',
        nativeEvent: 'keydown',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onKeyPress」描述的渲染、交互或错误处理结果。 */
    it('onKeyPress', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onKeyPress',
        reactEventType: 'keypress',
        nativeEvent: 'keypress',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new KeyboardEvent('keypress', {
              keyCode: 13,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onKeyUp」描述的渲染、交互或错误处理结果。 */
    it('onKeyUp', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onKeyUp',
        reactEventType: 'keyup',
        nativeEvent: 'keyup',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new KeyboardEvent('keyup', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onLostPointerCapture」描述的渲染、交互或错误处理结果。 */
    it('onLostPointerCapture', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onLostPointerCapture',
        reactEventType: 'lostpointercapture',
        nativeEvent: 'lostpointercapture',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('lostpointercapture', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onMouseDown」描述的渲染、交互或错误处理结果。 */
    it('onMouseDown', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseDown',
        reactEventType: 'mousedown',
        nativeEvent: 'mousedown',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onMouseOut」描述的渲染、交互或错误处理结果。 */
    it('onMouseOut', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseOut',
        reactEventType: 'mouseout',
        nativeEvent: 'mouseout',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('mouseout', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onMouseOver」描述的渲染、交互或错误处理结果。 */
    it('onMouseOver', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseOver',
        reactEventType: 'mouseover',
        nativeEvent: 'mouseover',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('mouseover', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onMouseUp」描述的渲染、交互或错误处理结果。 */
    it('onMouseUp', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseUp',
        reactEventType: 'mouseup',
        nativeEvent: 'mouseup',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPaste」描述的渲染、交互或错误处理结果。 */
    it('onPaste', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPaste',
        reactEventType: 'paste',
        nativeEvent: 'paste',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('paste', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPointerCancel」描述的渲染、交互或错误处理结果。 */
    it('onPointerCancel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerCancel',
        reactEventType: 'pointercancel',
        nativeEvent: 'pointercancel',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('pointercancel', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPointerDown」描述的渲染、交互或错误处理结果。 */
    it('onPointerDown', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerDown',
        reactEventType: 'pointerdown',
        nativeEvent: 'pointerdown',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('pointerdown', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPointerMove」描述的渲染、交互或错误处理结果。 */
    it('onPointerMove', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerMove',
        reactEventType: 'pointermove',
        nativeEvent: 'pointermove',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('pointermove', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPointerOut」描述的渲染、交互或错误处理结果。 */
    it('onPointerOut', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerOut',
        reactEventType: 'pointerout',
        nativeEvent: 'pointerout',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('pointerout', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPointerOver」描述的渲染、交互或错误处理结果。 */
    it('onPointerOver', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerOver',
        reactEventType: 'pointerover',
        nativeEvent: 'pointerover',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('pointerover', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onPointerUp」描述的渲染、交互或错误处理结果。 */
    it('onPointerUp', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerUp',
        reactEventType: 'pointerup',
        nativeEvent: 'pointerup',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('pointerup', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onReset」描述的渲染、交互或错误处理结果。 */
    it('onReset', async () => {
      await testNativeBubblingEvent({
        type: 'form',
        reactEvent: 'onReset',
        reactEventType: 'reset',
        nativeEvent: 'reset',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('reset', {
            bubbles: true,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onSubmit」描述的渲染、交互或错误处理结果。 */
    it('onSubmit', async () => {
      await testNativeBubblingEvent({
        type: 'form',
        reactEvent: 'onSubmit',
        reactEventType: 'submit',
        nativeEvent: 'submit',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new SubmitEvent('submit', {
            bubbles: true,
            cancelable: true,
            submitter: null,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onTouchCancel」描述的渲染、交互或错误处理结果。 */
    it('onTouchCancel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchCancel',
        reactEventType: 'touchcancel',
        nativeEvent: 'touchcancel',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('touchcancel', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTouchEnd」描述的渲染、交互或错误处理结果。 */
    it('onTouchEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchEnd',
        reactEventType: 'touchend',
        nativeEvent: 'touchend',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('touchend', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTouchMove」描述的渲染、交互或错误处理结果。 */
    it('onTouchMove', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchMove',
        reactEventType: 'touchmove',
        nativeEvent: 'touchmove',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('touchmove', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTouchStart」描述的渲染、交互或错误处理结果。 */
    it('onTouchStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchStart',
        reactEventType: 'touchstart',
        nativeEvent: 'touchstart',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('touchstart', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTransitionRun」描述的渲染、交互或错误处理结果。 */
    it('onTransitionRun', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionRun',
        reactEventType: 'transitionrun',
        nativeEvent: 'transitionrun',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('transitionrun', {
              bubbles: true,
              cancelable: false,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTransitionStart」描述的渲染、交互或错误处理结果。 */
    it('onTransitionStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionStart',
        reactEventType: 'transitionstart',
        nativeEvent: 'transitionstart',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('transitionstart', {
              bubbles: true,
              cancelable: false,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTransitionCancel」描述的渲染、交互或错误处理结果。 */
    it('onTransitionCancel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionCancel',
        reactEventType: 'transitioncancel',
        nativeEvent: 'transitioncancel',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('transitioncancel', {
              bubbles: true,
              cancelable: false,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onTransitionEnd」描述的渲染、交互或错误处理结果。 */
    it('onTransitionEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionEnd',
        reactEventType: 'transitionend',
        nativeEvent: 'transitionend',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('transitionend', {
              bubbles: true,
              cancelable: false,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onWheel」描述的渲染、交互或错误处理结果。 */
    it('onWheel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onWheel',
        reactEventType: 'wheel',
        nativeEvent: 'wheel',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('wheel', {
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onFullscreenChange」描述的渲染、交互或错误处理结果。 */
    it('onFullscreenChange', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onFullscreenChange',
        reactEventType: 'fullscreenchange',
        nativeEvent: 'fullscreenchange',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('fullscreenchange', {
              bubbles: true,
              cancelable: false,
            }),
          );
        },
      });
    });

    /** 测试场景：验证「onFullscreenError」描述的渲染、交互或错误处理结果。 */
    it('onFullscreenError', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onFullscreenError',
        reactEventType: 'fullscreenerror',
        nativeEvent: 'fullscreenerror',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          node.dispatchEvent(
            new Event('fullscreenerror', {
              bubbles: true,
              cancelable: false,
            }),
          );
        },
      });
    });
  });

  describe('non-bubbling events that bubble in React', () => {
    /** 测试场景：验证「onAbort」描述的渲染、交互或错误处理结果。 */
    it('onAbort', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onAbort',
        reactEventType: 'abort',
        nativeEvent: 'abort',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('abort', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onCancel」描述的渲染、交互或错误处理结果。 */
    it('onCancel', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onCancel',
        reactEventType: 'cancel',
        nativeEvent: 'cancel',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('cancel', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onCanPlay」描述的渲染、交互或错误处理结果。 */
    it('onCanPlay', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onCanPlay',
        reactEventType: 'canplay',
        nativeEvent: 'canplay',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('canplay', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onCanPlayThrough」描述的渲染、交互或错误处理结果。 */
    it('onCanPlayThrough', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onCanPlayThrough',
        reactEventType: 'canplaythrough',
        nativeEvent: 'canplaythrough',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('canplaythrough', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onClose」描述的渲染、交互或错误处理结果。 */
    it('onClose', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onClose',
        reactEventType: 'close',
        nativeEvent: 'close',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('close', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onDurationChange」描述的渲染、交互或错误处理结果。 */
    it('onDurationChange', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onDurationChange',
        reactEventType: 'durationchange',
        nativeEvent: 'durationchange',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('durationchange', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onEmptied」描述的渲染、交互或错误处理结果。 */
    it('onEmptied', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onEmptied',
        reactEventType: 'emptied',
        nativeEvent: 'emptied',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('emptied', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onEncrypted」描述的渲染、交互或错误处理结果。 */
    it('onEncrypted', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onEncrypted',
        reactEventType: 'encrypted',
        nativeEvent: 'encrypted',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('encrypted', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onEnded」描述的渲染、交互或错误处理结果。 */
    it('onEnded', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onEnded',
        reactEventType: 'ended',
        nativeEvent: 'ended',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('ended', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onError」描述的渲染、交互或错误处理结果。 */
    it('onError', async () => {
      await testEmulatedBubblingEvent({
        type: 'img',
        reactEvent: 'onError',
        reactEventType: 'error',
        nativeEvent: 'error',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('error', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onInvalid」描述的渲染、交互或错误处理结果。 */
    it('onInvalid', async () => {
      await testEmulatedBubblingEvent({
        type: 'input',
        reactEvent: 'onInvalid',
        reactEventType: 'invalid',
        nativeEvent: 'invalid',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('invalid', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onLoad」描述的渲染、交互或错误处理结果。 */
    it('onLoad', async () => {
      await testEmulatedBubblingEvent({
        type: 'img',
        reactEvent: 'onLoad',
        reactEventType: 'load',
        nativeEvent: 'load',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('load', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onLoadedData」描述的渲染、交互或错误处理结果。 */
    it('onLoadedData', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onLoadedData',
        reactEventType: 'loadeddata',
        nativeEvent: 'loadeddata',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('loadeddata', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onLoadedMetadata」描述的渲染、交互或错误处理结果。 */
    it('onLoadedMetadata', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onLoadedMetadata',
        reactEventType: 'loadedmetadata',
        nativeEvent: 'loadedmetadata',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('loadedmetadata', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onLoadStart」描述的渲染、交互或错误处理结果。 */
    it('onLoadStart', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onLoadStart',
        reactEventType: 'loadstart',
        nativeEvent: 'loadstart',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('loadstart', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onPause」描述的渲染、交互或错误处理结果。 */
    it('onPause', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onPause',
        reactEventType: 'pause',
        nativeEvent: 'pause',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('pause', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onPlay」描述的渲染、交互或错误处理结果。 */
    it('onPlay', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onPlay',
        reactEventType: 'play',
        nativeEvent: 'play',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('play', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onPlaying」描述的渲染、交互或错误处理结果。 */
    it('onPlaying', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onPlaying',
        reactEventType: 'playing',
        nativeEvent: 'playing',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('playing', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onProgress」描述的渲染、交互或错误处理结果。 */
    it('onProgress', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onProgress',
        reactEventType: 'progress',
        nativeEvent: 'progress',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('progress', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onRateChange」描述的渲染、交互或错误处理结果。 */
    it('onRateChange', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onRateChange',
        reactEventType: 'ratechange',
        nativeEvent: 'ratechange',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('ratechange', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onResize」描述的渲染、交互或错误处理结果。 */
    it('onResize', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onResize',
        reactEventType: 'resize',
        nativeEvent: 'resize',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('resize', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onSeeked」描述的渲染、交互或错误处理结果。 */
    it('onSeeked', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onSeeked',
        reactEventType: 'seeked',
        nativeEvent: 'seeked',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('seeked', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onSeeking」描述的渲染、交互或错误处理结果。 */
    it('onSeeking', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onSeeking',
        reactEventType: 'seeking',
        nativeEvent: 'seeking',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('seeking', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onStalled」描述的渲染、交互或错误处理结果。 */
    it('onStalled', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onStalled',
        reactEventType: 'stalled',
        nativeEvent: 'stalled',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('stalled', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onSuspend」描述的渲染、交互或错误处理结果。 */
    it('onSuspend', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onSuspend',
        reactEventType: 'suspend',
        nativeEvent: 'suspend',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('suspend', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onTimeUpdate」描述的渲染、交互或错误处理结果。 */
    it('onTimeUpdate', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onTimeUpdate',
        reactEventType: 'timeupdate',
        nativeEvent: 'timeupdate',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('timeupdate', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onToggle」描述的渲染、交互或错误处理结果。 */
    it('onToggle', async () => {
      await testEmulatedBubblingEvent({
        type: 'details',
        reactEvent: 'onToggle',
        reactEventType: 'toggle',
        nativeEvent: 'toggle',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('toggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onBeforeToggle Popover API」描述的渲染、交互或错误处理结果。 */
    it('onBeforeToggle Popover API', async () => {
      await testEmulatedBubblingEvent({
        type: 'div',
        targetProps: {popover: 'any'},
        reactEvent: 'onBeforeToggle',
        reactEventType: 'beforetoggle',
        nativeEvent: 'beforetoggle',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('beforetoggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onToggle Popover API」描述的渲染、交互或错误处理结果。 */
    it('onToggle Popover API', async () => {
      await testEmulatedBubblingEvent({
        type: 'div',
        targetProps: {popover: 'any'},
        reactEvent: 'onToggle',
        reactEventType: 'toggle',
        nativeEvent: 'toggle',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('toggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onBeforeToggle Dialog API」描述的渲染、交互或错误处理结果。 */
    it('onBeforeToggle Dialog API', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onBeforeToggle',
        reactEventType: 'beforetoggle',
        nativeEvent: 'beforetoggle',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('beforetoggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onToggle Dialog API」描述的渲染、交互或错误处理结果。 */
    it('onToggle Dialog API', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onToggle',
        reactEventType: 'toggle',
        nativeEvent: 'toggle',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('toggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onVolumeChange」描述的渲染、交互或错误处理结果。 */
    it('onVolumeChange', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onVolumeChange',
        reactEventType: 'volumechange',
        nativeEvent: 'volumechange',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('volumechange', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onWaiting」描述的渲染、交互或错误处理结果。 */
    it('onWaiting', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onWaiting',
        reactEventType: 'waiting',
        nativeEvent: 'waiting',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('waiting', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });
  });

  describe('non-bubbling events that do not bubble in React', () => {
    /** 测试场景：验证「onScroll」描述的渲染、交互或错误处理结果。 */
    it('onScroll', async () => {
      await testNonBubblingEvent({
        type: 'div',
        reactEvent: 'onScroll',
        reactEventType: 'scroll',
        nativeEvent: 'scroll',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('scroll', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 测试场景：验证「onScrollEnd」描述的渲染、交互或错误处理结果。 */
    it('onScrollEnd', async () => {
      await testNonBubblingEvent({
        type: 'div',
        reactEvent: 'onScrollEnd',
        reactEventType: 'scrollend',
        nativeEvent: 'scrollend',
        /** `dispatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
        dispatch(node) {
          const e = new Event('scrollend', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });
  });

  // 这些事件完全由 React 合成，跨不同 root 的表现不够可靠，所以当前测试范围很有限；
  // 这里先用测试记录现有行为。
  describe('enter/leave events', () => {
    /** 测试场景：验证「onMouseEnter and onMouseLeave」描述的渲染、交互或错误处理结果。 */
    it('onMouseEnter and onMouseLeave', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="div"
          targetRef={targetRef}
          targetProps={{
            /** `onMouseEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseEnter: e => {
              log.push('---- inner enter');
            },
            /** `onMouseLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseLeave: e => {
              log.push('---- inner leave');
            },
          }}
          parentProps={{
            /** `onMouseEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseEnter: e => {
              log.push('--- inner parent enter');
            },
            /** `onMouseLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseLeave: e => {
              log.push('--- inner parent leave');
            },
          }}
          outerProps={{
            /** `onMouseEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseEnter: e => {
              log.push('-- outer enter');
            },
            /** `onMouseLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseLeave: e => {
              log.push('-- outer leave');
            },
          }}
          outerParentProps={{
            /** `onMouseEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseEnter: e => {
              log.push('- outer parent enter');
            },
            /** `onMouseLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onMouseLeave: e => {
              log.push('- outer parent leave');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      targetRef.current.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: null,
        }),
      );
      // 这种顺序不理想，因为每个 root 都会单独遍历。
      expect(log).toEqual(unindent`
        --- inner parent enter
        ---- inner enter
        - outer parent enter
        -- outer enter
      `);
      log.length = 0;
      targetRef.current.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
      expect(log).toEqual(unindent`
        ---- inner leave
        --- inner parent leave
        -- outer leave
        - outer parent leave
      `);
    });

    /** 测试场景：验证「onPointerEnter and onPointerLeave」描述的渲染、交互或错误处理结果。 */
    it('onPointerEnter and onPointerLeave', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="div"
          targetRef={targetRef}
          targetProps={{
            /** `onPointerEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerEnter: e => {
              log.push('---- inner enter');
            },
            /** `onPointerLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerLeave: e => {
              log.push('---- inner leave');
            },
          }}
          parentProps={{
            /** `onPointerEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerEnter: e => {
              log.push('--- inner parent enter');
            },
            /** `onPointerLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerLeave: e => {
              log.push('--- inner parent leave');
            },
          }}
          outerProps={{
            /** `onPointerEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerEnter: e => {
              log.push('-- outer enter');
            },
            /** `onPointerLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerLeave: e => {
              log.push('-- outer leave');
            },
          }}
          outerParentProps={{
            /** `onPointerEnter`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerEnter: e => {
              log.push('- outer parent enter');
            },
            /** `onPointerLeave`：封装当前用例复用的操作、回调或断言步骤。 */
            onPointerLeave: e => {
              log.push('- outer parent leave');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      targetRef.current.dispatchEvent(
        new Event('pointerover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: null,
        }),
      );
      // 这种顺序不理想，因为每个 root 都会单独遍历。
      expect(log).toEqual(unindent`
        --- inner parent enter
        ---- inner enter
        - outer parent enter
        -- outer enter
      `);
      log.length = 0;
      targetRef.current.dispatchEvent(
        new Event('pointerout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
      expect(log).toEqual(unindent`
        ---- inner leave
        --- inner parent leave
        -- outer leave
        - outer parent leave
      `);
    });
  });

  const setUntrackedValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;

  // 这些事件完全由 React 合成，跨不同 root 的表现不够可靠，所以当前测试范围很有限；
  // 这里先用测试记录现有行为。
  describe('polyfilled events', () => {
    /** 测试场景：验证「onBeforeInput」描述的渲染、交互或错误处理结果。 */
    it('onBeforeInput', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{
            /** `onBeforeInput`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInput: e => {
              log.push('---- inner');
            },
            /** `onBeforeInputCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInputCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{
            /** `onBeforeInput`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInput: e => {
              log.push('--- inner parent');
            },
            /** `onBeforeInputCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInputCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{
            /** `onBeforeInput`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInput: e => {
              log.push('-- outer');
            },
            /** `onBeforeInputCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInputCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{
            /** `onBeforeInput`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInput: e => {
              log.push('- outer parent');
            },
            /** `onBeforeInputCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onBeforeInputCapture: e => {
              expect(e.type).toBe('beforeinput');
              log.push('- outer parent capture');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      const e = new Event('textInput', {
        bubbles: true,
      });
      e.data = 'abcd';
      targetRef.current.dispatchEvent(e);
      // 这是 polyfill 事件，捕获与冒泡阶段均由模拟实现，因此不同 root 之间的阶段无法对齐。
      expect(log).toEqual(unindent`
        --- inner parent capture
        ---- inner capture
        ---- inner
        --- inner parent
        - outer parent capture
        -- outer capture
        -- outer
        - outer parent
      `);
    });

    /** 测试场景：验证「onChange」描述的渲染、交互或错误处理结果。 */
    it('onChange', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{
            /** `onChange`：封装当前用例复用的操作、回调或断言步骤。 */
            onChange: e => {
              log.push('---- inner');
            },
            /** `onChangeCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onChangeCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{
            /** `onChange`：封装当前用例复用的操作、回调或断言步骤。 */
            onChange: e => {
              log.push('--- inner parent');
            },
            /** `onChangeCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onChangeCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{
            /** `onChange`：封装当前用例复用的操作、回调或断言步骤。 */
            onChange: e => {
              log.push('-- outer');
            },
            /** `onChangeCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onChangeCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{
            /** `onChange`：封装当前用例复用的操作、回调或断言步骤。 */
            onChange: e => {
              log.push('- outer parent');
            },
            /** `onChangeCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onChangeCapture: e => {
              expect(e.type).toBe('change');
              log.push('- outer parent capture');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      setUntrackedValue.call(targetRef.current, 'hello');
      targetRef.current.dispatchEvent(
        new Event('input', {
          bubbles: true,
        }),
      );
      // 外层 React 完全收不到事件，因为它不负责处理这个 input。
      expect(log).toEqual(unindent`
        --- inner parent capture
        ---- inner capture
        ---- inner
        --- inner parent
      `);
    });

    /** 测试场景：验证「onCompositionStart」描述的渲染、交互或错误处理结果。 */
    it('onCompositionStart', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{
            /** `onCompositionStart`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStart: e => {
              log.push('---- inner');
            },
            /** `onCompositionStartCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStartCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{
            /** `onCompositionStart`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStart: e => {
              log.push('--- inner parent');
            },
            /** `onCompositionStartCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStartCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{
            /** `onCompositionStart`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStart: e => {
              log.push('-- outer');
            },
            /** `onCompositionStartCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStartCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{
            /** `onCompositionStart`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStart: e => {
              log.push('- outer parent');
            },
            /** `onCompositionStartCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionStartCapture: e => {
              expect(e.type).toBe('compositionstart');
              log.push('- outer parent capture');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      const e = new Event('compositionstart', {
        bubbles: true,
      });
      targetRef.current.dispatchEvent(e);
      // 这是 polyfill 事件，捕获与冒泡阶段均由模拟实现，因此不同 root 之间的阶段无法对齐。
      expect(log).toEqual(unindent`
        --- inner parent capture
        ---- inner capture
        ---- inner
        --- inner parent
        - outer parent capture
        -- outer capture
        -- outer
        - outer parent
      `);
    });

    /** 测试场景：验证「onCompositionEnd」描述的渲染、交互或错误处理结果。 */
    it('onCompositionEnd', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{
            /** `onCompositionEnd`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEnd: e => {
              log.push('---- inner');
            },
            /** `onCompositionEndCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEndCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{
            /** `onCompositionEnd`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEnd: e => {
              log.push('--- inner parent');
            },
            /** `onCompositionEndCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEndCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{
            /** `onCompositionEnd`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEnd: e => {
              log.push('-- outer');
            },
            /** `onCompositionEndCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEndCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{
            /** `onCompositionEnd`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEnd: e => {
              log.push('- outer parent');
            },
            /** `onCompositionEndCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionEndCapture: e => {
              expect(e.type).toBe('compositionend');
              log.push('- outer parent capture');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      const e = new Event('compositionend', {
        bubbles: true,
      });
      targetRef.current.dispatchEvent(e);
      // 这是 polyfill 事件，捕获与冒泡阶段均由模拟实现，因此不同 root 之间的阶段无法对齐。
      expect(log).toEqual(unindent`
        --- inner parent capture
        ---- inner capture
        ---- inner
        --- inner parent
        - outer parent capture
        -- outer capture
        -- outer
        - outer parent
      `);
    });

    /** 测试场景：验证「onCompositionUpdate」描述的渲染、交互或错误处理结果。 */
    it('onCompositionUpdate', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{
            /** `onCompositionUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdate: e => {
              log.push('---- inner');
            },
            /** `onCompositionUpdateCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdateCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{
            /** `onCompositionUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdate: e => {
              log.push('--- inner parent');
            },
            /** `onCompositionUpdateCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdateCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{
            /** `onCompositionUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdate: e => {
              log.push('-- outer');
            },
            /** `onCompositionUpdateCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdateCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{
            /** `onCompositionUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdate: e => {
              log.push('- outer parent');
            },
            /** `onCompositionUpdateCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onCompositionUpdateCapture: e => {
              expect(e.type).toBe('compositionupdate');
              log.push('- outer parent capture');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      const e = new Event('compositionupdate', {
        bubbles: true,
      });
      targetRef.current.dispatchEvent(e);
      // 这是 polyfill 事件，捕获与冒泡阶段均由模拟实现，因此不同 root 之间的阶段无法对齐。
      expect(log).toEqual(unindent`
        --- inner parent capture
        ---- inner capture
        ---- inner
        --- inner parent
        - outer parent capture
        -- outer capture
        -- outer
        - outer parent
      `);
    });

    /** 测试场景：验证「onSelect」描述的渲染、交互或错误处理结果。 */
    it('onSelect', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{
            /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelect: e => {
              log.push('---- inner');
            },
            /** `onSelectCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelectCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{
            /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelect: e => {
              log.push('--- inner parent');
            },
            /** `onSelectCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelectCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{
            /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelect: e => {
              log.push('-- outer');
            },
            /** `onSelectCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelectCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{
            /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelect: e => {
              log.push('- outer parent');
            },
            /** `onSelectCapture`：封装当前用例复用的操作、回调或断言步骤。 */
            onSelectCapture: e => {
              expect(e.type).toBe('select');
              log.push('- outer parent capture');
            },
          }}
        />,
      );
      expect(log.length).toBe(0);
      targetRef.current.focus();
      targetRef.current.dispatchEvent(
        new Event('keydown', {
          bubbles: true,
        }),
      );
      // 外层 React 完全收不到事件，因为它不负责处理这个 input。
      expect(log).toEqual(unindent`
        --- inner parent capture
        ---- inner capture
        ---- inner
        --- inner parent
      `);
    });
  });

  // 这些事件在 React 和浏览器中都会冒泡；React 将它们委托到 root。
  /** `testNativeBubblingEvent`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeBubblingEvent(config) {
    await testNativeBubblingEventWithTargetListener(config);
    await testNativeBubblingEventWithoutTargetListener(config);
    await testReactStopPropagationInOuterCapturePhase(config);
    await testReactStopPropagationInInnerCapturePhase(config);
    await testReactStopPropagationInInnerBubblePhase(config);
    await testReactStopPropagationInOuterBubblePhase(config);
    await testNativeStopPropagationInOuterCapturePhase(config);
    await testNativeStopPropagationInInnerCapturePhase(config);
    await testNativeStopPropagationInInnerBubblePhase(config);
    await testNativeStopPropagationInOuterBubblePhase(config);
  }

  // 这些事件在 React 中冒泡、但在浏览器中不冒泡；React 将监听器直接挂到元素上。
  /** `testEmulatedBubblingEvent`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testEmulatedBubblingEvent(config) {
    await testEmulatedBubblingEventWithTargetListener(config);
    await testEmulatedBubblingEventWithoutTargetListener(config);
    await testReactStopPropagationInOuterCapturePhase(config);
    await testReactStopPropagationInInnerCapturePhase(config);
    await testReactStopPropagationInInnerBubblePhase(config);
    await testNativeStopPropagationInOuterCapturePhase(config);
    await testNativeStopPropagationInInnerCapturePhase(config);
    await testNativeStopPropagationInInnerEmulatedBubblePhase(config);
  }

  // 这些事件在 React 和浏览器中都不冒泡。
  /** `testNonBubblingEvent`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNonBubblingEvent(config) {
    await testNonBubblingEventWithTargetListener(config);
    await testNonBubblingEventWithoutTargetListener(config);
    await testReactStopPropagationInOuterCapturePhase(config);
    await testReactStopPropagationInInnerCapturePhase(config);
    await testReactStopPropagationInInnerBubblePhase(config);
    await testNativeStopPropagationInOuterCapturePhase(config);
    await testNativeStopPropagationInInnerCapturePhase(config);
  }

  /** `testNativeBubblingEventWithTargetListener`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeBubblingEventWithTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 应记录所有监听器。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
      --- inner parent
      -- outer
      - outer parent
    `);
  }

  /** `testEmulatedBubblingEventWithTargetListener`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testEmulatedBubblingEventWithTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          ...eventConfig.targetProps,
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件原生不冒泡，但 React 会模拟冒泡。元素由内层 React 创建，因此冒泡止于内层父节点，永远不会到达外层 React。未来可能完全取消这类模拟冒泡；届时内层父节点也不会被记录。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
      --- inner parent
    `);
  }

  /** `testNonBubblingEventWithTargetListener`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNonBubblingEventWithTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件原生不冒泡，React 也不模拟冒泡，因此它只到达目标节点并在那里停止。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
    `);
  }

  /** `testNativeBubblingEventWithoutTargetListener`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeBubblingEventWithoutTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={
          {
            // 目标节点自身没有监听器。
          }
        }
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 应记录除最内层监听器之外的所有监听器。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      --- inner parent
      -- outer
      - outer parent
    `);
  }

  /** `testEmulatedBubblingEventWithoutTargetListener`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testEmulatedBubblingEventWithoutTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          ...eventConfig.targetProps,
          // 目标节点自身没有监听器。
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件原生不冒泡，但 React 会模拟冒泡。元素由内层 React 创建，因此冒泡止于内层父节点，永远不会到达外层 React。未来可能完全取消这类模拟冒泡；届时内层父节点也不会被记录。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      --- inner parent
    `);
  }

  /** `testNonBubblingEventWithoutTargetListener`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNonBubblingEventWithoutTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={
          {
            // 目标节点自身没有监听器。
          }
        }
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件在原生层不会冒泡，React 也不模拟冒泡；又因为目标节点没有监听器，只有捕获阶段会触发。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
    `);
  }

  /** `testReactStopPropagationInOuterCapturePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testReactStopPropagationInOuterCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(eventConfig.nativeEvent, e => {
              // 事件在更早阶段已被阻止，因此日志中完全不应出现这一项。
              log.push('---- inner (native)');
            });
          }
        }}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            e.stopPropagation(); // <---------
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 应在外层捕获阶段停止，完全不会到达内层 root。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
    `);
  }

  /** `testReactStopPropagationInInnerCapturePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testReactStopPropagationInInnerCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(eventConfig.nativeEvent, e => {
              // 事件在更早阶段已被阻止，因此日志中完全不应出现这一项。
              log.push('---- inner (native)');
            });
          }
        }}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            e.stopPropagation(); // <---------
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 事件会到达内层 root，但不会到达目标节点，也不会进入冒泡阶段。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
    `);
  }

  /** `testReactStopPropagationInInnerBubblePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testReactStopPropagationInInnerBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          ...eventConfig.targetProps,
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            e.stopPropagation(); // <---------
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerRef={node => {
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(eventConfig.nativeEvent, e => {
              // 事件在更早阶段已被阻止，因此日志中完全不应出现这一项。
              log.push('-- outer (native)');
            });
          }
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 应停止在目标处，不应继续前进。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
    `);
  }

  /** `testReactStopPropagationInOuterBubblePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testReactStopPropagationInOuterBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            e.stopPropagation(); // <---------
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 不应到达父节点上的外层冒泡处理器。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
      --- inner parent
      -- outer
    `);
  }

  /** `testNativeStopPropagationInOuterCapturePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeStopPropagationInOuterCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentRef={node => {
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(
              eventConfig.nativeEvent,
              e => {
                log.push('- outer parent capture (native)');
                e.stopPropagation(); // <---------
              },
              {capture: true},
            );
          }
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 外层 root 已收到事件，因此它的捕获阶段会执行；但外层原生捕获阶段的处理器会阻止内层 root 收到事件。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      - outer parent capture (native)
    `);
  }

  /** `testNativeStopPropagationInInnerCapturePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeStopPropagationInInnerCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentRef={node => {
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(
              eventConfig.nativeEvent,
              e => {
                log.push('--- inner parent capture (native)');
                e.stopPropagation(); // <---------
              },
              {capture: true},
            );
          }
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 内层 root 已收到事件，因此所有 React 捕获阶段监听器都应执行；随后原生处理器阻止传播，所以 React 冒泡阶段的处理器均不执行。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      --- inner parent capture (native)
    `);
  }

  /** `testNativeStopPropagationInInnerBubblePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeStopPropagationInInnerBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(eventConfig.nativeEvent, e => {
              log.push('---- inner (native)');
              e.stopPropagation(); // <---------
            });
          }
        }}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 捕获阶段完全不受影响。进入冒泡阶段后，最内层原生处理器先执行并阻止传播，因此不再发生其他处理。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner (native)
    `);
  }

  /** `testNativeStopPropagationInInnerEmulatedBubblePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeStopPropagationInInnerEmulatedBubblePhase(
    eventConfig,
  ) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(eventConfig.nativeEvent, e => {
              log.push('---- inner (native)');
              e.stopPropagation(); // <---------
            });
          }
        }}
        targetProps={{
          ...eventConfig.targetProps,
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件原生不冒泡，因此 React 将监听器直接挂到元素上。等自定义原生监听器执行时已经太晚，React 模拟的冒泡早已完成。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
      --- inner parent
      ---- inner (native)
    `);
  }

  /** `testNativeStopPropagationInOuterBubblePhase`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testNativeStopPropagationInOuterBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerRef={node => {
          if (node) {
            // 无需清理，假设我们只渲染一次。
            node.addEventListener(eventConfig.nativeEvent, e => {
              log.push('-- outer (native)');
              e.stopPropagation(); // <---------
            });
          }
        }}
        outerProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{
          /** `eventConfig.reactEvent`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },
          /** `eventConfig.reactEvent + 'Capture'`：封装当前用例复用的操作、回调或断言步骤。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 事件沿内层树向上冒泡，随后到达阻止传播的原生处理器，因此永远不会到达外层 React root，外层 React 事件处理器也不会触发。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
      --- inner parent
      -- outer (native)
    `);
  }

  /** `Fixture`：封装当前用例复用的操作、回调或断言步骤。 */
  function Fixture({
    type,
    targetRef,
    targetProps,
    parentRef,
    parentProps,
    outerRef,
    outerProps,
    outerParentRef,
    outerParentProps,
  }) {
    const inner = React.useMemo(
      () => (
        <Inner
          type={type}
          targetRef={targetRef}
          targetProps={targetProps}
          parentRef={parentRef}
          parentProps={parentProps}
        />
      ),
      [type, targetRef, targetProps, parentProps],
    );
    return (
      <Outer
        outerRef={outerRef}
        outerProps={outerProps}
        outerParentRef={outerParentRef}
        outerParentProps={outerParentProps}>
        <NestedReact>{inner}</NestedReact>
      </Outer>
    );
  }

  /** `NestedReact`：封装当前用例复用的操作、回调或断言步骤。 */
  function NestedReact({children}) {
    const ref = React.useRef();
    React.useLayoutEffect(() => {
      const parent = ref.current;
      const innerContainer = document.createElement('div');
      parent.appendChild(innerContainer);
      const innerReactRoot = InnerReactDOMClient.createRoot(innerContainer);
      InnerReactDOM.flushSync(() => {
        innerReactRoot.render(children);
      });
      return () => {
        innerReactRoot.unmount();
        parent.removeChild(innerContainer);
      };
    }, [children, ref]);
    return <div ref={ref} />;
  }

  /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
  function Inner({type, targetRef, targetProps, parentRef, parentProps}) {
    const T = type;
    return (
      <div {...parentProps} ref={parentRef}>
        <T {...targetProps} ref={targetRef} />
      </div>
    );
  }

  /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
  function Outer({
    outerRef,
    outerProps,
    outerParentProps,
    outerParentRef,
    children,
  }) {
    return (
      <div {...outerParentProps} ref={outerParentRef}>
        <div {...outerProps} ref={outerRef}>
          {children}
        </div>
      </div>
    );
  }

  /** `unindent`：封装当前用例复用的操作、回调或断言步骤。 */
  function unindent(str) {
    return str[0]
      .split('\n')
      .map(s => s.trim())
      .filter(s => s !== '');
  }
});
