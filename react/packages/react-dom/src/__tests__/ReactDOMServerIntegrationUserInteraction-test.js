/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{resetModules, itClientRenders, renderIntoDom, serverRender}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itClientRenders, renderIntoDom, serverRender} =
  ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegrationUserInteraction', () => {
  let ControlledInput, ControlledTextArea, ControlledCheckbox, ControlledSelect;

  beforeEach(() => {
    resetModules();
    ControlledInput = class extends React.Component {
      /** `defaultProps`：记录测试夹具在当前场景中的状态。 */
      static defaultProps = {
        type: 'text',
        initialValue: 'Hello',
      };
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor() {
        super(...arguments);
        this.state = {value: this.props.initialValue};
      }
      /** `handleChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.value});
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        if (this.props.cascade) {
    // hydration 一开始就触发 cascading render，从而重新渲染 input。
          this.setState({cascade: true});
        }
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <input
            type={this.props.type}
            value={this.state.value}
            onChange={this.handleChange.bind(this)}
          />
        );
      }
    };
    ControlledTextArea = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor() {
        super();
        this.state = {value: 'Hello'};
      }
      /** `handleChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.value});
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        if (this.props.cascade) {
          // 立即在hydrate后触发递归渲染，这将重新渲染textarea。
          this.setState({cascade: true});
        }
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <textarea
            value={this.state.value}
            onChange={this.handleChange.bind(this)}
          />
        );
      }
    };
    ControlledCheckbox = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor() {
        super();
        this.state = {value: true};
      }
      /** `handleChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.checked});
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        if (this.props.cascade) {
          // 立即在hydrate后触发递归渲染，重新渲染复选框。
          this.setState({cascade: true});
        }
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <input
            type="checkbox"
            checked={this.state.value}
            onChange={this.handleChange.bind(this)}
          />
        );
      }
    };
    ControlledSelect = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor() {
        super();
        this.state = {value: 'Hello'};
      }
      /** `handleChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.value});
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        if (this.props.cascade) {
          // 立即在hydrate后触发递归渲染，重新渲染select。
          this.setState({cascade: true});
        }
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <select
            value={this.state.value}
            onChange={this.handleChange.bind(this)}>
            <option key="1" value="Hello">
              Hello
            </option>
            <option key="2" value="Goodbye">
              Goodbye
            </option>
          </select>
        );
      }
    };
  });

  describe('user interaction with controlled inputs', function () {
    itClientRenders('a controlled text input', async render => {
      const setUntrackedValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set;

      let changeCount = 0;
      const e = await render(
        <ControlledInput onChange={() => changeCount++} />,
      );
      const container = e.parentNode;
      document.body.appendChild(container);

      try {
        expect(changeCount).toBe(0);
        expect(e.value).toBe('Hello');

        // 模拟用户输入。
        setUntrackedValue.call(e, 'Goodbye');
        e.dispatchEvent(new Event('input', {bubbles: true, cancelable: false}));

        expect(changeCount).toBe(1);
        expect(e.value).toBe('Goodbye');
      } finally {
        document.body.removeChild(container);
      }
    });

    itClientRenders('a controlled textarea', async render => {
      const setUntrackedValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      ).set;

      let changeCount = 0;
      const e = await render(
        <ControlledTextArea onChange={() => changeCount++} />,
      );
      const container = e.parentNode;
      document.body.appendChild(container);

      try {
        expect(changeCount).toBe(0);
        expect(e.value).toBe('Hello');

        // 模拟用户输入。
        setUntrackedValue.call(e, 'Goodbye');
        e.dispatchEvent(new Event('input', {bubbles: true, cancelable: false}));

        expect(changeCount).toBe(1);
        expect(e.value).toBe('Goodbye');
      } finally {
        document.body.removeChild(container);
      }
    });

    itClientRenders('a controlled checkbox', async render => {
      let changeCount = 0;
      const e = await render(
        <ControlledCheckbox onChange={() => changeCount++} />,
      );
      const container = e.parentNode;
      document.body.appendChild(container);

      try {
        expect(changeCount).toBe(0);
        expect(e.checked).toBe(true);

        // 模拟用户点击。
        e.click();

        expect(changeCount).toBe(1);
        expect(e.checked).toBe(false);
      } finally {
        document.body.removeChild(container);
      }
    });

    itClientRenders('a controlled select', async render => {
      const setUntrackedValue = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set;

      let changeCount = 0;
      const e = await render(
        <ControlledSelect onChange={() => changeCount++} />,
      );
      const container = e.parentNode;
      document.body.appendChild(container);

      try {
        expect(changeCount).toBe(0);
        expect(e.value).toBe('Hello');

        // 模拟用户输入。
        setUntrackedValue.call(e, 'Goodbye');
        e.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: false}),
        );

        expect(changeCount).toBe(1);
        expect(e.value).toBe('Goodbye');
      } finally {
        document.body.removeChild(container);
      }
    });
  });

  describe('user interaction with inputs before client render', function () {
    // 渲染元素，并在客户端代码开始渲染前修改其值，以模拟用户在 ReactDOM.render 调用前就与服务端
    // 渲染的表单交互；客户端渲染不得覆盖用户已经做出的修改。
    /** `testUserInteractionBeforeClientRender`：封装当前用例复用的操作、回调或断言步骤。 */
    const testUserInteractionBeforeClientRender = async (
      element,
      initialValue = 'Hello',
      changedValue = 'Goodbye',
      valueKey = 'value',
    ) => {
      const field = await serverRender(element);
      expect(field[valueKey]).toBe(initialValue);

      // 模拟用户在字段中输入数据，以便在客户端重连之前发生。
      field[valueKey] = changedValue;

      resetModules();
      // 在服务器渲染之上进行客户端渲染。
      const clientField = await renderIntoDom(element, field.parentNode, true);
      // 确保输入字段未被替换。 请注意，我们无法使用 expect(clientField).toBe(field)，因为存在 jest
      // 问题 #1772。
      expect(clientField === field).toBe(true);
      // 确保客户端渲染没有改变用户输入的内容。
      expect(clientField[valueKey]).toBe(changedValue);
    };

    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should not blow away user-entered text on successful reconnect to an uncontrolled input」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it('should not blow away user-entered text on successful reconnect to an uncontrolled input', () =>
      testUserInteractionBeforeClientRender(<input defaultValue="Hello" />));

    /** 测试场景：验证「should not blow away user-entered text on successful reconnect to a controlled input」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text on successful reconnect to a controlled input', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledInput onChange={() => changeCount++} />,
      );
      expect(changeCount).toBe(
        gate(flags => flags.enableHydrationChangeEvent) ? 1 : 0,
      );
    });

    /** 测试场景：验证「should not blow away user-interaction on successful reconnect to an uncontrolled range input」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-interaction on successful reconnect to an uncontrolled range input', () =>
      testUserInteractionBeforeClientRender(
        <input type="text" defaultValue="0.5" />,
        '0.5',
        '1',
      ));

    /** 测试场景：验证「should not blow away user-interaction on successful reconnect to a controlled range input」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-interaction on successful reconnect to a controlled range input', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledInput
          type="range"
          initialValue="0.25"
          onChange={() => changeCount++}
        />,
        '0.25',
        '1',
      );
      expect(changeCount).toBe(
        gate(flags => flags.enableHydrationChangeEvent) ? 1 : 0,
      );
    });

    /** 测试场景：验证「should not blow away user-entered text on successful reconnect to an uncontrolled checkbox」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text on successful reconnect to an uncontrolled checkbox', () =>
      testUserInteractionBeforeClientRender(
        <input type="checkbox" defaultChecked={true} />,
        true,
        false,
        'checked',
      ));

    /** 测试场景：验证「should not blow away user-entered text on successful reconnect to a controlled checkbox」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text on successful reconnect to a controlled checkbox', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledCheckbox onChange={() => changeCount++} />,
        true,
        false,
        'checked',
      );
      expect(changeCount).toBe(
        gate(flags => flags.enableHydrationChangeEvent) ? 1 : 0,
      );
    });

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-entered text on successful reconnect to an uncontrolled textarea」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text on successful reconnect to an uncontrolled textarea', () =>
      testUserInteractionBeforeClientRender(<textarea defaultValue="Hello" />));

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-entered text on successful reconnect to a controlled textarea」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text on successful reconnect to a controlled textarea', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledTextArea onChange={() => changeCount++} />,
      );
      expect(changeCount).toBe(1);
    });

    /** 测试场景：验证「should not blow away user-selected value on successful reconnect to an uncontrolled select」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-selected value on successful reconnect to an uncontrolled select', () =>
      testUserInteractionBeforeClientRender(
        <select defaultValue="Hello">
          <option key="1" value="Hello">
            Hello
          </option>
          <option key="2" value="Goodbye">
            Goodbye
          </option>
        </select>,
      ));

    /** 测试场景：验证「should not blow away user-selected value on successful reconnect to an controlled select」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-selected value on successful reconnect to an controlled select', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledSelect onChange={() => changeCount++} />,
      );
      expect(changeCount).toBe(
        gate(flags => flags.enableHydrationChangeEvent) ? 1 : 0,
      );
    });

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-entered text cascading hydration to a controlled input」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text cascading hydration to a controlled input', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledInput onChange={() => changeCount++} cascade={true} />,
      );
      expect(changeCount).toBe(1);
    });

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-interaction cascading hydration to a controlled range input」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-interaction cascading hydration to a controlled range input', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledInput
          type="range"
          initialValue="0.25"
          onChange={() => changeCount++}
          cascade={true}
        />,
        '0.25',
        '1',
      );
      expect(changeCount).toBe(1);
    });

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-entered text cascading hydration to a controlled checkbox」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text cascading hydration to a controlled checkbox', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledCheckbox onChange={() => changeCount++} cascade={true} />,
        true,
        false,
        'checked',
      );
      expect(changeCount).toBe(1);
    });

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-entered text cascading hydration to a controlled textarea」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-entered text cascading hydration to a controlled textarea', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledTextArea onChange={() => changeCount++} cascade={true} />,
      );
      expect(changeCount).toBe(1);
    });

    // @gate enableHydrationChangeEvent
    /** 测试场景：验证「should not blow away user-selected value cascading hydration to an controlled select」描述的渲染、交互或错误处理结果。 */
    it('should not blow away user-selected value cascading hydration to an controlled select', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledSelect onChange={() => changeCount++} cascade={true} />,
      );
      expect(changeCount).toBe(1);
    });
  });
});
