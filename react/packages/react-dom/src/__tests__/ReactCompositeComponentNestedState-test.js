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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should provide up to date values for props」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should provide up to date values for props', async () => {
    /** `ParentComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ParentComponent extends React.Component {
      /** `ParentComponent.state`：记录测试夹具在当前场景中的状态。 */
      state = {color: 'blue'};

      /** `ParentComponent.handleColor`：封装当前用例复用的操作、回调或断言步骤。 */
      handleColor = color => {
        this.props.logger('parent-handleColor', this.state.color);
        this.setState({color: color}, function () {
          this.props.logger('parent-after-setState', this.state.color);
        });
      };

      /** `ParentComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `ChildComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ChildComponent extends React.Component {
      /** `ChildComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        props.logger('getInitialState', props.color);
        this.state = {hue: 'dark ' + props.color};
      }

      /** `ChildComponent.handleHue`：封装当前用例复用的操作、回调或断言步骤。 */
      handleHue = (shade, color) => {
        this.props.logger('handleHue', this.state.hue, this.props.color);
        this.props.onSelectColor(color);
        this.setState(
          function (state, props) {
            this.props.logger(
              'setState-this',
              this.state.hue,
              this.props.color,
            );
            this.props.logger('setState-args', state.hue, props.color);
            return {hue: shade + ' ' + props.color};
          },
          function () {
            this.props.logger(
              'after-setState',
              this.state.hue,
              this.props.color,
            );
          },
        );
      };

      /** `ChildComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
