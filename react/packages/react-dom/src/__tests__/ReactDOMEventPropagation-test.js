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
    /** 安装空TextEvent构造器替身，使BeforeInput插件探测走textInput能力分支；不创建真实文本输入事件。 */
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

  /** 有当前容器时，在act内卸载外根并移除body容器、清空container；外根的NestedReact layout清理会卸载内根，保证下一分支重新创建监听目标。 */
  async function cleanup() {
    if (container) {
      await act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
      container = null;
    }
  }

  /** 先await cleanup，再创建附到body的新div和外根，act内提交tree；把每个传播场景隔离到新的内外两根。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 animationend（可取消）触发 onAnimationEnd/animationend。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onAnimationEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAnimationEnd',
        reactEventType: 'animationend',
        nativeEvent: 'animationend',

        /** 接收目标 DOM node，创建 Event(animationend) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 animationiteration（可取消）触发 onAnimationIteration/animationiteration。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onAnimationIteration', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAnimationIteration',
        reactEventType: 'animationiteration',
        nativeEvent: 'animationiteration',

        /** 接收目标 DOM node，创建 Event(animationiteration) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 animationstart（可取消）触发 onAnimationStart/animationstart。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onAnimationStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAnimationStart',
        reactEventType: 'animationstart',
        nativeEvent: 'animationstart',

        /** 接收目标 DOM node，创建 Event(animationstart) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 auxclick（可取消）触发 onAuxClick/auxclick。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onAuxClick', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onAuxClick',
        reactEventType: 'auxclick',
        nativeEvent: 'auxclick',

        /** 接收目标 DOM node，创建 KeyboardEvent(auxclick) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 input；手动分发 focusout（可取消）触发 onBlur/blur。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onBlur', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onBlur',
        reactEventType: 'blur',
        nativeEvent: 'focusout',

        /** 接收目标 DOM node，创建 Event(focusout) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；调用 node.click()（不可取消）触发 onClick/click。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onClick', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onClick',
        reactEventType: 'click',
        nativeEvent: 'click',

        /** 接收目标 DOM node 并调用 click()，作为 onClick 原生分发入口；后续路径与停止传播由共享 helper 断言。 */
        dispatch(node) {
          node.click();
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 contextmenu（可取消）触发 onContextMenu/contextmenu。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onContextMenu', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onContextMenu',
        reactEventType: 'contextmenu',
        nativeEvent: 'contextmenu',

        /** 接收目标 DOM node，创建 MouseEvent(contextmenu) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 copy（可取消）触发 onCopy/copy。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onCopy', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onCopy',
        reactEventType: 'copy',
        nativeEvent: 'copy',

        /** 接收目标 DOM node，创建 Event(copy) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 cut（可取消）触发 onCut/cut。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onCut', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onCut',
        reactEventType: 'cut',
        nativeEvent: 'cut',

        /** 接收目标 DOM node，创建 Event(cut) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dblclick（可取消）触发 onDoubleClick/dblclick。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDoubleClick', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDoubleClick',
        reactEventType: 'dblclick',
        nativeEvent: 'dblclick',

        /** 接收目标 DOM node，创建 KeyboardEvent(dblclick) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 drag（可取消）触发 onDrag/drag。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDrag', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDrag',
        reactEventType: 'drag',
        nativeEvent: 'drag',

        /** 接收目标 DOM node，创建 MouseEvent(drag) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dragend（可取消）触发 onDragEnd/dragend。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDragEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragEnd',
        reactEventType: 'dragend',
        nativeEvent: 'dragend',

        /** 接收目标 DOM node，创建 MouseEvent(dragend) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dragenter（可取消）触发 onDragEnter/dragenter。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDragEnter', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragEnter',
        reactEventType: 'dragenter',
        nativeEvent: 'dragenter',

        /** 接收目标 DOM node，创建 MouseEvent(dragenter) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dragexit（可取消）触发 onDragExit/dragexit。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDragExit', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragExit',
        reactEventType: 'dragexit',
        nativeEvent: 'dragexit',

        /** 接收目标 DOM node，创建 MouseEvent(dragexit) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dragleave（可取消）触发 onDragLeave/dragleave。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDragLeave', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragLeave',
        reactEventType: 'dragleave',
        nativeEvent: 'dragleave',

        /** 接收目标 DOM node，创建 MouseEvent(dragleave) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dragover（可取消）触发 onDragOver/dragover。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDragOver', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragOver',
        reactEventType: 'dragover',
        nativeEvent: 'dragover',

        /** 接收目标 DOM node，创建 MouseEvent(dragover) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 dragstart（可取消）触发 onDragStart/dragstart。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDragStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDragStart',
        reactEventType: 'dragstart',
        nativeEvent: 'dragstart',

        /** 接收目标 DOM node，创建 MouseEvent(dragstart) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 drop（可取消）触发 onDrop/drop。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDrop', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onDrop',
        reactEventType: 'drop',
        nativeEvent: 'drop',

        /** 接收目标 DOM node，创建 MouseEvent(drop) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 input；手动分发 focusin（可取消）触发 onFocus/focus。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onFocus', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onFocus',
        reactEventType: 'focus',
        nativeEvent: 'focusin',

        /** 接收目标 DOM node，创建 Event(focusin) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('focusin', {
            bubbles: true,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 gotpointercapture（可取消）触发 onGotPointerCapture/gotpointercapture。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onGotPointerCapture', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onGotPointerCapture',
        reactEventType: 'gotpointercapture',
        nativeEvent: 'gotpointercapture',

        /** 接收目标 DOM node，创建 Event(gotpointercapture) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 input；手动分发 keydown（可取消）触发 onKeyDown/keydown。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onKeyDown', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onKeyDown',
        reactEventType: 'keydown',
        nativeEvent: 'keydown',

        /** 接收目标 DOM node，创建 KeyboardEvent(keydown) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 input；手动分发 keypress（可取消，keypress 的 keyCode=13）触发 onKeyPress/keypress。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onKeyPress', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onKeyPress',
        reactEventType: 'keypress',
        nativeEvent: 'keypress',

        /** 接收目标 DOM node，创建 KeyboardEvent(keypress) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 keyCode=13 让 KeyPress 提取走可打印/回车分支。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 input；手动分发 keyup（可取消）触发 onKeyUp/keyup。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onKeyUp', async () => {
      await testNativeBubblingEvent({
        type: 'input',
        reactEvent: 'onKeyUp',
        reactEventType: 'keyup',
        nativeEvent: 'keyup',

        /** 接收目标 DOM node，创建 KeyboardEvent(keyup) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 lostpointercapture（可取消）触发 onLostPointerCapture/lostpointercapture。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onLostPointerCapture', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onLostPointerCapture',
        reactEventType: 'lostpointercapture',
        nativeEvent: 'lostpointercapture',

        /** 接收目标 DOM node，创建 Event(lostpointercapture) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 mousedown（可取消）触发 onMouseDown/mousedown。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onMouseDown', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseDown',
        reactEventType: 'mousedown',
        nativeEvent: 'mousedown',

        /** 接收目标 DOM node，创建 MouseEvent(mousedown) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 mouseout（可取消）触发 onMouseOut/mouseout。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onMouseOut', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseOut',
        reactEventType: 'mouseout',
        nativeEvent: 'mouseout',

        /** 接收目标 DOM node，创建 MouseEvent(mouseout) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 mouseover（可取消）触发 onMouseOver/mouseover。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onMouseOver', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseOver',
        reactEventType: 'mouseover',
        nativeEvent: 'mouseover',

        /** 接收目标 DOM node，创建 MouseEvent(mouseover) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 mouseup（可取消）触发 onMouseUp/mouseup。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onMouseUp', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onMouseUp',
        reactEventType: 'mouseup',
        nativeEvent: 'mouseup',

        /** 接收目标 DOM node，创建 MouseEvent(mouseup) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 paste（可取消）触发 onPaste/paste。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPaste', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPaste',
        reactEventType: 'paste',
        nativeEvent: 'paste',

        /** 接收目标 DOM node，创建 Event(paste) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 pointercancel（可取消）触发 onPointerCancel/pointercancel。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPointerCancel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerCancel',
        reactEventType: 'pointercancel',
        nativeEvent: 'pointercancel',

        /** 接收目标 DOM node，创建 Event(pointercancel) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 pointerdown（可取消）触发 onPointerDown/pointerdown。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPointerDown', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerDown',
        reactEventType: 'pointerdown',
        nativeEvent: 'pointerdown',

        /** 接收目标 DOM node，创建 Event(pointerdown) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 pointermove（可取消）触发 onPointerMove/pointermove。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPointerMove', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerMove',
        reactEventType: 'pointermove',
        nativeEvent: 'pointermove',

        /** 接收目标 DOM node，创建 Event(pointermove) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 pointerout（可取消）触发 onPointerOut/pointerout。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPointerOut', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerOut',
        reactEventType: 'pointerout',
        nativeEvent: 'pointerout',

        /** 接收目标 DOM node，创建 Event(pointerout) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 pointerover（可取消）触发 onPointerOver/pointerover。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPointerOver', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerOver',
        reactEventType: 'pointerover',
        nativeEvent: 'pointerover',

        /** 接收目标 DOM node，创建 Event(pointerover) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 pointerup（可取消）触发 onPointerUp/pointerup。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPointerUp', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onPointerUp',
        reactEventType: 'pointerup',
        nativeEvent: 'pointerup',

        /** 接收目标 DOM node，创建 Event(pointerup) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 form；手动分发 reset（可取消）触发 onReset/reset。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onReset', async () => {
      await testNativeBubblingEvent({
        type: 'form',
        reactEvent: 'onReset',
        reactEventType: 'reset',
        nativeEvent: 'reset',

        /** 接收目标 DOM node，创建 Event(reset) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('reset', {
            bubbles: true,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 form；手动分发 submit（可取消，submitter=null）触发 onSubmit/submit。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onSubmit', async () => {
      await testNativeBubblingEvent({
        type: 'form',
        reactEvent: 'onSubmit',
        reactEventType: 'submit',
        nativeEvent: 'submit',

        /** 接收目标 DOM node，创建 SubmitEvent(submit) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 submitter=null，不触发具体提交按钮 action。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 touchcancel（可取消）触发 onTouchCancel/touchcancel。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTouchCancel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchCancel',
        reactEventType: 'touchcancel',
        nativeEvent: 'touchcancel',

        /** 接收目标 DOM node，创建 Event(touchcancel) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 touchend（可取消）触发 onTouchEnd/touchend。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTouchEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchEnd',
        reactEventType: 'touchend',
        nativeEvent: 'touchend',

        /** 接收目标 DOM node，创建 Event(touchend) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 touchmove（可取消）触发 onTouchMove/touchmove。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTouchMove', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchMove',
        reactEventType: 'touchmove',
        nativeEvent: 'touchmove',

        /** 接收目标 DOM node，创建 Event(touchmove) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 touchstart（可取消）触发 onTouchStart/touchstart。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTouchStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTouchStart',
        reactEventType: 'touchstart',
        nativeEvent: 'touchstart',

        /** 接收目标 DOM node，创建 Event(touchstart) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 transitionrun（不可取消）触发 onTransitionRun/transitionrun。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTransitionRun', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionRun',
        reactEventType: 'transitionrun',
        nativeEvent: 'transitionrun',

        /** 接收目标 DOM node，创建 Event(transitionrun) 并 dispatchEvent；bubbles=true、cancelable=false，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 transitionstart（不可取消）触发 onTransitionStart/transitionstart。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTransitionStart', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionStart',
        reactEventType: 'transitionstart',
        nativeEvent: 'transitionstart',

        /** 接收目标 DOM node，创建 Event(transitionstart) 并 dispatchEvent；bubbles=true、cancelable=false，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 transitioncancel（不可取消）触发 onTransitionCancel/transitioncancel。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTransitionCancel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionCancel',
        reactEventType: 'transitioncancel',
        nativeEvent: 'transitioncancel',

        /** 接收目标 DOM node，创建 Event(transitioncancel) 并 dispatchEvent；bubbles=true、cancelable=false，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 transitionend（不可取消）触发 onTransitionEnd/transitionend。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTransitionEnd', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onTransitionEnd',
        reactEventType: 'transitionend',
        nativeEvent: 'transitionend',

        /** 接收目标 DOM node，创建 Event(transitionend) 并 dispatchEvent；bubbles=true、cancelable=false，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 wheel（可取消）触发 onWheel/wheel。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onWheel', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onWheel',
        reactEventType: 'wheel',
        nativeEvent: 'wheel',

        /** 接收目标 DOM node，创建 Event(wheel) 并 dispatchEvent；bubbles=true、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 fullscreenchange（不可取消）触发 onFullscreenChange/fullscreenchange。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onFullscreenChange', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onFullscreenChange',
        reactEventType: 'fullscreenchange',
        nativeEvent: 'fullscreenchange',

        /** 接收目标 DOM node，创建 Event(fullscreenchange) 并 dispatchEvent；bubbles=true、cancelable=false，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 fullscreenerror（不可取消）触发 onFullscreenError/fullscreenerror。断言基线捕获外父→外→内父→目标、冒泡反向到外父；无目标回调时省去目标两项，并逐分支检查合成/原生停止传播的位置，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onFullscreenError', async () => {
      await testNativeBubblingEvent({
        type: 'div',
        reactEvent: 'onFullscreenError',
        reactEventType: 'fullscreenerror',
        nativeEvent: 'fullscreenerror',

        /** 接收目标 DOM node，创建 Event(fullscreenerror) 并 dispatchEvent；bubbles=true、cancelable=false，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 abort（可取消）触发 onAbort/abort。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onAbort', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onAbort',
        reactEventType: 'abort',
        nativeEvent: 'abort',

        /** 接收目标 DOM node，创建 Event(abort) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('abort', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 dialog；手动分发 cancel（可取消）触发 onCancel/cancel。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onCancel', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onCancel',
        reactEventType: 'cancel',
        nativeEvent: 'cancel',

        /** 接收目标 DOM node，创建 Event(cancel) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('cancel', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 canplay（可取消）触发 onCanPlay/canplay。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onCanPlay', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onCanPlay',
        reactEventType: 'canplay',
        nativeEvent: 'canplay',

        /** 接收目标 DOM node，创建 Event(canplay) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('canplay', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 canplaythrough（可取消）触发 onCanPlayThrough/canplaythrough。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onCanPlayThrough', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onCanPlayThrough',
        reactEventType: 'canplaythrough',
        nativeEvent: 'canplaythrough',

        /** 接收目标 DOM node，创建 Event(canplaythrough) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('canplaythrough', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 dialog；手动分发 close（可取消）触发 onClose/close。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onClose', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onClose',
        reactEventType: 'close',
        nativeEvent: 'close',

        /** 接收目标 DOM node，创建 Event(close) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('close', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 durationchange（可取消）触发 onDurationChange/durationchange。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onDurationChange', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onDurationChange',
        reactEventType: 'durationchange',
        nativeEvent: 'durationchange',

        /** 接收目标 DOM node，创建 Event(durationchange) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('durationchange', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 emptied（可取消）触发 onEmptied/emptied。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onEmptied', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onEmptied',
        reactEventType: 'emptied',
        nativeEvent: 'emptied',

        /** 接收目标 DOM node，创建 Event(emptied) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('emptied', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 encrypted（可取消）触发 onEncrypted/encrypted。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onEncrypted', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onEncrypted',
        reactEventType: 'encrypted',
        nativeEvent: 'encrypted',

        /** 接收目标 DOM node，创建 Event(encrypted) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('encrypted', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 ended（可取消）触发 onEnded/ended。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onEnded', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onEnded',
        reactEventType: 'ended',
        nativeEvent: 'ended',

        /** 接收目标 DOM node，创建 Event(ended) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('ended', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 img；手动分发 error（可取消）触发 onError/error。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onError', async () => {
      await testEmulatedBubblingEvent({
        type: 'img',
        reactEvent: 'onError',
        reactEventType: 'error',
        nativeEvent: 'error',

        /** 接收目标 DOM node，创建 Event(error) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('error', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 input；手动分发 invalid（可取消）触发 onInvalid/invalid。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onInvalid', async () => {
      await testEmulatedBubblingEvent({
        type: 'input',
        reactEvent: 'onInvalid',
        reactEventType: 'invalid',
        nativeEvent: 'invalid',

        /** 接收目标 DOM node，创建 Event(invalid) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('invalid', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 img；手动分发 load（可取消）触发 onLoad/load。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onLoad', async () => {
      await testEmulatedBubblingEvent({
        type: 'img',
        reactEvent: 'onLoad',
        reactEventType: 'load',
        nativeEvent: 'load',

        /** 接收目标 DOM node，创建 Event(load) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('load', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 loadeddata（可取消）触发 onLoadedData/loadeddata。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onLoadedData', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onLoadedData',
        reactEventType: 'loadeddata',
        nativeEvent: 'loadeddata',

        /** 接收目标 DOM node，创建 Event(loadeddata) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('loadeddata', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 loadedmetadata（可取消）触发 onLoadedMetadata/loadedmetadata。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onLoadedMetadata', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onLoadedMetadata',
        reactEventType: 'loadedmetadata',
        nativeEvent: 'loadedmetadata',

        /** 接收目标 DOM node，创建 Event(loadedmetadata) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('loadedmetadata', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 loadstart（可取消）触发 onLoadStart/loadstart。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onLoadStart', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onLoadStart',
        reactEventType: 'loadstart',
        nativeEvent: 'loadstart',

        /** 接收目标 DOM node，创建 Event(loadstart) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('loadstart', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 pause（可取消）触发 onPause/pause。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPause', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onPause',
        reactEventType: 'pause',
        nativeEvent: 'pause',

        /** 接收目标 DOM node，创建 Event(pause) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('pause', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 play（可取消）触发 onPlay/play。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPlay', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onPlay',
        reactEventType: 'play',
        nativeEvent: 'play',

        /** 接收目标 DOM node，创建 Event(play) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('play', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 playing（可取消）触发 onPlaying/playing。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onPlaying', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onPlaying',
        reactEventType: 'playing',
        nativeEvent: 'playing',

        /** 接收目标 DOM node，创建 Event(playing) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('playing', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 progress（可取消）触发 onProgress/progress。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onProgress', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onProgress',
        reactEventType: 'progress',
        nativeEvent: 'progress',

        /** 接收目标 DOM node，创建 Event(progress) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('progress', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 ratechange（可取消）触发 onRateChange/ratechange。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onRateChange', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onRateChange',
        reactEventType: 'ratechange',
        nativeEvent: 'ratechange',

        /** 接收目标 DOM node，创建 Event(ratechange) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('ratechange', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 resize（可取消）触发 onResize/resize。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onResize', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onResize',
        reactEventType: 'resize',
        nativeEvent: 'resize',

        /** 接收目标 DOM node，创建 Event(resize) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('resize', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 seeked（可取消）触发 onSeeked/seeked。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onSeeked', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onSeeked',
        reactEventType: 'seeked',
        nativeEvent: 'seeked',

        /** 接收目标 DOM node，创建 Event(seeked) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('seeked', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 seeking（可取消）触发 onSeeking/seeking。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onSeeking', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onSeeking',
        reactEventType: 'seeking',
        nativeEvent: 'seeking',

        /** 接收目标 DOM node，创建 Event(seeking) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('seeking', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 stalled（可取消）触发 onStalled/stalled。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onStalled', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onStalled',
        reactEventType: 'stalled',
        nativeEvent: 'stalled',

        /** 接收目标 DOM node，创建 Event(stalled) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('stalled', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 suspend（可取消）触发 onSuspend/suspend。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onSuspend', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onSuspend',
        reactEventType: 'suspend',
        nativeEvent: 'suspend',

        /** 接收目标 DOM node，创建 Event(suspend) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('suspend', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 timeupdate（可取消）触发 onTimeUpdate/timeupdate。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onTimeUpdate', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onTimeUpdate',
        reactEventType: 'timeupdate',
        nativeEvent: 'timeupdate',

        /** 接收目标 DOM node，创建 Event(timeupdate) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('timeupdate', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 details；手动分发 toggle（可取消）触发 onToggle/toggle。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onToggle', async () => {
      await testEmulatedBubblingEvent({
        type: 'details',
        reactEvent: 'onToggle',
        reactEventType: 'toggle',
        nativeEvent: 'toggle',

        /** 接收目标 DOM node，创建 Event(toggle) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('toggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 beforetoggle（可取消，目标具有 popover=any）触发 onBeforeToggle/beforetoggle。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onBeforeToggle Popover API', async () => {
      await testEmulatedBubblingEvent({
        type: 'div',
        targetProps: {popover: 'any'},
        reactEvent: 'onBeforeToggle',
        reactEventType: 'beforetoggle',
        nativeEvent: 'beforetoggle',

        /** 接收目标 DOM node，创建 Event(beforetoggle) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('beforetoggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 toggle（可取消，目标具有 popover=any）触发 onToggle/toggle。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onToggle Popover API', async () => {
      await testEmulatedBubblingEvent({
        type: 'div',
        targetProps: {popover: 'any'},
        reactEvent: 'onToggle',
        reactEventType: 'toggle',
        nativeEvent: 'toggle',

        /** 接收目标 DOM node，创建 Event(toggle) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('toggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 dialog；手动分发 beforetoggle（可取消）触发 onBeforeToggle/beforetoggle。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onBeforeToggle Dialog API', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onBeforeToggle',
        reactEventType: 'beforetoggle',
        nativeEvent: 'beforetoggle',

        /** 接收目标 DOM node，创建 Event(beforetoggle) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('beforetoggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 dialog；手动分发 toggle（可取消）触发 onToggle/toggle。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onToggle Dialog API', async () => {
      await testEmulatedBubblingEvent({
        type: 'dialog',
        reactEvent: 'onToggle',
        reactEventType: 'toggle',
        nativeEvent: 'toggle',

        /** 接收目标 DOM node，创建 Event(toggle) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('toggle', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 volumechange（可取消）触发 onVolumeChange/volumechange。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onVolumeChange', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onVolumeChange',
        reactEventType: 'volumechange',
        nativeEvent: 'volumechange',

        /** 接收目标 DOM node，创建 Event(volumechange) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('volumechange', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 video；手动分发 waiting（可取消）触发 onWaiting/waiting。断言捕获遍历外内两根，合成冒泡只在内根目标→内父；无目标回调时仅内父冒泡，并检查捕获及目标停止传播次序，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onWaiting', async () => {
      await testEmulatedBubblingEvent({
        type: 'video',
        reactEvent: 'onWaiting',
        reactEventType: 'waiting',
        nativeEvent: 'waiting',

        /** 接收目标 DOM node，创建 Event(waiting) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
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

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 scroll（可取消）触发 onScroll/scroll。断言捕获遍历两根，冒泡只目标；目标没有回调时仅捕获，并检查捕获/目标阶段停止传播，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onScroll', async () => {
      await testNonBubblingEvent({
        type: 'div',
        reactEvent: 'onScroll',
        reactEventType: 'scroll',
        nativeEvent: 'scroll',

        /** 接收目标 DOM node，创建 Event(scroll) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
        dispatch(node) {
          const e = new Event('scroll', {
            bubbles: false,
            cancelable: true,
          });
          node.dispatchEvent(e);
        },
      });
    });

    /** 两份 renderer 的 Fixture 创建嵌套外/内根，目标为 div；手动分发 scrollend（可取消）触发 onScrollEnd/scrollend。断言捕获遍历两根，冒泡只目标；目标没有回调时仅捕获，并检查捕获/目标阶段停止传播，验证该具体事件的根监听/目标监听与合成路径。 */
    it('onScrollEnd', async () => {
      await testNonBubblingEvent({
        type: 'div',
        reactEvent: 'onScrollEnd',
        reactEventType: 'scrollend',
        nativeEvent: 'scrollend',

        /** 接收目标 DOM node，创建 Event(scrollend) 并 dispatchEvent；bubbles=false、cancelable=true，固定此用例的原生输入。 */
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

  // 以下使用隔离模块的两份renderer记录合成事件在嵌套根中的现有顺序。
  describe('enter/leave events', () => {

    /** 两个隔离 renderer 的内外根均注册 mouse enter/leave；目标 mouseover(relatedTarget=null) 后内父→内→外父→外，mouseout(relatedTarget=body) 后内→内父→外→外父，验证每根单独提取 EnterLeave 的现有次序。 */
    it('onMouseEnter and onMouseLeave', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="div"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的进入回调记录 ---- inner enter，供共享日志断言定位该节点与阶段。 */
            onMouseEnter: e => {
              log.push('---- inner enter');
            },

            /** 内根目标的离开回调记录 ---- inner leave，供共享日志断言定位该节点与阶段。 */
            onMouseLeave: e => {
              log.push('---- inner leave');
            },
          }}
          parentProps={{

            /** 内根父节点的进入回调记录 --- inner parent enter，供共享日志断言定位该节点与阶段。 */
            onMouseEnter: e => {
              log.push('--- inner parent enter');
            },

            /** 内根父节点的离开回调记录 --- inner parent leave，供共享日志断言定位该节点与阶段。 */
            onMouseLeave: e => {
              log.push('--- inner parent leave');
            },
          }}
          outerProps={{

            /** 外根内节点的进入回调记录 -- outer enter，供共享日志断言定位该节点与阶段。 */
            onMouseEnter: e => {
              log.push('-- outer enter');
            },

            /** 外根内节点的离开回调记录 -- outer leave，供共享日志断言定位该节点与阶段。 */
            onMouseLeave: e => {
              log.push('-- outer leave');
            },
          }}
          outerParentProps={{

            /** 外根父节点的进入回调记录 - outer parent enter，供共享日志断言定位该节点与阶段。 */
            onMouseEnter: e => {
              log.push('- outer parent enter');
            },

            /** 外根父节点的离开回调记录 - outer parent leave，供共享日志断言定位该节点与阶段。 */
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

    /** 两份 renderer 的四级节点注册 pointer enter/leave；以普通 Event 分发 pointerover/pointerout，断言进入内父→内→外父→外、离开反向各根，验证此人工事件输入的跨根提取顺序；未模拟真实浏览器指针移动。 */
    it('onPointerEnter and onPointerLeave', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="div"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的进入回调记录 ---- inner enter，供共享日志断言定位该节点与阶段。 */
            onPointerEnter: e => {
              log.push('---- inner enter');
            },

            /** 内根目标的离开回调记录 ---- inner leave，供共享日志断言定位该节点与阶段。 */
            onPointerLeave: e => {
              log.push('---- inner leave');
            },
          }}
          parentProps={{

            /** 内根父节点的进入回调记录 --- inner parent enter，供共享日志断言定位该节点与阶段。 */
            onPointerEnter: e => {
              log.push('--- inner parent enter');
            },

            /** 内根父节点的离开回调记录 --- inner parent leave，供共享日志断言定位该节点与阶段。 */
            onPointerLeave: e => {
              log.push('--- inner parent leave');
            },
          }}
          outerProps={{

            /** 外根内节点的进入回调记录 -- outer enter，供共享日志断言定位该节点与阶段。 */
            onPointerEnter: e => {
              log.push('-- outer enter');
            },

            /** 外根内节点的离开回调记录 -- outer leave，供共享日志断言定位该节点与阶段。 */
            onPointerLeave: e => {
              log.push('-- outer leave');
            },
          }}
          outerParentProps={{

            /** 外根父节点的进入回调记录 - outer parent enter，供共享日志断言定位该节点与阶段。 */
            onPointerEnter: e => {
              log.push('- outer parent enter');
            },

            /** 外根父节点的离开回调记录 - outer parent leave，供共享日志断言定位该节点与阶段。 */
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

  // 以下使用隔离模块的两份renderer记录合成事件在嵌套根中的现有顺序。
  describe('polyfilled events', () => {

    /** input 位于隔离 renderer 的内根，发送 textInput(data=abcd)；日志先内根捕获/冒泡再外根捕获/冒泡，外父回调核对type=beforeinput，验证 polyfill 在每根各自完成两阶段。 */
    it('onBeforeInput', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
            onBeforeInput: e => {
              log.push('---- inner');
            },

            /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
            onBeforeInputCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{

            /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
            onBeforeInput: e => {
              log.push('--- inner parent');
            },

            /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
            onBeforeInputCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{

            /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
            onBeforeInput: e => {
              log.push('-- outer');
            },

            /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
            onBeforeInputCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{

            /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
            onBeforeInput: e => {
              log.push('- outer parent');
            },

            /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

    /** 先用 input 原型 setter 绕过值跟踪写 hello，再向内根 input 发冒泡 input；只记录内父/目标的捕获及目标/内父冒泡，验证 change 只由持有该输入跟踪的 renderer 提取。 */
    it('onChange', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
            onChange: e => {
              log.push('---- inner');
            },

            /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
            onChangeCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{

            /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
            onChange: e => {
              log.push('--- inner parent');
            },

            /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
            onChangeCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{

            /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
            onChange: e => {
              log.push('-- outer');
            },

            /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
            onChangeCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{

            /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
            onChange: e => {
              log.push('- outer parent');
            },

            /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

    /** 向内根 input 手动分发冒泡 compositionstart；日志先内根再外根各完成捕获/冒泡，外父校验合成type，验证 Composition 插件的每根两阶段提取。 */
    it('onCompositionStart', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
            onCompositionStart: e => {
              log.push('---- inner');
            },

            /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
            onCompositionStartCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{

            /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
            onCompositionStart: e => {
              log.push('--- inner parent');
            },

            /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
            onCompositionStartCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{

            /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
            onCompositionStart: e => {
              log.push('-- outer');
            },

            /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
            onCompositionStartCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{

            /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
            onCompositionStart: e => {
              log.push('- outer parent');
            },

            /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

    /** 向内根 input 分发 compositionend；两根分别按捕获/冒泡完成日志，外父校验type=compositionend，验证合成事件的跨隔离renderer次序。 */
    it('onCompositionEnd', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
            onCompositionEnd: e => {
              log.push('---- inner');
            },

            /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
            onCompositionEndCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{

            /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
            onCompositionEnd: e => {
              log.push('--- inner parent');
            },

            /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
            onCompositionEndCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{

            /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
            onCompositionEnd: e => {
              log.push('-- outer');
            },

            /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
            onCompositionEndCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{

            /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
            onCompositionEnd: e => {
              log.push('- outer parent');
            },

            /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

    /** 向内根 input 分发 compositionupdate；内根两阶段先于外根两阶段，外父校验type，验证该输入的Composition合成顺序。 */
    it('onCompositionUpdate', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdate: e => {
              log.push('---- inner');
            },

            /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdateCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{

            /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdate: e => {
              log.push('--- inner parent');
            },

            /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdateCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{

            /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdate: e => {
              log.push('-- outer');
            },

            /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdateCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{

            /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
            onCompositionUpdate: e => {
              log.push('- outer parent');
            },

            /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

    /** 先聚焦内根 input，再分发冒泡 keydown；仅内父/目标捕获及目标/内父冒泡，验证 Select 插件对由该renderer记录的活动输入提取选区事件。 */
    it('onSelect', async () => {
      const log = [];
      const targetRef = React.createRef();
      await render(
        <Fixture
          type="input"
          targetRef={targetRef}
          targetProps={{

            /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
            onSelect: e => {
              log.push('---- inner');
            },

            /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
            onSelectCapture: e => {
              log.push('---- inner capture');
            },
          }}
          parentProps={{

            /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
            onSelect: e => {
              log.push('--- inner parent');
            },

            /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
            onSelectCapture: e => {
              log.push('--- inner parent capture');
            },
          }}
          outerProps={{

            /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
            onSelect: e => {
              log.push('-- outer');
            },

            /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
            onSelectCapture: e => {
              log.push('-- outer capture');
            },
          }}
          outerParentProps={{

            /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
            onSelect: e => {
              log.push('- outer parent');
            },

            /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 接收事件配置type/React名/原生名/dispatch，依次await十个分支：有无目标、React四阶段停止、原生四位置停止；每分支由render清理并新建嵌套根。 */
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

  /** 接收目标监听型非原生冒泡事件配置，依次检查有无目标及React/原生捕获停止、目标冒泡停止；包括React目标监听先于用户原生回调的次序。 */
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

  /** 接收scroll类配置，验证有无目标及捕获/目标截断；不调用外层冒泡分支，因为此类合成冒泡仅收集目标。 */
  async function testNonBubblingEvent(config) {
    await testNonBubblingEventWithTargetListener(config);
    await testNonBubblingEventWithoutTargetListener(config);
    await testReactStopPropagationInOuterCapturePhase(config);
    await testReactStopPropagationInInnerCapturePhase(config);
    await testReactStopPropagationInInnerBubblePhase(config);
    await testNativeStopPropagationInOuterCapturePhase(config);
    await testNativeStopPropagationInInnerCapturePhase(config);
  }

  /** 创建四级都有处理器的嵌套隔离根，dispatch后断言捕获从外到内、冒泡从内到外，并核对合成type，作为原生冒泡基线。 */
  async function testNativeBubblingEventWithTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 创建四级处理器并传目标额外props；非冒泡事件仍经全部原生捕获，React目标监听仅模拟内根目标/内父冒泡，断言外根无冒泡回调。 */
  async function testEmulatedBubblingEventWithTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          ...eventConfig.targetProps,

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件的目标监听属于内层renderer：原生事件不进入外根冒泡监听器，内层renderer只收集本根的目标与父回调。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      ---- inner capture
      ---- inner
      --- inner parent
    `);
  }

  /** 给scroll类四级节点注册两阶段回调；断言所有捕获而冒泡仅目标，验证不模拟祖先scroll冒泡。 */
  async function testNonBubblingEventWithTargetListener(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 目标无处理器而三祖先有回调，分发原生冒泡事件；断言捕获/冒泡穿越两根但没有目标日志，验证根委托不依赖目标prop。 */
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

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 目标无React处理器但保留事件所需宿主props；分发原生不冒泡事件，断言两根捕获及仅内父合成冒泡，验证宿主自动目标监听。 */
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

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            expect(e.type).toBe(eventConfig.reactEventType);
            log.push('- outer parent capture');
          },
        }}
      />,
    );
    expect(log.length).toBe(0);
    eventConfig.dispatch(targetRef.current);
    // 此事件的目标监听属于内层renderer：原生事件不进入外根冒泡监听器，内层renderer只收集本根的目标与父回调。
    expect(log).toEqual(unindent`
      - outer parent capture
      -- outer capture
      --- inner parent capture
      --- inner parent
    `);
  }

  /** 目标无scroll处理器，祖先有捕获/冒泡回调；断言只有三祖先捕获，验证不会为目标缺失回调补用祖先冒泡。 */
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

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 外根内节点的React捕获stopPropagation；即使目标有原生监听也只记录外父/外捕获，验证阻断内根及目标路径。 */
  async function testReactStopPropagationInOuterCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
            node.addEventListener(eventConfig.nativeEvent, e => {
              // 事件在更早阶段已被阻止，因此日志中完全不应出现这一项。
              log.push('---- inner (native)');
            });
          }
        }}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调先 stopPropagation 再记录 -- outer capture，构造本 helper 的合成传播截断点。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            e.stopPropagation(); // <---------
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 内根父React捕获stopPropagation；保留外父/外/内父捕获、无目标原生或冒泡，验证已进入内根后的合成截断。 */
  async function testReactStopPropagationInInnerCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
            node.addEventListener(eventConfig.nativeEvent, e => {
              // 事件在更早阶段已被阻止，因此日志中完全不应出现这一项。
              log.push('---- inner (native)');
            });
          }
        }}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调先 stopPropagation 再记录 --- inner parent capture，构造本 helper 的合成传播截断点。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            e.stopPropagation(); // <---------
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 目标React冒泡回调stopPropagation，外节点另设原生监听；全部捕获后只记目标冒泡，验证祖先及外原生冒泡被阻断。 */
  async function testReactStopPropagationInInnerBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{
          ...eventConfig.targetProps,

          /** 内根目标的冒泡回调先 stopPropagation 再记录 ---- inner，构造本 helper 的合成传播截断点。 */
          [eventConfig.reactEvent]: e => {
            e.stopPropagation(); // <---------
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerRef={node => {
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
            node.addEventListener(eventConfig.nativeEvent, e => {
              // 事件在更早阶段已被阻止，因此日志中完全不应出现这一项。
              log.push('-- outer (native)');
            });
          }
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 外根内节点的React冒泡stopPropagation；日志先完整内根路径再到外节点，不含外父冒泡，验证外根合成队列停止。 */
  async function testReactStopPropagationInOuterBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调先 stopPropagation 再记录 -- outer，构造本 helper 的合成传播截断点。 */
          [eventConfig.reactEvent]: e => {
            e.stopPropagation(); // <---------
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 外父DOM原生捕获回调stopPropagation；外根已在根容器捕获完成两条日志，随后原生停止使内根完全无日志，验证原生节点与根监听先后。 */
  async function testNativeStopPropagationInOuterCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentRef={node => {
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
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

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 内父DOM原生捕获stopPropagation；两根所有React捕获已执行，随后仅记原生回调且无React冒泡，验证根捕获先于内部原生节点。 */
  async function testNativeStopPropagationInInnerCapturePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentRef={node => {
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
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

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 目标DOM原生冒泡回调stopPropagation；先有全部React捕获再记目标原生，无React冒泡，验证原生停止阻断委托根的冒泡接收。 */
  async function testNativeStopPropagationInInnerBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={node => {
          targetRef.current = node;
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
            node.addEventListener(eventConfig.nativeEvent, e => {
              log.push('---- inner (native)');
              e.stopPropagation(); // <---------
            });
          }
        }}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 目标挂原生冒泡stopPropagation，且事件由React直接目标监听；断言React内根冒泡先完成、用户原生监听最后，验证后注册监听不能撤销已经执行的合成队列。 */
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
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
            node.addEventListener(eventConfig.nativeEvent, e => {
              log.push('---- inner (native)');
              e.stopPropagation(); // <---------
            });
          }
        }}
        targetProps={{
          ...eventConfig.targetProps,

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 外节点DOM原生冒泡stopPropagation；内根合成两阶段已经结束，随后记外原生回调、无外根冒泡，验证阻断第二根的原生入口。 */
  async function testNativeStopPropagationInOuterBubblePhase(eventConfig) {
    const log = [];
    const targetRef = React.createRef();
    await render(
      <Fixture
        type={eventConfig.type}
        targetRef={targetRef}
        targetProps={{

          /** 内根目标的冒泡回调记录 ---- inner，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('---- inner');
          },

          /** 内根目标的捕获回调记录 ---- inner capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('---- inner capture');
          },
        }}
        parentProps={{

          /** 内根父节点的冒泡回调记录 --- inner parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('--- inner parent');
          },

          /** 内根父节点的捕获回调记录 --- inner parent capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('--- inner parent capture');
          },
        }}
        outerRef={node => {
          if (node) {
            // 本分支只挂载一次该节点；下一分支cleanup卸载两根并移除整棵DOM树，不复用这个监听目标。
            node.addEventListener(eventConfig.nativeEvent, e => {
              log.push('-- outer (native)');
              e.stopPropagation(); // <---------
            });
          }
        }}
        outerProps={{

          /** 外根内节点的冒泡回调记录 -- outer，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('-- outer');
          },

          /** 外根内节点的捕获回调记录 -- outer capture，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent + 'Capture']: e => {
            log.push('-- outer capture');
          },
        }}
        outerParentProps={{

          /** 外根父节点的冒泡回调记录 - outer parent，供共享日志断言定位该节点与阶段。 */
          [eventConfig.reactEvent]: e => {
            log.push('- outer parent');
          },

          /** 外根父节点的捕获回调记录 - outer parent capture，供共享日志断言定位该节点与阶段。 同时核对合成 event.type 与该事件配置/预期一致。 */
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

  /** 接收目标tag、四级props/ref，memo化Inner并用Outer包NestedReact；构造DOM嵌套但分别由两份renderer管理的四级传播fixture。 */
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

  /** 接收children，在layout中创建内层容器与隔离renderer根、flushSync提交；cleanup卸载内根并移除容器，依赖children变化会先重建该根。 */
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

  /** 按type创建目标宿主，包在内父div中，分别spread目标/父props并安装ref，供内根两个阶段观测。 */
  function Inner({type, targetRef, targetProps, parentRef, parentProps}) {
    const T = type;
    return (
      <div {...parentProps} ref={parentRef}>
        <T {...targetProps} ref={targetRef} />
      </div>
    );
  }

  /** 接收外层两级props/ref与children，返回两层div包内根容器，提供外根的两个React祖先。 */
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

  /** 接收模板字符串数组，取首段按行trim并过滤空行，返回日志字符串数组，让路径断言保持可读缩进。 */
  function unindent(str) {
    return str[0]
      .split('\n')
      .map(s => s.trim())
      .filter(s => s !== '');
  }
});
