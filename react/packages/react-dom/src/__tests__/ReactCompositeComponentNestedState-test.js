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

describe('ReactCompositeComponentNestedState-state', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  /** 父 color 初始 blue、子 hue 初始 dark blue；点击 Light Green 同时安排父 color 与子函数式 state 更新。日志中 updater 的 this.props 仍是 blue，但参数 props 已是 green，渲染及提交回调看到 light green/green，验证按父子更新顺序传给 updater 的最新 props。 */
  it('should provide up to date values for props', async () => {
    /** 持有颜色并把它作为子组件 prop，下游点击同时触发父颜色和子 hue 更新。 */
    class ParentComponent extends React.Component {
      /** color 初始 blue；选色事件改为 green，为子 updater 最新 props 与实例旧 props 的差异提供输入。 */
      state = {color: 'blue'};

      /** 记录更新前的父 state、安排颜色更新，并在提交回调记录最终颜色。 */
      handleColor = color => {
        this.props.logger('parent-handleColor', this.state.color);
        // 提交回调读取已安装的父 state；它发生在子更新的渲染与 effect 回调之后。
        this.setState({color: color}, function () {
          this.props.logger('parent-after-setState', this.state.color);
        });
      };

      /** 记录当前父颜色并传给 ChildComponent，让父更新先决定子函数式 updater 的参数 props。 */
      render() {
        this.props.logger('parent-render', this.state.color);
        return (
          <ChildComponent
            logger={this.props.logger}
            color={this.state.color}
            onSelectColor={this.handleColor}
          />
        );
      }
    }

    /** 保留基于初始颜色创建的 hue，通过一次点击同时更新父 prop 和自身 state，展示 updater 与实例读取时机差异。 */
    class ChildComponent extends React.Component {
      /** 把初始 blue prop 记录并派生 dark blue state，为后续旧 state 与新 props 的组合提供基线。 */
      constructor(props) {
        super(props);
        props.logger('getInitialState', props.color);
        this.state = {hue: 'dark ' + props.color};
      }

      /** 先读取旧实例 state/props，再安排父颜色更新和自身函数式 state 更新；updater 依赖参数 props，提交回调读取最终实例状态。 */
      handleHue = (shade, color) => {
        this.props.logger('handleHue', this.state.hue, this.props.color);
        this.props.onSelectColor(color);
        this.setState(
          /** updater 参数 props 已含父更新的 green，实例 this.props 此时仍为上一轮 blue。 */
          function (state, props) {
            this.props.logger(
              'setState-this',
              this.state.hue,
              this.props.color,
            );
            this.props.logger('setState-args', state.hue, props.color);
            return {hue: shade + ' ' + props.color};
          },
          /** 子提交回调读取最终 light green/green，与 updater 内读取旧实例值形成时序对照。 */
          function () {
            this.props.logger(
              'after-setState',
              this.state.hue,
              this.props.color,
            );
          },
        );
      };

      /** 记录当前 hue/color 并生成四个绑定 shade/color 的按钮，让 Light Green 点击准确选择 light 与 green 两个输入。 */
      render() {
        this.props.logger('render', this.state.hue, this.props.color);
        return (
          <div>
            <button onClick={this.handleHue.bind(this, 'dark', 'blue')}>
              Dark Blue
            </button>
            <button onClick={this.handleHue.bind(this, 'light', 'blue')}>
              Light Blue
            </button>
            <button onClick={this.handleHue.bind(this, 'dark', 'green')}>
              Dark Green
            </button>
            <button onClick={this.handleHue.bind(this, 'light', 'green')}>
              Light Green
            </button>
          </div>
        );
      }
    }

    const container = document.createElement('div');
    document.body.appendChild(container);

    const logger = jest.fn();
    const root = ReactDOMClient.createRoot(container);

    await act(async () => {
      root.render(<ParentComponent logger={logger} />);
    });

    await act(async () => {
      // 点击 "light green"
      container.childNodes[0].childNodes[3].click();
    });

    expect(logger.mock.calls).toEqual([
      ['parent-render', 'blue'],
      ['getInitialState', 'blue'],
      ['render', 'dark blue', 'blue'],
      ['handleHue', 'dark blue', 'blue'],
      ['parent-handleColor', 'blue'],
      ['parent-render', 'green'],
      ['setState-this', 'dark blue', 'blue'],
      ['setState-args', 'dark blue', 'green'],
      ['render', 'light green', 'green'],
      ['after-setState', 'light green', 'green'],
      ['parent-after-setState', 'green'],
    ]);
  });
});
