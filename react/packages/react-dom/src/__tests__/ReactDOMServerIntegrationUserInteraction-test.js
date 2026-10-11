/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 加载三客户端模式与服务端/水合工具，对照挂载后输入与水合前输入。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** 重置React/两DOM入口和诊断缓存，返回helper当前模块实例。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  // 返回当前DOM入口供helper渲染与模块重置使用。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 获取三客户端模式包装和显式serverRender/renderIntoDom，后者第三参数true执行水合。 */
const {resetModules, itClientRenders, renderIntoDom, serverRender} =
  ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegrationUserInteraction', () => {
  let ControlledInput, ControlledTextArea, ControlledCheckbox, ControlledSelect;

  beforeEach(() => {
    resetModules();
    /** 受控input类，state跟随用户value并可在挂载期级联更新。 */
    ControlledInput = class extends React.Component {

      /** 缺省type=text、初始Hello；range case显式覆盖type/initialValue。 */
      static defaultProps = {
        type: 'text',
        initialValue: 'Hello',
      };

      /** 以当前props.initialValue初始化受控value，保持text/range起点差异。 */
      constructor() {
        super(...arguments);
        this.state = {value: this.props.initialValue};
      }

      /** 先通知外部onChange计数，再从事件目标value写本地state。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.value});
      }

      /** cascade时挂载后setState增加字段，不直接改value，测试用户输入同步后再render。 */
      componentDidMount() {
        if (this.props.cascade) {
    // hydration 一开始就触发 cascading render，从而重新渲染 input。
          this.setState({cascade: true});
        }
      }

      /** 以state.value控制input，绑定handleChange保存实例this。 */
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
    /** 受控textarea类，初Hello并可在水合挂载期级联。 */
    ControlledTextArea = class extends React.Component {

      /** 初始化value=Hello；本fixture不从props取初值。 */
      constructor() {
        super();
        this.state = {value: 'Hello'};
      }

      /** 先调用外部回调，再用target.value更新textarea状态。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.value});
      }

      /** cascade时触发额外提交，检查水合前用户文字是否仍保留。 */
      componentDidMount() {
        if (this.props.cascade) {
          // 立即在hydrate后触发递归渲染，这将重新渲染textarea。
          this.setState({cascade: true});
        }
      }

      /** 以state.value控制textarea并绑定change处理器。 */
      render() {
        return (
          <textarea
            value={this.state.value}
            onChange={this.handleChange.bind(this)}
          />
        );
      }
    };
    /** 受控checkbox类，用state.value作为checked而非文本value。 */
    ControlledCheckbox = class extends React.Component {

      /** 初始化checked状态true，水合前测试手动改false。 */
      constructor() {
        super();
        this.state = {value: true};
      }

      /** 先外部计数，再读取target.checked更新布尔state。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.checked});
      }

      /** cascade时只加状态字段触发再次render，检验checked保持。 */
      componentDidMount() {
        if (this.props.cascade) {
          // 立即在hydrate后触发递归渲染，重新渲染复选框。
          this.setState({cascade: true});
        }
      }

      /** 固定type=checkbox并绑定受控checked/change。 */
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
    /** 受控select类，提供Hello/Goodbye两个明确option值。 */
    ControlledSelect = class extends React.Component {

      /** 初始化选中Hello，用于原生change和预水合选择。 */
      constructor() {
        super();
        this.state = {value: 'Hello'};
      }

      /** 外部change计数后从target.value更新选择状态。 */
      handleChange(event) {
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        this.setState({value: event.target.value});
      }

      /** cascade触发额外render，不直接改选择value。 */
      componentDidMount() {
        if (this.props.cascade) {
          // 立即在hydrate后触发递归渲染，重新渲染select。
          this.setState({cascade: true});
        }
      }

      /** state.value控制两option select，验证用户选择能同步回state。 */
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
    /** 三种客户端模式挂受控text input初Hello，绕过实例value tracker用原型setter改Goodbye后派input；change一次且值Goodbye，验证真实用户值变化检测与受控state更新。 */
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

    /** 三客户端模式受控textarea初Hello，原型setter改Goodbye再input；change一次且值保留，验证textarea追踪变化。 */
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

    /** 三客户端模式受控checkbox初checked=true，原生click翻转；change一次且false，验证checkbox使用checked与click提取。 */
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

    /** 三客户端模式select初Hello，原型setter选Goodbye再change；change一次且新值保留，验证选择事件写受控state。 */
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
    // 先SSR并改字段值，再以renderIntoDom的hydrate模式认领，模拟水合开始前用户已编辑字段。

    /** 先SSR取得字段并校验initialValue，再直接改valueKey模拟用户操作；重置模块后在原parent以hydrate模式认领，断言同一字段身份及changedValue保留。valueKey默认value，checkbox改checked；不派原生事件。 */
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

    /** SSR非受控text input defaultValue=Hello，水合前属性值改Goodbye；helper确认同DOM节点且Goodbye保留，验证认领不抹用户预先输入。 */
    it('should not blow away user-entered text on successful reconnect to an uncontrolled input', () =>
      testUserInteractionBeforeClientRender(<input defaultValue="Hello" />));

    /** SSR受控input初Hello，水合前Goodbye；身份/值保留，HydrationChangeEvent开时change一次、关时0，验证预水合输入的事件同步分支。 */
    it('should not blow away user-entered text on successful reconnect to a controlled input', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledInput onChange={() => changeCount++} />,
      );
      expect(changeCount).toBe(
        gate(flags => flags.enableHydrationChangeEvent) ? 1 : 0,
      );
    });

    /** 旧标题range但实际input.type=text，SSR defaultValue=.5改1后水合；身份和值1保留，验证文本数字字符串输入，不能当range类型覆盖。 */
    it('should not blow away user-interaction on successful reconnect to an uncontrolled range input', () =>
      testUserInteractionBeforeClientRender(
        <input type="text" defaultValue="0.5" />,
        '0.5',
        '1',
      ));

    /** 受控range初.25水合前改1；身份/值1保持，hydration change开为1关为0，验证range用户变化。 */
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

    /** 非受控checkbox defaultChecked=true水合前checked=false；helper确认节点和值保持，验证checked与value分开的认领路径。 */
    it('should not blow away user-entered text on successful reconnect to an uncontrolled checkbox', () =>
      testUserInteractionBeforeClientRender(
        <input type="checkbox" defaultChecked={true} />,
        true,
        false,
        'checked',
      ));

    /** 受控checkbox初true水合前false；节点与false保留，change次数按开关1/0，验证checked变化的水合事件。 */
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

    /** 仅HydrationChangeEvent开启时执行：非受控textarea Hello水合前Goodbye，认领保持身份和用户文字，验证textarea预输入保留。 */
    it('should not blow away user-entered text on successful reconnect to an uncontrolled textarea', () =>
      testUserInteractionBeforeClientRender(<textarea defaultValue="Hello" />));

    // @gate enableHydrationChangeEvent

    /** 仅HydrationChangeEvent开启时：受控textarea Hello预先Goodbye，认领保持值且change一次，验证状态通过水合变化事件同步。 */
    it('should not blow away user-entered text on successful reconnect to a controlled textarea', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledTextArea onChange={() => changeCount++} />,
      );
      expect(changeCount).toBe(1);
    });

    /** 非受控select默认Hello、水合前选Goodbye；节点与选择值保持，验证select认领不重置用户选择。 */
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

    /** 受控select初Hello预先选Goodbye；节点和值保持，change按开关1/0，验证选择状态水合变化事件。 */
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

    /** 仅HydrationChangeEvent开启：受控input预先Goodbye且componentDidMount触发cascade更新；同节点和值仍Goodbye且change一次，验证挂载级联不冲掉用户输入。 */
    it('should not blow away user-entered text cascading hydration to a controlled input', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledInput onChange={() => changeCount++} cascade={true} />,
      );
      expect(changeCount).toBe(1);
    });

    // @gate enableHydrationChangeEvent

    /** 仅HydrationChangeEvent开启：受控range .25预先1且挂载级联；身份和值1保持、change一次，验证range级联水合。 */
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

    /** 仅HydrationChangeEvent开启：受控checkbox预先false且挂载级联；身份和false保持、change一次，验证checked级联水合。 */
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

    /** 仅HydrationChangeEvent开启：受控textarea预先Goodbye且挂载级联；身份/文字保持且change一次，验证textarea级联水合。 */
    it('should not blow away user-entered text cascading hydration to a controlled textarea', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledTextArea onChange={() => changeCount++} cascade={true} />,
      );
      expect(changeCount).toBe(1);
    });

    // @gate enableHydrationChangeEvent

    /** 仅HydrationChangeEvent开启：受控select预选Goodbye且挂载级联；身份/选择保持且change一次，验证select级联水合。 */
    it('should not blow away user-selected value cascading hydration to an controlled select', async () => {
      let changeCount = 0;
      await testUserInteractionBeforeClientRender(
        <ControlledSelect onChange={() => changeCount++} cascade={true} />,
      );
      expect(changeCount).toBe(1);
    });
  });
});
