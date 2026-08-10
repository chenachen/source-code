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
  const setUntrackedValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  const setUntrackedChecked = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'checked',
  ).set;

  describe('setValueForProperty', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should set values as properties by default」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 DOM host 属性写入与提交路径。
     */
    it('should set values as properties by default', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div title="Tip!" />);
      });
      expect(container.firstChild.title).toBe('Tip!');
    });

    /** 测试场景：验证「should set values as attributes if necessary」描述的渲染、交互或错误处理结果。 */
    it('should set values as attributes if necessary', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div role="#" />);
      });
      expect(container.firstChild.getAttribute('role')).toBe('#');
      expect(container.firstChild.role).toBeUndefined();
    });

    /** 测试场景：验证「should set values as namespace attributes if necessary」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should set values as boolean properties」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should convert attribute values to string first」描述的渲染、交互或错误处理结果。 */
    it('should convert attribute values to string first', async () => {
      // 浏览器默认采用这种行为。 但是某些测试环境并不支持。 这确保了我们有可预测的行为。
      const obj = {
        /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「should not remove empty attributes for special input properties」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should not remove empty attributes for special option properties」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should remove for falsey boolean properties」描述的渲染、交互或错误处理结果。 */
    it('should remove for falsey boolean properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div allowFullScreen={false} />);
      });
      expect(container.firstChild.hasAttribute('allowFullScreen')).toBe(false);
    });

    /** 测试场景：验证「should set credentialless boolean attribute on iframes」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should set credentialless attribute when passed a string and warn」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should remove when setting custom attr to null」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should set className to empty string instead of null」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should remove property properly for boolean properties」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should always assign the value attribute for non-inputs」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should return the progress to intermediate state on null value」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom element custom events lowercase」描述的渲染、交互或错误处理结果。 */
    it('custom element custom events lowercase', async () => {
      const oncustomevent = jest.fn();
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom element custom events uppercase」描述的渲染、交互或错误处理结果。 */
    it('custom element custom events uppercase', async () => {
      const oncustomevent = jest.fn();
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom element custom event with dash in name」描述的渲染、交互或错误处理结果。 */
    it('custom element custom event with dash in name', async () => {
      const oncustomevent = jest.fn();
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom element remove event handler」描述的渲染、交互或错误处理结果。 */
    it('custom element remove event handler', async () => {
      const oncustomevent = jest.fn();
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom elements shouldnt have non-functions for on* attributes treated as event listeners」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom elements should still have onClick treated like regular elements」描述的渲染、交互或错误处理结果。 */
    it('custom elements should still have onClick treated like regular elements', async () => {
      let syntheticClickEvent = null;
      const syntheticEventHandler = jest.fn(
        event => (syntheticClickEvent = event),
      );
      let nativeClickEvent = null;
      const nativeEventHandler = jest.fn(event => (nativeClickEvent = event));
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom elements should have working onChange event listeners」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom elements should have working onInput event listeners」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom elements should have separate onInput and onChange handling」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom elements should be able to remove and re-add custom event listeners」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「<input is=...> should have the same onChange/onInput/onClick behavior as <input>」描述的渲染、交互或错误处理结果。 */
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
      /** `clearMocks`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「<input type=radio is=...> should have the same onChange/onInput/onClick behavior as <input type=radio>」描述的渲染、交互或错误处理结果。 */
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
      /** `clearMocks`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「<select is=...> should have the same onChange/onInput/onClick behavior as <select>」描述的渲染、交互或错误处理结果。 */
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
      /** `clearMocks`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「onChange/onInput/onClick on div with various types of children」描述的渲染、交互或错误处理结果。 */
    it('onChange/onInput/onClick on div with various types of children', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const onChangeHandler = jest.fn();
      const onInputHandler = jest.fn();
      const onClickHandler = jest.fn();
      /** `clearMocks`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom element onChange/onInput/onClick with event target input child」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom element onChange/onInput/onClick with event target div child」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「div onChange/onInput/onClick with event target div child」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom element onChange/onInput/onClick with event target custom element child」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom elements should allow custom events with capture event listeners」描述的渲染、交互或错误处理结果。 */
    it('custom elements should allow custom events with capture event listeners', async () => {
      const oncustomeventCapture = jest.fn();
      const oncustomevent = jest.fn();
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「innerHTML should not work on custom elements」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「innerText should not work on custom elements」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「textContent should not work on custom elements」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「values should not be converted to booleans when assigning into custom elements」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「boolean props should not be stringified in attributes」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「custom element custom event handlers assign multiple types」描述的渲染、交互或错误处理结果。 */
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

      // string => event listener
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // event listener => string
      await act(() => {
        root.render(<my-custom-element oncustomevent={'foo'} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe('foo');

      // string => nothing
      await act(() => {
        root.render(<my-custom-element />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // nothing => event listener
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);
    });

    /** 测试场景：验证「custom element custom event handlers assign multiple types with setter」描述的渲染、交互或错误处理结果。 */
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
        /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
        set: function (x) {
          this._oncustomevent = x;
        },
        /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
        get: function () {
          return this._oncustomevent;
        },
      });
      expect(customelement.oncustomevent).toBe(undefined);

      // nothing => event listener
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe(null);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // event listener => string
      await act(() => {
        root.render(<my-custom-element oncustomevent={'foo'} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(1);
      expect(customelement.oncustomevent).toBe('foo');
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // string => event listener
      await act(() => {
        root.render(<my-custom-element oncustomevent={oncustomevent} />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(customelement.oncustomevent).toBe(null);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);

      // event listener => nothing
      await act(() => {
        root.render(<my-custom-element />);
      });
      customelement.dispatchEvent(new Event('customevent'));
      expect(oncustomevent).toHaveBeenCalledTimes(2);
      expect(customelement.oncustomevent).toBe(undefined);
      expect(customelement.getAttribute('oncustomevent')).toBe(null);
    });

    /** 测试场景：验证「assigning to a custom element property should not remove attributes」描述的渲染、交互或错误处理结果。 */
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
        /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
        set: function (x) {
          this._foo = x;
        },
        /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「custom element properties should accept functions」描述的渲染、交互或错误处理结果。 */
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
        /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
        set: function (x) {
          this._foo = x;
        },
        /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
        get: function () {
          return this._foo;
        },
      });
      /** `myFunction`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「switching between null and undefined should update a property」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「warns when using popoverTarget={HTMLElement}」描述的渲染、交互或错误处理结果。 */
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
    /** 测试场景：验证「should remove attributes for normal properties」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should not remove attributes for special properties」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「should not remove attributes for custom component tag」描述的渲染、交互或错误处理结果。 */
    it('should not remove attributes for custom component tag', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<my-icon size="5px" />);
      });
      expect(container.firstChild.getAttribute('size')).toBe('5px');
    });

    /** 测试场景：验证「custom elements should remove by setting undefined to restore defaults」描述的渲染、交互或错误处理结果。 */
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
        /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
        set: function (value = null) {
          this._object = value;
        },
        /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
        get: function () {
          return this._object;
        },
      });

      Object.defineProperty(customElement, 'string', {
        /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
        set: function (value = '') {
          this._string = value;
        },
        /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
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
