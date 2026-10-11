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
let ReactNoop;
let Scheduler;
let act;
let assertLog;

/** 验证类组件在构造、旧式生命周期、更新和卸载各阶段都先完成 defaultProps 解析并剔除 ref。 */
describe('ReactClassComponentPropResolution', () => {
  /** 重置模块并绑定渲染器、调度日志和 act，隔离生命周期调用序列。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
  });

  /** 记录并返回文本，把 render 阶段观察到的属性键加入统一时间线。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** Given Component 同时接收普通属性、ref 与 defaultProps；When 依次挂载、更新和卸载；Then 所有生命周期只看到 text/default，且 ref 始终作为特殊字段处理。通过 Scheduler 完整调用序列验证 ReactFiberClassComponent 的 props 解析边界。 */
  it('resolves ref and default props before calling lifecycle methods', async () => {
    const root = ReactNoop.createRoot();

    /** 将 props 自有键规范化为稳定字符串，便于跨生命周期逐项比对。 */
    function getPropKeys(props) {
      return Object.keys(props).join(', ');
    }

    /** 覆盖类组件完整生命周期的探针，每个阶段都记录其可见 props 形状。 */
    class Component extends React.Component {
      /** 记录构造阶段收到的 props 键，验证 defaultProps 已补齐且 ref 未泄漏。 */
      constructor(props) {
        super(props);
        Scheduler.log('constructor: ' + getPropKeys(props));
      }
      /** 同时记录当前 props 与下一份 props，覆盖更新判定阶段的属性解析结果。 */
      shouldComponentUpdate(props) {
        Scheduler.log(
          'shouldComponentUpdate (prev props): ' + getPropKeys(this.props),
        );
        Scheduler.log(
          'shouldComponentUpdate (next props): ' + getPropKeys(props),
        );
        return true;
      }
      /** 在提交后记录旧 props 参数与实例上的新 props，验证生命周期两侧都已按规则解析。 */
      componentDidUpdate(props) {
        Scheduler.log('componentDidUpdate (prev props): ' + getPropKeys(props));
        Scheduler.log(
          'componentDidUpdate (next props): ' + getPropKeys(this.props),
        );
        return true;
      }
      /** 记录挂载完成时实例 props，作为构造、render 与提交阶段的一致性证据。 */
      componentDidMount() {
        Scheduler.log('componentDidMount: ' + getPropKeys(this.props));
        return true;
      }
      /** 记录旧式挂载前生命周期所见 props，覆盖兼容生命周期路径。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount: ' + getPropKeys(this.props));
      }
      /** 对比接收新属性前后的 props 键，确保 ref 过滤与默认值补齐在更新入口完成。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log(
          'componentWillReceiveProps (prev props): ' + getPropKeys(this.props),
        );
        Scheduler.log(
          'componentWillReceiveProps (next props): ' + getPropKeys(nextProps),
        );
      }
      /** 记录更新前生命周期的当前/下一 props，确认提交前属性形状稳定。 */
      UNSAFE_componentWillUpdate(nextProps) {
        Scheduler.log(
          'componentWillUpdate (prev props): ' + getPropKeys(this.props),
        );
        Scheduler.log(
          'componentWillUpdate (next props): ' + getPropKeys(nextProps),
        );
      }
      /** 记录卸载时最后一次已提交 props，确保特殊 ref 从未成为普通属性。 */
      componentWillUnmount() {
        Scheduler.log('componentWillUnmount: ' + getPropKeys(this.props));
      }
      /** 把本轮 props 键写入 Text 日志，串联生命周期与实际渲染输入。 */
      render() {
        return <Text text={'render: ' + getPropKeys(this.props)} />;
      }
    }

    Component.defaultProps = {
      default: 'yo',
    };

    // 类组件的 `ref` 会从传给实例的 props 中剔除；`default` 则必须始终由 defaultProps 补入。

    // 挂载阶段。
    const ref = React.createRef();
    await act(async () => {
      root.render(<Component text="Yay" ref={ref} />);
    });
    assertLog([
      'constructor: text, default',
      'componentWillMount: text, default',
      'render: text, default',
      'componentDidMount: text, default',
    ]);

    // 更新阶段。
    await act(async () => {
      root.render(<Component text="Yay (again)" ref={ref} />);
    });
    assertLog([
      'componentWillReceiveProps (prev props): text, default',
      'componentWillReceiveProps (next props): text, default',
      'shouldComponentUpdate (prev props): text, default',
      'shouldComponentUpdate (next props): text, default',
      'componentWillUpdate (prev props): text, default',
      'componentWillUpdate (next props): text, default',
      'render: text, default',
      'componentDidUpdate (prev props): text, default',
      'componentDidUpdate (next props): text, default',
    ]);

    // 卸载阶段。
    await act(async () => {
      root.render(null);
    });
    assertLog(['componentWillUnmount: text, default']);
  });
});
