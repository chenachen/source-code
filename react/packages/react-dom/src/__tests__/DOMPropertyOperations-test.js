/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 由 `yarn test-fire` 设置。
/** 输入attribute同步功能开关；由测试矩阵提供，决定input value attribute应随受控值同步还是缺失，property断言在两种模式均成立。 */
const {disableInputAttributeSyncing} = require('shared/ReactFeatureFlags');

describe('DOMPropertyOperations', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  // 将值设置为 React 无法看到的方式。 以便后续的 "change" 事件会触发事件处理器。
  /** 取得原生value setter；用call绕过React实例tracker改输入值，使随后的input事件能检测真实差异。 */
  const setUntrackedValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  /** 取得原生checked setter；用call绕过React勾选tracker，为radio点击提取模拟浏览器值变化。 */
  const setUntrackedChecked = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'checked',
  ).set;

  describe('setValueForProperty', () => {

    /** 给定空客户端根，挂载 title="Tip!"；断言 DOM.title 为 Tip!，验证普通属性写入的可观察值。 */
    it('should set values as properties by default', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div title="Tip!" />);
      });
      expect(container.firstChild.title).toBe('Tip!');
    });

    /** 给定空根，挂载 role="#"；断言 role attribute 为 # 而 DOM.role 未定义，验证无对应 property 的 attribute 路径。 */
    it('should set values as attributes if necessary', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div role="#" />);
      });
      expect(container.firstChild.getAttribute('role')).toBe('#');
      expect(container.firstChild.role).toBeUndefined();
    });

    /** 给定 SVG 容器，挂载 image 的 xlinkHref；断言 XLink 命名空间 href 为 about:blank，验证 namespace 写入。 */
    it('should set values as namespace attributes if necessary', async () => {
      const container = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg',
      );
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<image xlinkHref="about:blank" />);
      });
      expect(
        container.firstChild.getAttributeNS(
          'http://www.w3.org/1999/xlink',
          'href',
        ),
      ).toBe('about:blank');
    });

    /** 给定 div，依次把 disabled 设为字符串、true、false、null、undefined；断言启用时 attribute 为空串，其余移除，验证布尔 attribute 的存在性语义。 */
    it('should set values as boolean properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div disabled="disabled" />);
      });
      expect(container.firstChild.getAttribute('disabled')).toBe('');
      await act(() => {
        root.render(<div disabled={true} />);
      });
      expect(container.firstChild.getAttribute('disabled')).toBe('');
      await act(() => {
        root.render(<div disabled={false} />);
      });
      expect(container.firstChild.getAttribute('disabled')).toBe(null);
      await act(() => {
        root.render(<div disabled={true} />);
      });
      await act(() => {
        root.render(<div disabled={null} />);
      });
      expect(container.firstChild.getAttribute('disabled')).toBe(null);
      await act(() => {
        root.render(<div disabled={true} />);
      });
      await act(() => {
        root.render(<div disabled={undefined} />);
      });
      expect(container.firstChild.getAttribute('disabled')).toBe(null);
    });

    /** 给定 toString 返回 css-class 的对象，作为 className 挂载；断言 class attribute 为 css-class，验证 DOM 写入前的字符串转换。 */
    it('should convert attribute values to string first', async () => {
      // 浏览器默认采用这种行为。 但是某些测试环境并不支持。 这确保了我们有可预测的行为。
      const obj = {

        /** 把测试对象转换成固定css-class；返回该字符串供className写入，隔离浏览器对对象隐式转换的差异。 */
        toString: function () {
          return 'css-class';
        },
      };

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div className={obj} />);
      });
      expect(container.firstChild.getAttribute('class')).toBe('css-class');
    });

    /** 给定受控 input value 空串并提供 onChange，挂载后断言 value property 仍为空串；按同步开关断言 value attribute 缺失或空串，验证 input 特殊路径。 */
    it('should not remove empty attributes for special input properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input value="" onChange={() => {}} />);
      });
      if (disableInputAttributeSyncing) {
        expect(container.firstChild.hasAttribute('value')).toBe(false);
      } else {
        expect(container.firstChild.getAttribute('value')).toBe('');
      }
      expect(container.firstChild.value).toBe('');
    });

    /** 给定 select 的两个 option，一个显式空 value、一个仅有 filled 文本；断言 option.value 分别为空与 filled，验证显式空值不会回退到文本。 */
    it('should not remove empty attributes for special option properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select>
            <option value="">empty</option>
            <option>filled</option>
          </select>,
        );
      });
    // https://github.com/facebook/react/issues/6219 的回归测试。
      expect(container.firstChild.firstChild.value).toBe('');
      expect(container.firstChild.lastChild.value).toBe('filled');
    });

    /** 给定空根，挂载 allowFullScreen=false 的 div；断言该 attribute 不存在，验证 false 不序列化成布尔 attribute。 */
    it('should remove for falsey boolean properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div allowFullScreen={false} />);
      });
      expect(container.firstChild.hasAttribute('allowFullScreen')).toBe(false);
    });

    /** 给定 iframe，先设 credentialless=true 再设 false；断言 attribute 从空串变为缺失，验证布尔开关的更新路径。 */
    it('should set credentialless boolean attribute on iframes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<iframe credentialless={true} />);
      });
      expect(container.firstChild.getAttribute('credentialless')).toBe('');
      await act(() => {
        root.render(<iframe credentialless={false} />);
      });
      expect(container.firstChild.hasAttribute('credentialless')).toBe(false);
    });

    /** 给定 iframe，传 credentialless 字符串 true；断言 DEV 提示应传布尔值，同时 attribute 为空串，验证诊断与实际布尔存在性结果。 */
    it('should set credentialless attribute when passed a string and warn', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<iframe credentialless="true" />);
      });
      assertConsoleErrorDev([
        'Received the string `true` for the boolean attribute `credentialless`. ' +
          'Although this works, it will not work as expected if you pass the string "false". ' +
          'Did you mean credentialless={true}?\n' +
          '    in iframe (at **)',
      ]);
      expect(container.firstChild.getAttribute('credentialless')).toBe('');
    });

    /** 给定已挂载 data-foo=bar 的 div，更新为 null；断言 attribute 从存在变为缺失，验证自定义 attribute 清除。 */
    it('should remove when setting custom attr to null', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div data-foo="bar" />);
      });
      expect(container.firstChild.hasAttribute('data-foo')).toBe(true);
      await act(() => {
        root.render(<div data-foo={null} />);
      });
      expect(container.firstChild.hasAttribute('data-foo')).toBe(false);
    });

    /** 给定 className=selected 的 div，更新为 null；断言 DOM.className 为空串、class attribute 缺失，验证移除不会写成字符串 null。 */
    it('should set className to empty string instead of null', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div className="selected" />);
      });
      expect(container.firstChild.className).toBe('selected');
      await act(() => {
        root.render(<div className={null} />);
      });
      // className 应为 ''；在某些浏览器中，它不能是 'null'，也不能是会被转换成 'null' 的 null。
      expect(container.firstChild.className).toBe('');
      expect(container.firstChild.getAttribute('class')).toBe(null);
    });

    /** 给定 hidden=true 的 div，更新为 false；断言 hidden attribute 被移除，验证布尔属性清除。 */
    it('should remove property properly for boolean properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div hidden={true} />);
      });
      expect(container.firstChild.hasAttribute('hidden')).toBe(true);
      await act(() => {
        root.render(<div hidden={false} />);
      });
      expect(container.firstChild.hasAttribute('hidden')).toBe(false);
    });

    /** 给定 progress，监视 setAttribute 后依次传数字30和字符串30；断言写入两次，验证非 input 的 value 更新仍逐次写 attribute。 */
    it('should always assign the value attribute for non-inputs', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<progress />);
      });
      spyOnDevAndProd(container.firstChild, 'setAttribute');
      await act(() => {
        root.render(<progress value={30} />);
      });
      await act(() => {
        root.render(<progress value="30" />);
      });
      expect(container.firstChild.setAttribute).toHaveBeenCalledTimes(2);
    });

    /** 给定 progress value=30，更新为 null；断言 value attribute 缺失，验证恢复浏览器的 indeterminate 状态。 */
    it('should return the progress to intermediate state on null value', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<progress value={30} />);
      });
      await act(() => {
        root.render(<progress value={null} />);
      });
    // 确保进度元素恢复为 indeterminate 状态。
    // https://github.com/facebook/react/issues/6119 的回归测试。
      expect(container.firstChild.hasAttribute('value')).toBe(false);
    });

    /** 给定小写 oncustomevent 函数，挂载自定义元素并派 customevent；断言调用一次，验证事件名从 on 前缀后保持小写。 */
    it('custom element custom events lowercase', async () => {
      const oncustomevent = jest.fn();

      /** 返回注册小写customevent监听的自定义元素；闭包保留spy以检查一次原生派发。 */
      function Test() {
        return <my-custom-element oncustomevent={oncustomevent} />;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test />);
      });
      container
        .querySelector('my-custom-element')
        .dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
    });

    /** 给定 onCustomevent 函数，派大小写匹配的 Customevent；断言调用一次，验证自定义事件名称保留大小写。 */
    it('custom element custom events uppercase', async () => {
      const oncustomevent = jest.fn();

      /** 返回注册大小写事件监听的自定义元素；事件名称需与Customevent原生派发一致。 */
      function Test() {
        return <my-custom-element onCustomevent={oncustomevent} />;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test />);
      });
      container
        .querySelector('my-custom-element')
        .dispatchEvent(new Event('Customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
    });

    /** 给定 oncustom-event 函数，派 custom-event；断言调用一次，验证连字符事件名的监听安装。 */
    it('custom element custom event with dash in name', async () => {
      const oncustomevent = jest.fn();

      /** 返回注册带连字符custom-event监听的自定义元素，用于验证on前缀解析保留事件名称。 */
      function Test() {
        return <my-custom-element oncustom-event={oncustomevent} />;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test />);
      });
      container
        .querySelector('my-custom-element')
        .dispatchEvent(new Event('custom-event'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
    });

    /** 给定自定义元素监听，依次改为 false、恢复原函数、替换新函数并派事件；断言旧函数次数1→1→2后不再增加、新函数一次，验证移除与替换。保存节点用于派发；自比较断言本身不证明节点复用。 */
    it('custom element remove event handler', async () => {
      const oncustomevent = jest.fn();

      /** 接收props.handler并作为oncustomevent返回；保持同一宿主类型，通过handler变化触发监听移除或替换。 */
      function Test(props) {
        return <my-custom-element oncustomevent={props.handler} />;
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test handler={oncustomevent} />);
      });
      const customElement = container.querySelector('my-custom-element');
      customElement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<Test handler={false} />);
      });
      // 确保第二次渲染没有创建一个新的元素。 我们希望确保 removeEventListener 实际上在同一个元素上被
      // 调用。
      expect(customElement).toBe(customElement);
      customElement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<Test handler={oncustomevent} />);
      });
      customElement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);

      const oncustomevent2 = jest.fn();
      await act(() => {
        root.render(<Test handler={oncustomevent2} />);
      });
      customElement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(oncustomevent2).toHaveBeenCalledTimes(1);
    });

    /** 给定 on* 的字符串、对象、数组和布尔值，挂载后断言对应 attribute 为 hello、[object Object]、one,two、空串或缺失；逐名派事件无异常，验证非函数走值写入。 */
    it('custom elements shouldnt have non-functions for on* attributes treated as event listeners', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <my-custom-element
            onstring={'hello'}
            onobj={{hello: 'world'}}
            onarray={['one', 'two']}
            ontrue={true}
            onfalse={false}
          />,
        );
      });
      const customElement = container.querySelector('my-custom-element');
      expect(customElement.getAttribute('onstring')).toBe('hello');
      expect(customElement.getAttribute('onobj')).toBe('[object Object]');
      expect(customElement.getAttribute('onarray')).toBe('one,two');
      expect(customElement.getAttribute('ontrue')).toBe('');
      expect(customElement.getAttribute('onfalse')).toBe(null);

      // 派发对应名称的事件，确认整个过程不会崩溃。
      customElement.dispatchEvent(new Event('string'));
      customElement.dispatchEvent(new Event('obj'));
      customElement.dispatchEvent(new Event('array'));
      customElement.dispatchEvent(new Event('true'));
      customElement.dispatchEvent(new Event('false'));
    });

    /** 给定接入 document 的自定义元素，分别设置 React onClick 与 DOM.onclick 并点击；断言两者各一次、SyntheticEvent.nativeEvent 等于原生事件，验证两层事件并存。 */
    it('custom elements should still have onClick treated like regular elements', async () => {
      let syntheticClickEvent = null;
      const syntheticEventHandler = jest.fn(
        event => (syntheticClickEvent = event),
      );
      let nativeClickEvent = null;
      const nativeEventHandler = jest.fn(event => (nativeClickEvent = event));

      /** 返回带SyntheticEvent点击spy的自定义元素；与随后DOM.onclick并用，检查nativeEvent身份。 */
      function Test() {
        return <my-custom-element onClick={syntheticEventHandler} />;
      }

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test />);
      });

      const customElement = container.querySelector('my-custom-element');
      customElement.onclick = nativeEventHandler;
      container.querySelector('my-custom-element').click();

      expect(nativeEventHandler).toHaveBeenCalledTimes(1);
      expect(syntheticEventHandler).toHaveBeenCalledTimes(1);
      expect(syntheticClickEvent.nativeEvent).toBe(nativeClickEvent);
    });

    /** 给定自定义元素 onChange，派冒泡 change，再移除并重加监听；断言次数1、1、2且 nativeEvent 为原事件，验证原生 change 与监听更新。 */
    it('custom elements should have working onChange event listeners', async () => {
      let reactChangeEvent = null;
      const eventHandler = jest.fn(event => (reactChangeEvent = event));
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element onChange={eventHandler} />);
      });
      const customElement = container.querySelector('my-custom-element');
      let expectedHandlerCallCount = 0;

      const changeEvent = new Event('change', {bubbles: true});
      customElement.dispatchEvent(changeEvent);
      expectedHandlerCallCount++;
      expect(eventHandler).toHaveBeenCalledTimes(expectedHandlerCallCount);
      expect(reactChangeEvent.nativeEvent).toBe(changeEvent);

      // 还要确认移除后重新添加事件监听器仍可工作。
      await act(() => {
        root.render(<my-custom-element />);
      });
      customElement.dispatchEvent(new Event('change', {bubbles: true}));
      expect(eventHandler).toHaveBeenCalledTimes(expectedHandlerCallCount);
      await act(() => {
        root.render(<my-custom-element onChange={eventHandler} />);
      });
      customElement.dispatchEvent(new Event('change', {bubbles: true}));
      expectedHandlerCallCount++;
      expect(eventHandler).toHaveBeenCalledTimes(expectedHandlerCallCount);
    });

    /** 给定自定义元素 onInput，派冒泡 input，再移除并重加监听；断言次数1、1、2且 nativeEvent 为原事件，验证原生 input 与监听更新。 */
    it('custom elements should have working onInput event listeners', async () => {
      let reactInputEvent = null;
      const eventHandler = jest.fn(event => (reactInputEvent = event));
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element onInput={eventHandler} />);
      });
      const customElement = container.querySelector('my-custom-element');
      let expectedHandlerCallCount = 0;

      const inputEvent = new Event('input', {bubbles: true});
      customElement.dispatchEvent(inputEvent);
      expectedHandlerCallCount++;
      expect(eventHandler).toHaveBeenCalledTimes(expectedHandlerCallCount);
      expect(reactInputEvent.nativeEvent).toBe(inputEvent);

      // 还要确认移除后重新添加事件监听器仍可工作。
      await act(() => {
        root.render(<my-custom-element />);
      });
      customElement.dispatchEvent(new Event('input', {bubbles: true}));
      expect(eventHandler).toHaveBeenCalledTimes(expectedHandlerCallCount);
      await act(() => {
        root.render(<my-custom-element onInput={eventHandler} />);
      });
      customElement.dispatchEvent(new Event('input', {bubbles: true}));
      expectedHandlerCallCount++;
      expect(eventHandler).toHaveBeenCalledTimes(expectedHandlerCallCount);
    });

    /** 给定自定义元素同时注册 onInput/onChange；分别派 input/change，断言次数依次为(1,0)与(1,1)，验证两种事件不互相合成。 */
    it('custom elements should have separate onInput and onChange handling', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const inputEventHandler = jest.fn();
      const changeEventHandler = jest.fn();
      await act(() => {
        root.render(
          <my-custom-element
            onInput={inputEventHandler}
            onChange={changeEventHandler}
          />,
        );
      });
      const customElement = container.querySelector('my-custom-element');

      customElement.dispatchEvent(new Event('input', {bubbles: true}));
      expect(inputEventHandler).toHaveBeenCalledTimes(1);
      expect(changeEventHandler).toHaveBeenCalledTimes(0);

      customElement.dispatchEvent(new Event('change', {bubbles: true}));
      expect(inputEventHandler).toHaveBeenCalledTimes(1);
      expect(changeEventHandler).toHaveBeenCalledTimes(1);
    });

    /** 给定自定义 customevent 监听，派事件、删 prop、再添加并各派一次；断言累计1→1→2，验证 removeEventListener 与重装。 */
    it('custom elements should be able to remove and re-add custom event listeners', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const eventHandler = jest.fn();
      await act(() => {
        root.render(<my-custom-element oncustomevent={eventHandler} />);
      });

      const customElement = container.querySelector('my-custom-element');
      customElement.dispatchEvent(new Event('customevent'));
      expect(eventHandler).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<my-custom-element />);
      });
      customElement.dispatchEvent(new Event('customevent'));
      expect(eventHandler).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<my-custom-element oncustomevent={eventHandler} />);
      });
      customElement.dispatchEvent(new Event('customevent'));
      expect(eventHandler).toHaveBeenCalledTimes(2);
    });

    /** 给定普通 input 与带 is 的 input，绕过 value tracker 改值后派 input/change/click；断言两者 input 同时触发 onInput/onChange、原生 change 不重复、click 仅触发 onClick，验证内建 input 语义不被 is 改写。 */
    it('<input is=...> should have the same onChange/onInput/onClick behavior as <input>', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const regularOnInputHandler = jest.fn();
      const regularOnChangeHandler = jest.fn();
      const regularOnClickHandler = jest.fn();
      const customOnInputHandler = jest.fn();
      const customOnChangeHandler = jest.fn();
      const customOnClickHandler = jest.fn();

      /** 清空普通及带is的input六个事件spy；各派发步骤独立计数，避免累计次数掩盖错误提取。 */
      function clearMocks() {
        regularOnInputHandler.mockClear();
        regularOnChangeHandler.mockClear();
        regularOnClickHandler.mockClear();
        customOnInputHandler.mockClear();
        customOnChangeHandler.mockClear();
        customOnClickHandler.mockClear();
      }
      await act(() => {
        root.render(
          <div>
            <input
              onInput={regularOnInputHandler}
              onChange={regularOnChangeHandler}
              onClick={regularOnClickHandler}
            />
            <input
              is="my-custom-element"
              onInput={customOnInputHandler}
              onChange={customOnChangeHandler}
              onClick={customOnClickHandler}
            />
          </div>,
        );
      });

      const regularInput = container.querySelector(
        'input:not([is=my-custom-element])',
      );
      const customInput = container.querySelector(
        'input[is=my-custom-element]',
      );
      expect(regularInput).not.toBe(customInput);

      // 应触发 onInput 和 onChange 事件，无论输入类型是哪种。
      clearMocks();
      setUntrackedValue.call(regularInput, 'hello');
      regularInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(1);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(0);
      setUntrackedValue.call(customInput, 'hello');
      customInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(1);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(customOnClickHandler).toHaveBeenCalledTimes(0);

    // 原生 change 事件本身不会产生额外的 React 事件。
      clearMocks();
      regularInput.dispatchEvent(new Event('change', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(0);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(0);
      customInput.dispatchEvent(new Event('change', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(0);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(customOnClickHandler).toHaveBeenCalledTimes(0);

      // 两种输入都处理了点击事件.
      clearMocks();
      regularInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(0);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(1);
      customInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(0);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(customOnClickHandler).toHaveBeenCalledTimes(1);

      // 再次输入时，两种 input 都应触发 onInput 与 onChange。
      clearMocks();
      setUntrackedValue.call(regularInput, 'goodbye');
      regularInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(1);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(0);
      setUntrackedValue.call(customInput, 'goodbye');
      customInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(1);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(customOnClickHandler).toHaveBeenCalledTimes(0);
    });

    /** 给定普通和带 is 的 radio，绕过 checked tracker 改勾选后派 click；断言两者 onChange/onClick 各一次，input 仅触发 onInput，验证 radio 的点击提取与去重一致。 */
    it('<input type=radio is=...> should have the same onChange/onInput/onClick behavior as <input type=radio>', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const regularOnInputHandler = jest.fn();
      const regularOnChangeHandler = jest.fn();
      const regularOnClickHandler = jest.fn();
      const customOnInputHandler = jest.fn();
      const customOnChangeHandler = jest.fn();
      const customOnClickHandler = jest.fn();

      /** 清空普通及带is的radio六个spy；把click与input两条提取路径的次数分开检查。 */
      function clearMocks() {
        regularOnInputHandler.mockClear();
        regularOnChangeHandler.mockClear();
        regularOnClickHandler.mockClear();
        customOnInputHandler.mockClear();
        customOnChangeHandler.mockClear();
        customOnClickHandler.mockClear();
      }
      await act(() => {
        root.render(
          <div>
            <input
              type="radio"
              onInput={regularOnInputHandler}
              onChange={regularOnChangeHandler}
              onClick={regularOnClickHandler}
            />
            <input
              is="my-custom-element"
              type="radio"
              onInput={customOnInputHandler}
              onChange={customOnChangeHandler}
              onClick={customOnClickHandler}
            />
          </div>,
        );
      });

      const regularInput = container.querySelector(
        'input:not([is=my-custom-element])',
      );
      const customInput = container.querySelector(
        'input[is=my-custom-element]',
      );
      expect(regularInput).not.toBe(customInput);

      // 点击应触发两个输入的 onClick 和 onChange。
      clearMocks();
      setUntrackedChecked.call(regularInput, true);
      regularInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(0);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(1);
      setUntrackedChecked.call(customInput, true);
      customInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(0);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(customOnClickHandler).toHaveBeenCalledTimes(1);

      // 只有原生输入事件产生 React onInput 事件。
      clearMocks();
      regularInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(1);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(0);
      customInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(1);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(customOnClickHandler).toHaveBeenCalledTimes(0);

    // 再次点击时，两个 input 都应触发 onClick 与 onChange。
      clearMocks();
      setUntrackedChecked.call(regularInput, false);
      regularInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(0);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(1);
      setUntrackedChecked.call(customInput, false);
      customInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(0);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(customOnClickHandler).toHaveBeenCalledTimes(1);
    });

    /** 给定普通与带 is 的 select，分别派 click/input/change；断言各自只触发匹配 handler，验证 select 的原生 change 提取与 is 路径一致。 */
    it('<select is=...> should have the same onChange/onInput/onClick behavior as <select>', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const regularOnInputHandler = jest.fn();
      const regularOnChangeHandler = jest.fn();
      const regularOnClickHandler = jest.fn();
      const customOnInputHandler = jest.fn();
      const customOnChangeHandler = jest.fn();
      const customOnClickHandler = jest.fn();

      /** 清空普通及带is的select六个spy；每次原生事件前归零，以核对仅对应handler触发。 */
      function clearMocks() {
        regularOnInputHandler.mockClear();
        regularOnChangeHandler.mockClear();
        regularOnClickHandler.mockClear();
        customOnInputHandler.mockClear();
        customOnChangeHandler.mockClear();
        customOnClickHandler.mockClear();
      }
      await act(() => {
        root.render(
          <div>
            <select
              onInput={regularOnInputHandler}
              onChange={regularOnChangeHandler}
              onClick={regularOnClickHandler}
            />
            <select
              is="my-custom-element"
              onInput={customOnInputHandler}
              onChange={customOnChangeHandler}
              onClick={customOnClickHandler}
            />
          </div>,
        );
      });

      const regularSelect = container.querySelector(
        'select:not([is=my-custom-element])',
      );
      const customSelect = container.querySelector(
        'select[is=my-custom-element]',
      );
      expect(regularSelect).not.toBe(customSelect);

      // 点击事件应仅触发两个输入框的 onClick。
      clearMocks();
      regularSelect.dispatchEvent(new Event('click', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(0);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(1);
      customSelect.dispatchEvent(new Event('click', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(0);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(customOnClickHandler).toHaveBeenCalledTimes(1);

      // 输入事件应仅在两个输入中触发 onInput。
      clearMocks();
      regularSelect.dispatchEvent(new Event('input', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(1);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(0);
      customSelect.dispatchEvent(new Event('input', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(1);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(0);
      expect(customOnClickHandler).toHaveBeenCalledTimes(0);

      // 原生 change 事件应触发 onChange。
      clearMocks();
      regularSelect.dispatchEvent(new Event('change', {bubbles: true}));
      expect(regularOnInputHandler).toHaveBeenCalledTimes(0);
      expect(regularOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(regularOnClickHandler).toHaveBeenCalledTimes(0);
      customSelect.dispatchEvent(new Event('change', {bubbles: true}));
      expect(customOnInputHandler).toHaveBeenCalledTimes(0);
      expect(customOnChangeHandler).toHaveBeenCalledTimes(1);
      expect(customOnClickHandler).toHaveBeenCalledTimes(0);
    });

    /** 给定 div 父级内的自定义元素、普通及带 is 的 input；派三类冒泡事件，断言自定义元素 input/change 分开、input 子节点的 input 同时合成 change且后续 change不重复，click均冒泡，验证目标类型决定提取。 */
    it('onChange/onInput/onClick on div with various types of children', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const onChangeHandler = jest.fn();
      const onInputHandler = jest.fn();
      const onClickHandler = jest.fn();

      /** 清空父div的change/input/click spy；重复用于不同子目标，隔离事件目标类型对提取的影响。 */
      function clearMocks() {
        onChangeHandler.mockClear();
        onInputHandler.mockClear();
        onClickHandler.mockClear();
      }
      await act(() => {
        root.render(
          <div
            onChange={onChangeHandler}
            onInput={onInputHandler}
            onClick={onClickHandler}>
            <my-custom-element />
            <input />
            <input is="my-custom-element" />
          </div>,
        );
      });
      const customElement = container.querySelector('my-custom-element');
      const regularInput = container.querySelector(
        'input:not([is="my-custom-element"])',
      );
      const customInput = container.querySelector(
        'input[is="my-custom-element"]',
      );
      expect(regularInput).not.toBe(customInput);

      // 自定义元素对 input/change 事件没有特殊逻辑。
      clearMocks();
      customElement.dispatchEvent(new Event('input', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      customElement.dispatchEvent(new Event('change', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      customElement.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);

      // 普通 input 元素会把浏览器 input 事件视为 onChange。
      clearMocks();
      setUntrackedValue.call(regularInput, 'hello');
      regularInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      regularInput.dispatchEvent(new Event('change', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      regularInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);

      // 自定义 input 元素会把浏览器 input 事件视为 onChange。
      clearMocks();
      setUntrackedValue.call(customInput, 'hello');
      customInput.dispatchEvent(new Event('input', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      customInput.dispatchEvent(new Event('change', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      customInput.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);
    });

    /** 给定自定义父级包裹 input，绕过 tracker 改值并派 input/change/click；断言父级累计 input/change/click 各一次，验证子 input 合成 change 会冒泡且原生 change 不重复。 */
    it('custom element onChange/onInput/onClick with event target input child', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const onChangeHandler = jest.fn();
      const onInputHandler = jest.fn();
      const onClickHandler = jest.fn();
      await act(() => {
        root.render(
          <my-custom-element
            onChange={onChangeHandler}
            onInput={onInputHandler}
            onClick={onClickHandler}>
            <input />
          </my-custom-element>,
        );
      });

      const input = container.querySelector('input');
      setUntrackedValue.call(input, 'hello');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    // 由子 input 事件模拟的 onChange 会冒泡到父级自定义元素。
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      // 因此，原生的改变事件被忽略。
      input.dispatchEvent(new Event('change', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      input.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);
    });

    /** 给定自定义父级包裹 div，派 input/change/click；断言父级 input与click各一次而change为0，验证非表单普通目标不产生 React change。 */
    it('custom element onChange/onInput/onClick with event target div child', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const onChangeHandler = jest.fn();
      const onInputHandler = jest.fn();
      const onClickHandler = jest.fn();
      await act(() => {
        root.render(
          <my-custom-element
            onChange={onChangeHandler}
            onInput={onInputHandler}
            onClick={onClickHandler}>
            <div />
          </my-custom-element>,
        );
      });

      const div = container.querySelector('div');
      div.dispatchEvent(new Event('input', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);

      div.dispatchEvent(new Event('change', {bubbles: true}));
      // 始终忽略在非自定义和非输入目标上触发的变化事件。 因此,在 div 上发射的变化事件不会向上传播.
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);

      div.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);
    });

    /** 给定 div 父级包裹 div 子节点，派 input/change/click；断言 input与click各一次、change为0，验证普通非表单目标的 change 被忽略。 */
    it('div onChange/onInput/onClick with event target div child', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const onChangeHandler = jest.fn();
      const onInputHandler = jest.fn();
      const onClickHandler = jest.fn();
      await act(() => {
        root.render(
          <div
            onChange={onChangeHandler}
            onInput={onInputHandler}
            onClick={onClickHandler}>
            <div />
          </div>,
        );
      });

      const div = container.querySelector('div > div');
      div.dispatchEvent(new Event('input', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);

      div.dispatchEvent(new Event('change', {bubbles: true}));
      // 始终忽略在非自定义和非输入目标上触发的变化事件。 因此,在 div 上发射的变化事件不会向上传播.
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);

      div.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);
    });

    /** 给定自定义父子元素，向子元素派 input/change/click；断言父级依次接到各一次，验证自定义目标原生 change 冒泡而 input 不额外合成 change。 */
    it('custom element onChange/onInput/onClick with event target custom element child', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const onChangeHandler = jest.fn();
      const onInputHandler = jest.fn();
      const onClickHandler = jest.fn();
      await act(() => {
        root.render(
          <my-custom-element
            onChange={onChangeHandler}
            onInput={onInputHandler}
            onClick={onClickHandler}>
            <other-custom-element />
          </my-custom-element>,
        );
      });

      const customChild = container.querySelector('other-custom-element');
      customChild.dispatchEvent(new Event('input', {bubbles: true}));
      // 没有模拟的 onChange，只有 raw onInput 被触发。
      expect(onChangeHandler).toBeCalledTimes(0);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      // 原生改变事件会传播到父组件，触发 onChange。
      customChild.dispatchEvent(new Event('change', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(0);
      customChild.dispatchEvent(new Event('click', {bubbles: true}));
      expect(onChangeHandler).toBeCalledTimes(1);
      expect(onInputHandler).toBeCalledTimes(1);
      expect(onClickHandler).toBeCalledTimes(1);
    });

    /** 给定自定义元素同时注册捕获与冒泡 customevent，向其 div 子节点派不冒泡事件；断言捕获一次、冒泡零次，验证 Capture 后缀对应捕获监听。 */
    it('custom elements should allow custom events with capture event listeners', async () => {
      const oncustomeventCapture = jest.fn();
      const oncustomevent = jest.fn();

      /** 返回注册捕获和冒泡自定义事件监听的宿主父级及div子节点；子节点不冒泡事件仍可验证捕获。 */
      function Test() {
        return (
          <my-custom-element
            oncustomeventCapture={oncustomeventCapture}
            oncustomevent={oncustomevent}>
            <div />
          </my-custom-element>
        );
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test />);
      });
      container
        .querySelector('my-custom-element > div')
        .dispatchEvent(new Event('customevent', {bubbles: false}));
      expect(oncustomeventCapture).toHaveBeenCalledTimes(1);
      expect(oncustomevent).toHaveBeenCalledTimes(0);
    });

    /** 给定自定义元素 innerHTML=foo，更新为bar；两次均断言无 innerHTML attribute、无子节点，验证该保留 prop 不直接注入内容。 */
    it('innerHTML should not work on custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element innerHTML="foo" />);
      });
      const customElement = container.querySelector('my-custom-element');
      expect(customElement.getAttribute('innerHTML')).toBe(null);
      expect(customElement.hasChildNodes()).toBe(false);

    // 再次渲染，确认更新代码路径不会意外放过任何内容。
      await act(() => {
        root.render(<my-custom-element innerHTML="bar" />);
      });
      expect(customElement.getAttribute('innerHTML')).toBe(null);
      expect(customElement.hasChildNodes()).toBe(false);
    });

    /** 给定自定义元素 innerText=foo，更新为bar；两次均断言无该 attribute、无子节点，验证保留文本 prop 在挂载与更新均忽略。 */
    it('innerText should not work on custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element innerText="foo" />);
      });
      const customElement = container.querySelector('my-custom-element');
      expect(customElement.getAttribute('innerText')).toBe(null);
      expect(customElement.hasChildNodes()).toBe(false);

    // 再次渲染，确认更新代码路径不会意外放过任何内容。
      await act(() => {
        root.render(<my-custom-element innerText="bar" />);
      });
      expect(customElement.getAttribute('innerText')).toBe(null);
      expect(customElement.hasChildNodes()).toBe(false);
    });

    /** 给定自定义元素 textContent=foo，更新为bar；两次均断言无该 attribute、无子节点，验证文本内容需经 children 等受支持入口写入。 */
    it('textContent should not work on custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element textContent="foo" />);
      });
      const customElement = container.querySelector('my-custom-element');
      expect(customElement.getAttribute('textContent')).toBe(null);
      expect(customElement.hasChildNodes()).toBe(false);

    // 再次渲染，确认更新代码路径不会意外放过任何内容。
      await act(() => {
        root.render(<my-custom-element textContent="bar" />);
      });
      expect(customElement.getAttribute('textContent')).toBe(null);
      expect(customElement.hasChildNodes()).toBe(false);
    });

    /** 给定已有 foo property 的自定义元素，逐次传 true/false，再换字符串或null；断言 property 保留原值类型，验证 in 分支直接赋值而不转换为布尔。 */
    it('values should not be converted to booleans when assigning into custom elements', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element />);
      });
      const customElement = container.querySelector('my-custom-element');
      customElement.foo = null;

      // true => string
      await act(() => {
        root.render(<my-custom-element foo={true} />);
      });
      expect(customElement.foo).toBe(true);
      await act(() => {
        root.render(<my-custom-element foo="bar" />);
      });
      expect(customElement.foo).toBe('bar');

      // false => string
      await act(() => {
        root.render(<my-custom-element foo={false} />);
      });
      expect(customElement.foo).toBe(false);
      await act(() => {
        root.render(<my-custom-element foo="bar" />);
      });
      expect(customElement.foo).toBe('bar');

      // true => null
      await act(() => {
        root.render(<my-custom-element foo={true} />);
      });
      expect(customElement.foo).toBe(true);
      await act(() => {
        root.render(<my-custom-element foo={null} />);
      });
      expect(customElement.foo).toBe(null);

      // false => null
      await act(() => {
        root.render(<my-custom-element foo={false} />);
      });
      expect(customElement.foo).toBe(false);
      await act(() => {
        root.render(<my-custom-element foo={null} />);
      });
      expect(customElement.foo).toBe(null);
    });

    /** 给定未定义 foo property 的自定义元素，传 true再false；断言 attribute 为存在空串再缺失，验证布尔 attribute 不写 true/false 字符串。 */
    it('boolean props should not be stringified in attributes', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element foo={true} />);
      });
      const customElement = container.querySelector('my-custom-element');

      expect(customElement.getAttribute('foo')).toBe('');

      // true => false
      await act(() => {
        root.render(<my-custom-element foo={false} />);
      });

      expect(customElement.getAttribute('foo')).toBe(null);
    });

    /** 给定无同名 property 的自定义元素，oncustomevent 在字符串、函数、缺失之间切换；断言字符串 attribute 随切换清除/恢复、监听累计0→1→1→1→2且property始终未定义，验证函数监听与attribute互斥。 */
    it('custom element custom event handlers assign multiple types', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const oncustomevent = jest.fn();

      // 首次渲染时传入字符串。
      await act(() => {
        root.render(<my-custom-element oncustomevent={'foo'} />);
      });
      const customelement = container.querySelector('my-custom-element');
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(0);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe('foo');

      // 字符串值 → 事件监听器。
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // 事件监听器 → 字符串值。
      await act(() => {
        root.render(<my-custom-element oncustomevent={'foo'} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe('foo');

      // 字符串值 → 移除该属性。
      await act(() => {
        root.render(<my-custom-element />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // 未设置值 → 事件监听器。
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);
    });

    /** 给定 oncustomevent 的实例访问器，监听在函数、字符串、函数、缺失间切换；断言property为null、foo、null、undefined，attribute始终缺失，监听次数1→1→2→2，验证已有property时的值与监听清理。 */
    it('custom element custom event handlers assign multiple types with setter', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const oncustomevent = jest.fn();

      // 首次渲染时不传入任何内容。
      await act(() => {
        root.render(<my-custom-element />);
      });
      const customelement = container.querySelector('my-custom-element');
      // 安装一个设置器以激活 `in` 策略
      Object.defineProperty(customelement, 'oncustomevent', {

        /** 把赋入值x保存到实例_oncustomevent；访问器使属性存在性检查走property路径，同时记录React清理监听时写入的null/undefined。 */
        set: function (x) {
          this._oncustomevent = x;
        },

        /** 返回实例保存的_oncustomevent，供测试区分原生监听安装与property赋值结果。 */
        get: function () {
          return this._oncustomevent;
        },
      });
      expect(customelement.oncustomevent).toBe(undefined);

      // 未设置值 → 事件监听器。
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(null);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // 事件监听器 → 字符串值。
      await act(() => {
        root.render(<my-custom-element oncustomevent={'foo'} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe('foo');
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // 字符串值 → 事件监听器。
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(customelement.oncustomevent).toBe(null);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // 事件监听器 → 移除该属性。
      await act(() => {
        root.render(<my-custom-element />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);
    });

    /** 给定 foo=one attribute，随后添加 foo 访问器并更新为two；断言property为two而attribute仍one，验证已有property赋值不会删除旧attribute。 */
    it('assigning to a custom element property should not remove attributes', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element foo="one" />);
      });
      const customElement = container.querySelector('my-custom-element');
      expect(customElement.getAttribute('foo')).toBe('one');

      // 安装一个设置器以激活 `in` 策略
      Object.defineProperty(customElement, 'foo', {

        /** 将foo更新值x保存到_foo，激活已有property的赋值路径，便于与之前attribute的one比较。 */
        set: function (x) {
          this._foo = x;
        },

        /** 返回_foo，观察property更新为two时原attribute是否仍保留one。 */
        get: function () {
          return this._foo;
        },
      });
      await act(() => {
        root.render(<my-custom-element foo="two" />);
      });
      expect(customElement.foo).toBe('two');
      expect(customElement.getAttribute('foo')).toBe('one');
    });

    /** 给定 foo 访问器，把函数作为foo，再删除并重加；断言保留函数身份、删除时undefined、重加恢复，验证非事件property允许函数值。 */
    it('custom element properties should accept functions', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element />);
      });
      const customElement = container.querySelector('my-custom-element');

      // 安装一个设置器以激活 `in` 策略
      Object.defineProperty(customElement, 'foo', {

        /** 保存foo的原始值x到_foo；此访问器用于证明普通自定义property可以接收函数对象。 */
        set: function (x) {
          this._foo = x;
        },

        /** 返回_foo，不调用其中函数，供身份断言检查函数传递与删除后的undefined。 */
        get: function () {
          return this._foo;
        },
      });

      /** 返回固定字符串的函数值夹具；用作foo的对象身份，测试不会通过调用结果代替身份检查。 */
      function myFunction() {
        return 'this is myFunction';
      }
      await act(() => {
        root.render(<my-custom-element foo={myFunction} />);
      });
      expect(customElement.foo).toBe(myFunction);

      // 为稳妥起见，也移除并重新添加该 property。
      await act(() => {
        root.render(<my-custom-element />);
      });
      expect(customElement.foo).toBe(undefined);
      await act(() => {
        root.render(<my-custom-element foo={myFunction} />);
      });
      expect(customElement.foo).toBe(myFunction);
    });

    /** 给定已存在foo property且值undefined，更新为null再undefined；断言两种空值分别原样赋入，验证相邻更新不会把null与undefined合并。 */
    it('switching between null and undefined should update a property', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element foo={undefined} />);
      });
      const customElement = container.querySelector('my-custom-element');
      customElement.foo = undefined;

      await act(() => {
        root.render(<my-custom-element foo={null} />);
      });
      expect(customElement.foo).toBe(null);

      await act(() => {
        root.render(<my-custom-element foo={undefined} />);
      });
      expect(customElement.foo).toBe(undefined);
    });

    /** 给定 DOM元素作为popoverTarget，先挂载再换key重挂；断言DEV要求字符串ID并只产生首条警告，验证类型诊断去重。 */
    it('warns when using popoverTarget={HTMLElement}', async () => {
      const popoverTarget = document.createElement('div');
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <button key="one" popoverTarget={popoverTarget}>
            Toggle popover
          </button>,
        );
      });

      assertConsoleErrorDev([
        'The `popoverTarget` prop expects the ID of an Element as a string. Received HTMLDivElement {} instead.\n' +
          '    in button (at **)',
      ]);

      // 对警告去重。
      await act(() => {
        root.render(
          <button key="two" popoverTarget={popoverTarget}>
            Toggle popover
          </button>,
        );
      });
    });
  });

  describe('deleteValueForProperty', () => {

    /** 给定title=foo的div，后续render删除title prop；断言attribute由foo变null，验证普通属性移除。 */
    it('should remove attributes for normal properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div title="foo" />);
      });
      expect(container.firstChild.getAttribute('title')).toBe('foo');
      await act(() => {
        root.render(<div />);
      });
      expect(container.firstChild.getAttribute('title')).toBe(null);
    });

    /** 给定受控input value=foo，删除value prop；断言受控转非受控警告，value仍foo且attribute遵循同步开关保留或缺失，验证input删除路径保留当前值。 */
    it('should not remove attributes for special properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <input type="text" value="foo" onChange={function () {}} />,
        );
      });
      if (disableInputAttributeSyncing) {
        expect(container.firstChild.hasAttribute('value')).toBe(false);
      } else {
        expect(container.firstChild.getAttribute('value')).toBe('foo');
      }
      expect(container.firstChild.value).toBe('foo');
      await act(() => {
        root.render(<input type="text" onChange={function () {}} />);
      });
      assertConsoleErrorDev([
        'A component is changing a controlled input to be uncontrolled. ' +
          'This is likely caused by the value changing from a defined to undefined, ' +
          'which should not happen. Decide between using a controlled or uncontrolled ' +
          'input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)',
      ]);
      if (disableInputAttributeSyncing) {
        expect(container.firstChild.hasAttribute('value')).toBe(false);
      } else {
        expect(container.firstChild.getAttribute('value')).toBe('foo');
      }
      expect(container.firstChild.value).toBe('foo');
    });

    /** 给定空根，只挂载my-icon size=5px；断言size attribute为5px，验证自定义标签接受该属性；此例没有执行删除，标题不构成删除语义证据。 */
    it('should not remove attributes for custom component tag', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-icon size="5px" />);
      });
      expect(container.firstChild.getAttribute('size')).toBe('5px');
    });

    /** 给定raw property与带默认参数的object/string访问器，挂载2/对象/hi后删props；断言初值身份保留，删除后raw=undefined、object=null、string空串，验证undefined触发访问器默认值。 */
    it('custom elements should remove by setting undefined to restore defaults', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-custom-element />);
      });
      const customElement = container.querySelector('my-custom-element');

    // 使用一个已存在但没有 setter 的 property，以启用 `in` 启发式判断。
      customElement.raw = 1;

      // 安装一个设置器以激活 `in` 策略
      Object.defineProperty(customElement, 'object', {

        /** 保存object属性值；省略或赋undefined时默认参数转为null，用于验证删除prop的重置契约。 */
        set: function (value = null) {
          this._object = value;
        },

        /** 返回_object，使测试观察删除prop后访问器默认值null。 */
        get: function () {
          return this._object;
        },
      });

      Object.defineProperty(customElement, 'string', {

        /** 保存string属性值；赋undefined时默认参数为空串，模拟自定义元素的默认文本值。 */
        set: function (value = '') {
          this._string = value;
        },

        /** 返回_string，使测试核对移除prop后的空串默认值。 */
        get: function () {
          return this._string;
        },
      });

      const obj = {};
      await act(() => {
        root.render(<my-custom-element raw={2} object={obj} string="hi" />);
      });
      expect(customElement.raw).toBe(2);
      expect(customElement.object).toBe(obj);
      expect(customElement.string).toBe('hi');

      // 移除属性应重置为默认值，通过传递 undefined。
      await act(() => {
        root.render(<my-custom-element />);
      });
      expect(customElement.raw).toBe(undefined);
      expect(customElement.object).toBe(null);
      expect(customElement.string).toBe('');
    });
  });
});
