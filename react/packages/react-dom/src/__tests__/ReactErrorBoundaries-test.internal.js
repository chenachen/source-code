/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let PropTypes;
let React;
let ReactDOM;
let ReactDOMClient;
let act;
let Scheduler;

describe('ReactErrorBoundaries', () => {
  let BrokenConstructor;
  let BrokenComponentWillMount;
  let BrokenComponentDidMount;
  let BrokenComponentWillReceiveProps;
  let BrokenComponentWillUpdate;
  let BrokenComponentDidUpdate;
  let BrokenComponentWillUnmount;
  let BrokenRenderErrorBoundary;
  let BrokenComponentWillMountErrorBoundary;
  let BrokenComponentDidMountErrorBoundary;
  let BrokenRender;
  let BrokenUseEffect;
  let BrokenUseLayoutEffect;
  let ErrorBoundary;
  let ErrorMessage;
  let NoopErrorBoundary;
  let RetryErrorBoundary;
  let Normal;
  let assertLog;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    PropTypes = require('prop-types');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    React = require('react');
    act = require('internal-test-utils').act;
    Scheduler = require('scheduler');

    ({assertLog, assertConsoleErrorDev} = require('internal-test-utils'));

    /**
     * 构造器抛 Hello 的故障组件；其他生命周期日志用于确认失败后哪些阶段不会发生。
     */
    BrokenConstructor = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；立即抛 Hello，实例不会完成构造或提交。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenConstructor constructor [!]');
        throw new Error('Hello');
      }

      /**
       * 记录 BrokenConstructor 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenConstructor render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenConstructor 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenConstructor componentWillMount');
      }

      /**
       * 把 BrokenConstructor 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenConstructor componentDidMount');
      }

      /**
       * 把 BrokenConstructor 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenConstructor componentWillReceiveProps');
      }

      /**
       * 把 BrokenConstructor 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenConstructor componentWillUpdate');
      }

      /**
       * 把 BrokenConstructor 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenConstructor componentDidUpdate');
      }

      /**
       * 把 BrokenConstructor 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenConstructor componentWillUnmount');
      }
    };

    /**
     * willMount 抛 Hello 的挂载故障组件；对照正常生命周期日志区分 render 中止与提交。
     */
    BrokenComponentWillMount = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillMount constructor');
      }

      /**
       * 记录 BrokenComponentWillMount 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenComponentWillMount render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 记录 BrokenComponentWillMount 在首次 render 前的旧式挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillMount componentWillMount [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillMount 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillMount componentDidMount');
      }

      /**
       * 把 BrokenComponentWillMount 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentWillMount componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentWillMount 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillMount componentWillUpdate');
      }

      /**
       * 把 BrokenComponentWillMount 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillMount componentDidUpdate');
      }

      /**
       * 把 BrokenComponentWillMount 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillMount componentWillUnmount');
      }
    };

    /**
     * didMount 抛 Hello 的提交故障组件；其 render 正常，使测试能够验证提交遍历继续及随后恢复。
     */
    BrokenComponentDidMount = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentDidMount constructor');
      }

      /**
       * 记录 BrokenComponentDidMount 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenComponentDidMount render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentDidMount 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentDidMount componentWillMount');
      }

      /**
       * 记录 BrokenComponentDidMount 在layout 提交中的挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentDidMount() {
        Scheduler.log('BrokenComponentDidMount componentDidMount [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentDidMount 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentDidMount componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentDidMount 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentDidMount componentWillUpdate');
      }

      /**
       * 把 BrokenComponentDidMount 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentDidMount componentDidUpdate');
      }

      /**
       * 把 BrokenComponentDidMount 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentDidMount componentWillUnmount');
      }
    };

    /**
     * 首次挂载正常、接收更新 props 时抛 Hello 的组件，用来定位更新 render 阶段的捕获。
     */
    BrokenComponentWillReceiveProps = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillReceiveProps constructor');
      }

      /**
       * 记录 BrokenComponentWillReceiveProps 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenComponentWillReceiveProps render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillReceiveProps componentWillMount');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillReceiveProps componentDidMount');
      }

      /**
       * 记录 BrokenComponentWillReceiveProps 在接收新 props 的更新 render 阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log(
          'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
        );
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillReceiveProps componentWillUpdate');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillReceiveProps componentDidUpdate');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillReceiveProps componentWillUnmount');
      }
    };

    /**
     * 初挂正常、willUpdate 抛 Hello 的组件，覆盖更新 render 开始后的错误恢复。
     */
    BrokenComponentWillUpdate = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillUpdate constructor');
      }

      /**
       * 记录 BrokenComponentWillUpdate 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenComponentWillUpdate render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentWillUpdate 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillUpdate componentWillMount');
      }

      /**
       * 把 BrokenComponentWillUpdate 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillUpdate componentDidMount');
      }

      /**
       * 把 BrokenComponentWillUpdate 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentWillUpdate componentWillReceiveProps');
      }

      /**
       * 记录 BrokenComponentWillUpdate 在更新 render 前的旧式阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillUpdate componentWillUpdate [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillUpdate 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillUpdate componentDidUpdate');
      }

      /**
       * 把 BrokenComponentWillUpdate 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillUpdate componentWillUnmount');
      }
    };

    /**
     * 初挂正常、didUpdate 抛 errorText 的组件，用来验证 layout 提交错误延后恢复。
     */
    BrokenComponentDidUpdate = class extends React.Component {

      /**
       * 默认 errorText=Hello；调用者可改成 E1/E2/E3/E4，以区分同一批提交中多个独立错误。
       */
      static defaultProps = {
        errorText: 'Hello',
      };

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentDidUpdate constructor');
      }

      /**
       * 记录 BrokenComponentDidUpdate 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenComponentDidUpdate render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentDidUpdate 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentDidUpdate componentWillMount');
      }

      /**
       * 把 BrokenComponentDidUpdate 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenComponentDidUpdate componentDidMount');
      }

      /**
       * 把 BrokenComponentDidUpdate 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentDidUpdate componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentDidUpdate 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentDidUpdate componentWillUpdate');
      }

      /**
       * 记录 BrokenComponentDidUpdate 在layout 提交中的更新阶段的故障，再抛 props.errorText；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentDidUpdate componentDidUpdate [!]');
        throw new Error(this.props.errorText);
      }

      /**
       * 把 BrokenComponentDidUpdate 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentDidUpdate componentWillUnmount');
      }
    };

    /**
     * 卸载时抛 errorText 的组件；既可作为原错误源，也可在回退清理中产生第二条错误。
     */
    BrokenComponentWillUnmount = class extends React.Component {

      /**
       * 默认 errorText=Hello；调用者可改成 E1/E2/E3/E4，以区分同一批提交中多个独立错误。
       */
      static defaultProps = {
        errorText: 'Hello',
      };

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillUnmount constructor');
      }

      /**
       * 记录 BrokenComponentWillUnmount 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log('BrokenComponentWillUnmount render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentWillUnmount 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillUnmount componentWillMount');
      }

      /**
       * 把 BrokenComponentWillUnmount 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillUnmount componentDidMount');
      }

      /**
       * 把 BrokenComponentWillUnmount 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentWillUnmount componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentWillUnmount 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillUnmount componentWillUpdate');
      }

      /**
       * 把 BrokenComponentWillUnmount 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillUnmount componentDidUpdate');
      }

      /**
       * 记录 BrokenComponentWillUnmount 在删除已提交实例的清理阶段的故障，再抛 props.errorText；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillUnmount componentWillUnmount [!]');
        throw new Error(this.props.errorText);
      }
    };

    /**
     * 虽提供派生错误状态却在自身 willMount 抛错的边界；证明边界不能捕获自己的初始化错误。
     */
    BrokenComponentWillMountErrorBoundary = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log('BrokenComponentWillMountErrorBoundary constructor');
      }

      /**
       * error 存在时返回错误消息 div，否则包住 children；自身生命周期抛错不能由自己的派生方法捕获。
       */
      render() {
        if (this.state.error) {
          Scheduler.log('BrokenComponentWillMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        Scheduler.log('BrokenComponentWillMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 记录 BrokenComponentWillMountErrorBoundary 在首次 render 前的旧式挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
        );
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillMountErrorBoundary 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary componentDidMount',
        );
      }

      /**
       * 把 BrokenComponentWillMountErrorBoundary 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary componentWillUnmount',
        );
      }

      /**
       * 记录捕获并返回 {error} 状态补丁；React 在恢复 render 前合并，使 render 能选择回退；error 为当前捕获对象。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary static getDerivedStateFromError',
        );
        return {error};
      }
    };

    /**
     * 自身 didMount 抛错的边界；外层边界必须接手并清理已提交的内层实例。
     */
    BrokenComponentDidMountErrorBoundary = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log('BrokenComponentDidMountErrorBoundary constructor');
      }

      /**
       * error 存在时返回错误消息 div，否则包住 children；自身生命周期抛错不能由自己的派生方法捕获。
       */
      render() {
        if (this.state.error) {
          Scheduler.log('BrokenComponentDidMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        Scheduler.log('BrokenComponentDidMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentDidMountErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary componentWillMount',
        );
      }

      /**
       * 记录 BrokenComponentDidMountErrorBoundary 在layout 提交中的挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentDidMount() {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary componentDidMount [!]',
        );
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentDidMountErrorBoundary 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary componentWillUnmount',
        );
      }

      /**
       * 记录捕获并返回 {error} 状态补丁；React 在恢复 render 前合并，使 render 能选择回退；error 为当前捕获对象。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary static getDerivedStateFromError',
        );
        return {error};
      }
    };

    /**
     * 成功分支显示 children，捕获子错误后自身回退 render 再抛 Hello 的边界，用来测试向外层传播。
     */
    BrokenRenderErrorBoundary = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log('BrokenRenderErrorBoundary constructor');
      }

      /**
       * error 存在时记录回退 render 并再次抛 Hello，否则返回 children 的 div；自身回退错误必须交给外层边界。
       */
      render() {
        if (this.state.error) {
          Scheduler.log('BrokenRenderErrorBoundary render error [!]');
          throw new Error('Hello');
        }
        Scheduler.log('BrokenRenderErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenRenderErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenRenderErrorBoundary componentWillMount');
      }

      /**
       * 把 BrokenRenderErrorBoundary 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenRenderErrorBoundary componentDidMount');
      }

      /**
       * 把 BrokenRenderErrorBoundary 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenRenderErrorBoundary componentWillUnmount');
      }

      /**
       * 记录捕获并返回 {error} 状态补丁；React 在恢复 render 前合并，使 render 能选择回退；error 为当前捕获对象。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log(
          'BrokenRenderErrorBoundary static getDerivedStateFromError',
        );
        return {error};
      }
    };

    /**
     * render 直接抛 Hello 的组件；正常构造和生命周期日志用于区分错误重试与真正提交。
     */
    BrokenRender = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenRender constructor');
      }

      /**
       * 记录 render 故障并抛 Hello；不返回 UI，父边界或 HostRoot 必须恢复。
       */
      render() {
        Scheduler.log('BrokenRender render [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenRender 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenRender componentWillMount');
      }

      /**
       * 把 BrokenRender 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('BrokenRender componentDidMount');
      }

      /**
       * 把 BrokenRender 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenRender componentWillReceiveProps');
      }

      /**
       * 把 BrokenRender 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenRender componentWillUpdate');
      }

      /**
       * 把 BrokenRender 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log('BrokenRender componentDidUpdate');
      }

      /**
       * 把 BrokenRender 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenRender componentWillUnmount');
      }
    };

    /**
     * 透传 children 并在 passive effect 抛 Hello 的组件；act 冲刷 effect 后验证父边界恢复，effect 不返回清理函数。
     */
    BrokenUseEffect = ({children}) => {
      Scheduler.log('BrokenUseEffect render');

      React.useEffect(() => {
        Scheduler.log('BrokenUseEffect useEffect [!]');
        throw new Error('Hello');
      });

      return children;
    };

    /**
     * 透传 children 并在 layout effect 抛 Hello 的组件；用于验证提交遍历继续及父边界恢复，effect 不返回清理函数。
     */
    BrokenUseLayoutEffect = ({children}) => {
      Scheduler.log('BrokenUseLayoutEffect render');

      React.useLayoutEffect(() => {
        Scheduler.log('BrokenUseLayoutEffect useLayoutEffect [!]');
        throw new Error('Hello');
      });

      return children;
    };

    /**
     * 故意不提供有效恢复状态的边界；派生返回 undefined 且 render 始终返回 BrokenRender，错误最终继续向根传播。
     */
    NoopErrorBoundary = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('NoopErrorBoundary constructor');
      }

      /**
       * 始终返回 BrokenRender；派生没有切换到有效回退，因此重试仍失败并向祖先传播。
       */
      render() {
        Scheduler.log('NoopErrorBoundary render');
        return <BrokenRender />;
      }

      /**
       * 把 NoopErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('NoopErrorBoundary componentWillMount');
      }

      /**
       * 把 NoopErrorBoundary 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('NoopErrorBoundary componentDidMount');
      }

      /**
       * 把 NoopErrorBoundary 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('NoopErrorBoundary componentWillUnmount');
      }

      /**
       * 记录捕获但返回 undefined，不提供状态补丁；下一轮仍渲染失败 children，供无有效恢复的用例作证。
       */
      static getDerivedStateFromError() {
        Scheduler.log('NoopErrorBoundary static getDerivedStateFromError');
      }
    };

    /**
     * 成功路径日志对照组件；logName 区分多个实例，children 用来组成异常恢复前的已提交子树。
     */
    Normal = class extends React.Component {

      /**
       * 默认 logName=Normal；多个成功 fixture 可覆盖日志标签，避免混淆实例的挂载、更新与清理顺序。
       */
      static defaultProps = {
        logName: 'Normal',
      };

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log(`${this.props.logName} constructor`);
      }

      /**
       * 记录 Normal 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        Scheduler.log(`${this.props.logName} render`);
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 Normal 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log(`${this.props.logName} componentWillMount`);
      }

      /**
       * 把 Normal 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log(`${this.props.logName} componentDidMount`);
      }

      /**
       * 把 Normal 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log(`${this.props.logName} componentWillReceiveProps`);
      }

      /**
       * 把 Normal 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log(`${this.props.logName} componentWillUpdate`);
      }

      /**
       * 把 Normal 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log(`${this.props.logName} componentDidUpdate`);
      }

      /**
       * 把 Normal 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log(`${this.props.logName} componentWillUnmount`);
      }
    };

    /**
     * 通用测试边界；派生保存 error，renderError 输出回退，forceRetry 显式绕过错误态；生命周期日志核对捕获与提交清理顺序。
     */
    ErrorBoundary = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log(`${this.props.logName} constructor`);
      }

      /**
       * error 存在且未 forceRetry 时把 error/props 传给 renderError 返回回退；否则返回包含 children 的 div。状态保留到测试显式重试，不会仅因 children 改变自动清除。
       */
      render() {
        if (this.state.error && !this.props.forceRetry) {
          Scheduler.log(`${this.props.logName} render error`);
          return this.props.renderError(this.state.error, this.props);
        }
        Scheduler.log(`${this.props.logName} render success`);
        return <div>{this.props.children}</div>;
      }

      /**
       * 记录捕获并返回 {error} 状态补丁；React 在恢复 render 前合并，使 render 能选择回退；error 为当前捕获对象。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log('ErrorBoundary static getDerivedStateFromError');
        return {error};
      }

      /**
       * 把 ErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log(`${this.props.logName} componentWillMount`);
      }

      /**
       * 把 ErrorBoundary 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log(`${this.props.logName} componentDidMount`);
      }

      /**
       * 把 ErrorBoundary 在接收新 props 的更新 render 阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log(`${this.props.logName} componentWillReceiveProps`);
      }

      /**
       * 把 ErrorBoundary 在更新 render 前的旧式阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        Scheduler.log(`${this.props.logName} componentWillUpdate`);
      }

      /**
       * 把 ErrorBoundary 在layout 提交中的更新阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        Scheduler.log(`${this.props.logName} componentDidUpdate`);
      }

      /**
       * 把 ErrorBoundary 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log(`${this.props.logName} componentWillUnmount`);
      }
    };
    ErrorBoundary.defaultProps = {
      logName: 'ErrorBoundary',

      /**
       * 默认回退渲染器：把 Error.message 放入 div，并挂接 props.errorMessageRef；该 ref 只属于成功提交的回退，卸载时清空。
       */
      renderError(error, props) {
        return (
          <div ref={props.errorMessageRef}>
            Caught an error: {error.message}.
          </div>
        );
      },
    };

    /**
     * 派生返回空补丁但仍渲染 BrokenRender 的重试边界；恢复再次失败，需外层边界接手。
     */
    RetryErrorBoundary = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('RetryErrorBoundary constructor');
      }

      /**
       * 始终返回 BrokenRender；派生没有切换到有效回退，因此重试仍失败并向祖先传播。
       */
      render() {
        Scheduler.log('RetryErrorBoundary render');
        return <BrokenRender />;
      }

      /**
       * 把 RetryErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('RetryErrorBoundary componentWillMount');
      }

      /**
       * 把 RetryErrorBoundary 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('RetryErrorBoundary componentDidMount');
      }

      /**
       * 把 RetryErrorBoundary 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('RetryErrorBoundary componentWillUnmount');
      }

      /**
       * 接收捕获 error，记录后返回空状态补丁；并未保存错误或更换输出，所以 BrokenRender 会再次失败，错误上升到外层边界。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log('RetryErrorBoundary static getDerivedStateFromError [!]');
        // 空状态补丁不更换失败输出，下一轮仍抛错并交给外层边界。
        return {};
      }
    };

    /**
     * 具有完整挂载/卸载日志的回退组件；message 来自捕获错误，用来证明回退组件真正提交及随后清理。
     */
    ErrorMessage = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        Scheduler.log('ErrorMessage constructor');
      }

      /**
       * 把 ErrorMessage 在首次 render 前的旧式挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log('ErrorMessage componentWillMount');
      }

      /**
       * 把 ErrorMessage 在layout 提交中的挂载阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        Scheduler.log('ErrorMessage componentDidMount');
      }

      /**
       * 把 ErrorMessage 在删除已提交实例的清理阶段的访问记入 Scheduler；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        Scheduler.log('ErrorMessage componentWillUnmount');
      }

      /**
       * 记录回退 render 并返回 props.message 的错误文本 div；didMount 日志另外证明这份候选输出真正提交。
       */
      render() {
        Scheduler.log('ErrorMessage render');
        return <div>Caught an error: {this.props.message}.</div>;
      }
    };
  });

  /**
   * 分别在无边界的新根挂载 render、willMount、didMount 抛错组件；await act 均拒绝 Hello，证明 render 与提交错误都不会被无声吞掉。
   */
  it('does not swallow exceptions on mounting without boundaries', async () => {
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(async () => {
        root.render(<BrokenRender />);
      });
    }).rejects.toThrow('Hello');

    Scheduler.unstable_clearLog();
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(async () => {
        root.render(<BrokenComponentWillMount />);
      });
    }).rejects.toThrow('Hello');

    Scheduler.unstable_clearLog();
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(async () => {
        root.render(<BrokenComponentDidMount />);
      });
    }).rejects.toThrow('Hello');
  });

  /**
   * 先成功挂载三个组件，再分别重渲染触发 willUpdate、willReceiveProps、didUpdate 抛错；每次 await act 拒绝 Hello，覆盖更新阶段无边界的异常出口。
   */
  it('does not swallow exceptions on updating without boundaries', async () => {
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<BrokenComponentWillUpdate />);
    });
    Scheduler.unstable_clearLog();
    await expect(async () => {
      await act(async () => {
        root.render(<BrokenComponentWillUpdate />);
      });
    }).rejects.toThrow('Hello');

    Scheduler.unstable_clearLog();
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<BrokenComponentWillReceiveProps />);
    });
    Scheduler.unstable_clearLog();
    await expect(async () => {
      await act(async () => {
        root.render(<BrokenComponentWillReceiveProps />);
      });
    }).rejects.toThrow('Hello');
    Scheduler.unstable_clearLog();
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<BrokenComponentDidUpdate />);
    });
    Scheduler.unstable_clearLog();
    await expect(async () => {
      await act(async () => {
        root.render(<BrokenComponentDidUpdate />);
      });
    }).rejects.toThrow('Hello');
  });

  /**
   * 先挂载卸载时抛错的组件，再 root.unmount；await act 拒绝 Hello，验证根卸载也报告提交阶段错误。
   */
  it('does not swallow exceptions on unmounting without boundaries', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<BrokenComponentWillUnmount />);
    });
    Scheduler.unstable_clearLog();
    await expect(async () => {
      await act(() => root.unmount());
    }).rejects.toThrow('Hello');
  });

  /**
   * 三个独立根分别正常、无边界失败、有边界失败；失败后前根保持 Before 1、第二根为空、第三根为回退；再分别更新到 After 1/2/3 并卸载，证明根之间错误状态隔离且各自可继续使用。
   */
  it('prevents errors from leaking into other roots', async () => {
    const container1 = document.createElement('div');
    const root1 = ReactDOMClient.createRoot(container1);
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    const container3 = document.createElement('div');
    const root3 = ReactDOMClient.createRoot(container3);

    await act(async () => {
      root1.render(<span>Before 1</span>);
    });
    await expect(async () => {
      await act(async () => {
        root2.render(<BrokenRender />);
      });
    }).rejects.toThrow('Hello');

    assertLog([
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
    ]);
    await act(async () => {
      root3.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container1.firstChild.textContent).toBe('Before 1');
    expect(container2.firstChild).toBe(null);
    expect(container3.firstChild.textContent).toBe('Caught an error: Hello.');

    Scheduler.unstable_clearLog();
    await act(async () => {
      root1.render(<span>After 1</span>);
    });
    Scheduler.unstable_clearLog();
    await act(async () => {
      root2.render(<span>After 2</span>);
    });
    Scheduler.unstable_clearLog();
    await act(async () => {
      root3.render(<ErrorBoundary forceRetry={true}>After 3</ErrorBoundary>);
    });
    expect(container1.firstChild.textContent).toBe('After 1');
    expect(container2.firstChild.textContent).toBe('After 2');
    expect(container3.firstChild.textContent).toBe('After 3');
    root1.unmount();
    root2.unmount();
    root3.unmount();
    expect(container1.firstChild).toBe(null);
    expect(container2.firstChild).toBe(null);
    expect(container3.firstChild).toBe(null);
  });

  /**
   * 在边界内挂载 BrokenRender，并监视 DEV console.error；尽管日志包含 render 重试，错误只报告一次且 DOM 为 Hello 回退，卸载只记录边界清理。
   */
  it('logs a single error when using error boundary', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    spyOnDev(console, 'error');
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error.mock.calls[0][2]).toContain(
        'The above error occurred in the <BrokenRender> component',
      );
    }

    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 捕获并渲染错误消息
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 边界内首次 render 抛 Hello；DOM 提交错误文本，日志区分捕获、整根重试与边界 didMount；卸载不调用失败子组件的卸载钩子。
   */
  it('renders an error state if child throws in render', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 捕获并渲染错误消息
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 边界内构造器抛 Hello；实例未完成构造，DOM 仍提交边界回退，日志仅到失败构造器并包含重试；最终只卸载边界。
   */
  it('renders an error state if child throws in constructor', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenConstructor />
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenConstructor constructor [!]',
      // 捕获并渲染错误消息
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenConstructor constructor [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 边界内 willMount 抛 Hello；初始子树未提交，DOM 为错误回退，日志证明捕获与 render 重试后只有边界挂载及卸载。
   */
  it('renders an error state if child throws in componentWillMount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentWillMount />
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillMount constructor',
      'BrokenComponentWillMount componentWillMount [!]',
      // 捕获并渲染错误消息
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillMount constructor',
      'BrokenComponentWillMount componentWillMount [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * legacy Context provider 在 willMount 抛 Hello；受 gate 控制的配置下断言 legacy API 警告和边界错误文本，证明 provider 初始化错误也向父边界传播。
   */

  // @gate !disableLegacyContext || !__DEV__

  it('renders an error state if context provider throws in componentWillMount', async () => {

    /**
     * legacy Context provider 故障夹具；getChildContext 提供 foo=42，但 willMount 立即抛错，用来检查初始化失败能否由父边界恢复。
     */
    class BrokenComponentWillMountWithContext extends React.Component {

      /**
       * 声明旧 Context 的 foo 数值通道，配合 getChildContext 的 42；用例受 legacy Context gate 控制。
       */
      static childContextTypes = {foo: PropTypes.number};

      /**
       * 返回 foo=42 的旧 Context 值；其存在让 willMount 错误发生在 provider 初始化路径。
       */
      getChildContext() {
        return {foo: 42};
      }

      /**
       * 正常路径以 div 承载 children；本用例 willMount 先抛错，故不会提交这份输出。
       */
      render() {
        return <div>{this.props.children}</div>;
      }

      /**
       * 在 provider 初次 render 前抛 Hello，验证自身尚未提交时由外层边界捕获。
       */
      UNSAFE_componentWillMount() {
        throw new Error('Hello');
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentWillMountWithContext />
        </ErrorBoundary>,
      );
    });
    assertConsoleErrorDev([
      'BrokenComponentWillMountWithContext uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in BrokenComponentWillMountWithContext (at **)',
    ]);
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
  });

  /**
   * 以 renderError 把错误转换成 ErrorMessage 组件；BrokenRender 初挂失败后，日志证明回退组件真正挂载，根卸载再清理边界及 ErrorMessage。
   */
  it('mounts the error message if mounting fails', async () => {

    /**
     * 把捕获 Error.message 传给 ErrorMessage，返回有完整挂载/卸载日志的回退组件；借此区别回退 render 尝试与真正提交。
     */
    function renderError(error) {
      return <ErrorMessage message={error.message} />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary renderError={renderError}>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorMessage constructor',
      'ErrorMessage componentWillMount',
      'ErrorMessage render',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorMessage constructor',
      'ErrorMessage componentWillMount',
      'ErrorMessage render',
      'ErrorMessage componentDidMount',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog([
      'ErrorBoundary componentWillUnmount',
      'ErrorMessage componentWillUnmount',
    ]);
  });

  /**
   * 内层 RetryErrorBoundary 的错误派生返回空对象仍渲染 BrokenRender；重试再次失败后由外层边界提交 Hello 回退，最终只有外层边界需要卸载。
   */
  it('propagates errors on retry on mounting', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <RetryErrorBoundary>
            <BrokenRender />
          </RetryErrorBoundary>
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'RetryErrorBoundary constructor',
      'RetryErrorBoundary componentWillMount',
      'RetryErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 重试
      'RetryErrorBoundary static getDerivedStateFromError [!]',
      'RetryErrorBoundary componentWillMount',
      'RetryErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 这一次，错误会传播到更高层边界。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'RetryErrorBoundary constructor',
      'RetryErrorBoundary componentWillMount',
      'RetryErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'RetryErrorBoundary static getDerivedStateFromError [!]',
      'RetryErrorBoundary componentWillMount',
      'RetryErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 内部边界自己的 willMount 抛错；其派生方法不能捕获自身初始化错误，外层边界提交 Hello 回退，日志及卸载均只完成外层边界。
   */
  it('propagates errors inside boundary during componentWillMount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentWillMountErrorBoundary />
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillMountErrorBoundary constructor',
      'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
      // 错误会传播到更高层边界。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillMountErrorBoundary constructor',
      'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 内层边界先捕获子错误，却在渲染自身回退时再次抛 Hello；外层边界接手，日志显示两层捕获顺序与整根重试，最终只提交外层回退。
   */
  it('propagates errors inside boundary while rendering error state', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenRenderErrorBoundary>
            <BrokenRender />
          </BrokenRenderErrorBoundary>
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRenderErrorBoundary constructor',
      'BrokenRenderErrorBoundary componentWillMount',
      'BrokenRenderErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 试图处理错误
      'BrokenRenderErrorBoundary static getDerivedStateFromError',
      'BrokenRenderErrorBoundary componentWillMount',
      'BrokenRenderErrorBoundary render error [!]',
      // 再次尝试处理错误。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRenderErrorBoundary constructor',
      'BrokenRenderErrorBoundary componentWillMount',
      'BrokenRenderErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'BrokenRenderErrorBoundary static getDerivedStateFromError',
      'BrokenRenderErrorBoundary componentWillMount',
      'BrokenRenderErrorBoundary render error [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 正常 sibling 后跟 BrokenRender 和另一个正常 sibling；初挂 render 被中止后只提交边界回退，日志没有任何未提交子组件的 didMount 或 willUnmount。
   */
  it('does not call componentWillUnmount when aborting initial mount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenRender />
          <Normal />
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      // 渲染第一个子节点
      'Normal constructor',
      'Normal componentWillMount',
      'Normal render',
      // 渲染第二个子元素（它抛出错误）
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 跳过其余 sibling，然后处理错误。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'Normal constructor',
      'Normal componentWillMount',
      'Normal render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 初挂包含 callback ref 节点及 BrokenRender；失败子树的 ref 从未挂接，只有错误回退 ref 获得 DOM；卸载时回退 ref 收到 null，避免把中止 render 误当成已提交挂载。
   */
  it('resets callback refs if mounting aborts', async () => {

    /**
     * 记录失败子树 ref 的 DOM/null 参数；初挂中止时应完全没有这条日志，因为 ref 只在提交时挂接。
     */
    function childRef(x) {
      Scheduler.log('Child ref is set to ' + x);
    }

    /**
     * 记录回退 ref 收到的 DOM 或卸载 null；日志用于证明成功提交的回退拥有独立 ref 生命周期。
     */
    function errorMessageRef(x) {
      Scheduler.log('Error message ref is set to ' + x);
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary errorMessageRef={errorMessageRef}>
          <div ref={childRef} />
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'Error message ref is set to [object HTMLDivElement]',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog([
      'ErrorBoundary componentWillUnmount',
      'Error message ref is set to null',
    ]);
  });

  /**
   * 初挂包含对象 ref 和 BrokenRender；断言回退 ref 指向 HTMLDivElement、根卸载后变 null；日志只提交边界，不把未提交子树当成需卸载的实例。
   */
  it('resets object refs if mounting aborts', async () => {
    const childRef = React.createRef();
    const errorMessageRef = React.createRef();

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary errorMessageRef={errorMessageRef}>
          <div ref={childRef} />
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidMount',
    ]);
    expect(errorMessageRef.current.toString()).toEqual(
      '[object HTMLDivElement]',
    );

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
    expect(errorMessageRef.current).toEqual(null);
  });

  /**
   * 边界内只放正常文本；首挂直接提交 Mounted successfully，日志无捕获分支，卸载正常清理边界，作为异常路径的成功对照。
   */
  it('successfully mounts if no error occurs', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <div>Mounted successfully.</div>
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Mounted successfully.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'ErrorBoundary componentDidMount',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 Normal，再添加 Normal2 和构造器抛错节点；更新失败提交 Hello 回退，日志显示仅已提交 Normal 被卸载，新建但未提交的 Normal2 不执行卸载。
   */
  it('catches if child throws in constructor during update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
        </ErrorBoundary>,
      );
    });
    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <Normal logName="Normal2" />
          <BrokenConstructor />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      // Normal2 将尝试挂载：
      'Normal2 constructor',
      'Normal2 componentWillMount',
      'Normal2 render',
        // BrokenConstructor 会中止渲染：
      'BrokenConstructor constructor [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      'Normal2 constructor',
      'Normal2 componentWillMount',
      'Normal2 render',
      'BrokenConstructor constructor [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Normal componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 Normal，再添加 Normal2 和 willMount 抛错节点；更新捕获后替换为回退，只清理旧 Normal，不清理 render 中止的新节点。
   */
  it('catches if child throws in componentWillMount during update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <Normal logName="Normal2" />
          <BrokenComponentWillMount />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      // Normal2 将尝试挂载：
      'Normal2 constructor',
      'Normal2 componentWillMount',
      'Normal2 render',
      // BrokenComponentWillMount 将中断渲染：
      'BrokenComponentWillMount constructor',
      'BrokenComponentWillMount componentWillMount [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      'Normal2 constructor',
      'Normal2 componentWillMount',
      'Normal2 render',
      'BrokenComponentWillMount constructor',
      'BrokenComponentWillMount componentWillMount [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Normal componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 Normal 与 BrokenComponentWillReceiveProps，再用同结构更新；接收新 props 时抛错，回退提交清理两枚旧实例，日志区分 render 重试与最后一次提交。
   */
  it('catches if child throws in componentWillReceiveProps during update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenComponentWillReceiveProps />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenComponentWillReceiveProps />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
        // BrokenComponentWillReceiveProps 会中止渲染：
      'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Normal componentWillUnmount',
      'BrokenComponentWillReceiveProps componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 已提交 Normal 与 BrokenComponentWillUpdate，再次更新触发 willUpdate 抛错；DOM 为回退且两个已提交子实例均卸载，错误发生在 render 阶段而非 didUpdate。
   */
  it('catches if child throws in componentWillUpdate during update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenComponentWillUpdate />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenComponentWillUpdate />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      // BrokenComponentWillUpdate 将中断渲染：
      'BrokenComponentWillUpdate componentWillReceiveProps',
      'BrokenComponentWillUpdate componentWillUpdate [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      'BrokenComponentWillUpdate componentWillReceiveProps',
      'BrokenComponentWillUpdate componentWillUpdate [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Normal componentWillUnmount',
      'BrokenComponentWillUpdate componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 Normal，再添加 Normal2 和 BrokenRender；render 重试仍失败后提交回退，仅旧 Normal 卸载，避免把未提交新节点误计为清理对象。
   */
  it('catches if child throws in render during update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <Normal logName="Normal2" />
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      // Normal2 将尝试挂载：
      'Normal2 constructor',
      'Normal2 componentWillMount',
      'Normal2 render',
      // BrokenRender 将中断渲染：
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      'Normal2 constructor',
      'Normal2 componentWillMount',
      'Normal2 render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Normal componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 Child1 ref，再更新添加 Child2 ref 与抛错节点；Child1 收到 null、Child2 从未挂接、回退 ref 得到 DOM；根卸载清空回退 ref，验证 ref 以实际提交为边界。
   */
  it('keeps refs up-to-date during updates', async () => {

    /**
     * 记录已提交 Child1 ref 的 DOM/null；更新失败删除旧节点时必须收到 null。
     */
    function child1Ref(x) {
      Scheduler.log('Child1 ref is set to ' + x);
    }

    /**
     * 记录本轮新 Child2 ref 的 DOM/null；失败 render 未提交时不应调用该回调。
     */
    function child2Ref(x) {
      Scheduler.log('Child2 ref is set to ' + x);
    }

    /**
     * 记录错误回退 ref 挂接与卸载清空，和 Child1 的清理日志共同验证提交顺序。
     */
    function errorMessageRef(x) {
      Scheduler.log('Error message ref is set to ' + x);
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary errorMessageRef={errorMessageRef}>
          <div ref={child1Ref} />
        </ErrorBoundary>,
      );
    });
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'Child1 ref is set to [object HTMLDivElement]',
      'ErrorBoundary componentDidMount',
    ]);

    await act(async () => {
      root.render(
        <ErrorBoundary errorMessageRef={errorMessageRef}>
          <div ref={child1Ref} />
          <div ref={child2Ref} />
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      // BrokenRender 将中断渲染：
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 错误重试日志
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // Child1 已卸载，因此更新其 ref。Child2 的挂载已中止，因此其 ref 从未设置。
      'Child1 ref is set to null',
      'Error message ref is set to [object HTMLDivElement]',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog([
      'ErrorBoundary componentWillUnmount',
      'Error message ref is set to null',
    ]);
  });

  /**
   * 已提交两个卸载抛错节点和 Normal，更新删去后两项；提交遍历继续完成其余生命周期，随后边界恢复再删除剩余抛错节点并再次捕获，最终 DOM 为 Hello。
   */
  it('recovers from componentWillUnmount errors on update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentWillUnmount />
          <BrokenComponentWillUnmount />
          <Normal />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentWillUnmount />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      // 更新现有子节点：
      'BrokenComponentWillUnmount componentWillReceiveProps',
      'BrokenComponentWillUnmount componentWillUpdate',
      'BrokenComponentWillUnmount render',
      // 卸载时抛错：
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 尽管发生错误，Fiber 仍会继续执行生命周期。
      'Normal componentWillUnmount',
      // 在此阶段,组件已更新
      'BrokenComponentWillUnmount componentDidUpdate',
      'ErrorBoundary componentDidUpdate',
      // 当前提交已完成；先前捕获的卸载错误安排边界更新，接下来渲染错误内容。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      // 处理第二次卸载错误后，再次提交边界的错误内容。
      'ErrorBoundary render error',
      // 尝试卸载上一个子节点：完成。
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 嵌套 Normal 内含卸载抛错节点，旁边还有同类节点；删除旁节点触发恢复，再清理嵌套旧子树产生第二次错误；日志证明清理继续、每次错误均被处理。
   */
  it('recovers from nested componentWillUnmount errors on update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal>
            <BrokenComponentWillUnmount />
          </Normal>
          <BrokenComponentWillUnmount />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal>
            <BrokenComponentWillUnmount />
          </Normal>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      // 更新现有子节点：
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      'BrokenComponentWillUnmount componentWillReceiveProps',
      'BrokenComponentWillUnmount componentWillUpdate',
      'BrokenComponentWillUnmount render',
      // 卸载时抛错：
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 尽管发生错误，Fiber 仍会继续执行生命周期。
      'BrokenComponentWillUnmount componentDidUpdate',
      'Normal componentDidUpdate',
      'ErrorBoundary componentDidUpdate',
      // 提交阶段完成后，Fiber 开始处理错误。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Normal componentWillUnmount',
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      // 处理第二次卸载错误后，再次提交边界的错误内容。
      'ErrorBoundary render error',
      // 完成
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 外层与内层边界包裹卸载抛错节点，更新仅移除该节点；最近仍保留的内层边界提交 inner 回退，外层只参与原更新，不再为错误恢复重渲染。
   */
  it('picks the right boundary when handling unmounting errors', async () => {

    /**
     * 返回带 inner 标记的错误文本，让 DOM 直接区分是否由最近仍挂载的内边界捕获。
     */
    function renderInnerError(error) {
      return <div>Caught an inner error: {error.message}.</div>;
    }

    /**
     * 返回带 outer 标记的错误文本，用于发现卸载错误是否误越过仍可恢复的内边界。
     */
    function renderOuterError(error) {
      return <div>Caught an outer error: {error.message}.</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary
          logName="OuterErrorBoundary"
          renderError={renderOuterError}>
          <ErrorBoundary
            logName="InnerErrorBoundary"
            renderError={renderInnerError}>
            <BrokenComponentWillUnmount />
          </ErrorBoundary>
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary
          logName="OuterErrorBoundary"
          renderError={renderOuterError}>
          <ErrorBoundary
            logName="InnerErrorBoundary"
            renderError={renderInnerError}
          />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an inner error: Hello.');
    assertLog([
      // 更新外层边界
      'OuterErrorBoundary componentWillReceiveProps',
      'OuterErrorBoundary componentWillUpdate',
      'OuterErrorBoundary render success',
      // 更新内层边界。
      'InnerErrorBoundary componentWillReceiveProps',
      'InnerErrorBoundary componentWillUpdate',
      'InnerErrorBoundary render success',
      // 尝试卸载子组件。
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 提交阶段结束后，Fiber 开始处理错误；只有内层边界会收到该错误：
      'InnerErrorBoundary componentDidUpdate',
      'OuterErrorBoundary componentDidUpdate',
      'ErrorBoundary static getDerivedStateFromError',
      'InnerErrorBoundary componentWillUpdate',
      // 此时渲染一个错误。
      'InnerErrorBoundary render error',
      // 错误恢复只更新内层边界；外层不会再执行 componentDidUpdate。
      'InnerErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog([
      'OuterErrorBoundary componentWillUnmount',
      'InnerErrorBoundary componentWillUnmount',
    ]);
  });

  /**
   * 先进入错误态，直接换成 Normal 仍保留 Hello；设置 forceRetry 才走成功分支并挂载 Normal；证明是否重试由本 fixture 的状态/prop 协议控制，最后正常清理。
   */
  it('can recover from error state', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
        </ErrorBoundary>,
      );
    });
    // 错误边界不会自动重试：
    expect(container.textContent).toBe('Caught an error: Hello.');

    // 强制成功路径：
    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary forceRetry={true}>
          <Normal />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).not.toContain('Caught an error');
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      // 挂载子节点：
      'Normal constructor',
      'Normal componentWillMount',
      'Normal render',
      // 完成更新:
      'Normal componentDidMount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog([
      'ErrorBoundary componentWillUnmount',
      'Normal componentWillUnmount',
    ]);
  });

  /**
   * 进入错误态后重复提交相同失败 children 仍保持回退，再替换整个边界为 Other screen；断言两次错误文本与最终普通输出，验证错误态可以继续更新和被移除。
   */
  it('can update multiple times in error state', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    Scheduler.unstable_clearLog();

    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');
    Scheduler.unstable_clearLog();

    await act(async () => {
      root.render(<div>Other screen</div>);
    });
    expect(container.textContent).toBe('Other screen');

    root.unmount();
  });

  /**
   * 已提交 Normal、卸载抛错节点、Normal 后删去全部 children；边界恢复为 Hello，最后卸载只清理边界，验证删除中异常不残留失效子树。
   */
  it("doesn't get into inconsistent state during removals", async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenComponentWillUnmount />
          <Normal />
        </ErrorBoundary>,
      );
    });
    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(<ErrorBoundary />);
    });
    expect(container.textContent).toBe('Caught an error: Hello.');

    Scheduler.unstable_clearLog();
    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交空边界，再添加正常/抛错/正常节点；失败后 DOM 为 Hello，最后只卸载边界，验证新增 render 中止不会留下需清理的子实例。
   */
  it("doesn't get into inconsistent state during additions", async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<ErrorBoundary />);
    });
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'ErrorBoundary componentDidMount',
    ]);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Normal />
          <BrokenRender />
          <Normal />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');

    Scheduler.unstable_clearLog();
    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 随机重排 100 个 keyed Normal 与一个可抛错节点；先成功挂载，再开启 fail 重排；最终提交 Hello 且卸载只剩边界，验证错误恢复不依赖 sibling 的原排列。
   */
  it("doesn't get into inconsistent state during reorders", async () => {

    /**
     * 创建 100 个稳定 key 的 Normal 与一个 MaybeBrokenRender，再原地随机置换并返回数组；两轮顺序不同但 identity 仍可按 key 关联，错误恢复不能依赖位置。
     */
    function getAMixOfNormalAndBrokenRenderElements() {
      const elements = [];
      for (let i = 0; i < 100; i++) {
        elements.push(<Normal key={i} />);
      }
      elements.push(<MaybeBrokenRender key={100} />);

      let currentIndex = elements.length;
      while (0 !== currentIndex) {
        const randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        const temporaryValue = elements[currentIndex];
        elements[currentIndex] = elements[randomIndex];
        elements[randomIndex] = temporaryValue;
      }
      return elements;
    }

    /**
     * 受闭包 fail 开关控制的 keyed 故障节点；供随机重排用例在第二轮才触发 render 错误。
     */
    class MaybeBrokenRender extends React.Component {

      /**
       * fail 开启时抛 Hello，否则返回包住 children 的 div；使第一次提交可建立旧 sibling 树。
       */
      render() {
        if (fail) {
          throw new Error('Hello');
        }
        return <div>{this.props.children}</div>;
      }
    }

    let fail = false;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          {getAMixOfNormalAndBrokenRenderElements()}
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).not.toContain('Caught an error');

    fail = true;
    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          {getAMixOfNormalAndBrokenRenderElements()}
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Caught an error: Hello.');

    Scheduler.unstable_clearLog();
    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 Stateful 并取得实例，开启闭包 fail 后调用 forceUpdate；实际断言只有调用当下不抛同步异常及随后根卸载日志，并未等待或断言错误回退提交。
   */
  it('catches errors originating downstream', async () => {
    let fail = false;

    /**
     * 供实例 forceUpdate 入口测试的组件；是否抛错读取闭包 fail，而非下面的 shouldThrow 字段。
     */
    class Stateful extends React.Component {

      /**
       * 初始化未被 render 读取的 shouldThrow=false；本用例真正故障开关是外层 fail。
       */
      state = {shouldThrow: false};

      /**
       * 读取闭包 fail，开启时记录 render 故障并抛 Hello，否则返回 div；调用者只断言 forceUpdate 当下不同步抛错。
       */
      render() {
        if (fail) {
          Scheduler.log('Stateful render [!]');
          throw new Error('Hello');
        }
        return <div>{this.props.children}</div>;
      }
    }

    let statefulInst;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Stateful ref={inst => (statefulInst = inst)} />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    expect(() => {
      fail = true;
      statefulInst.forceUpdate();
    }).not.toThrow();
    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 首挂中 didMount 抛错且另一个子组件卸载也抛错；日志显示其余 didMount 继续，随后恢复删除所有 children，再捕获卸载错误，最终边界可正常卸载。
   */
  it('catches errors in componentDidMount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentWillUnmount>
            <Normal />
          </BrokenComponentWillUnmount>
          <BrokenComponentDidMount />
          <Normal logName="LastChild" />
        </ErrorBoundary>,
      );
    });
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillUnmount constructor',
      'BrokenComponentWillUnmount componentWillMount',
      'BrokenComponentWillUnmount render',
      'Normal constructor',
      'Normal componentWillMount',
      'Normal render',
      'BrokenComponentDidMount constructor',
      'BrokenComponentDidMount componentWillMount',
      'BrokenComponentDidMount render',
      'LastChild constructor',
      'LastChild componentWillMount',
      'LastChild render',
      // 开始冲刷 didMount 队列。
      'Normal componentDidMount',
      'BrokenComponentWillUnmount componentDidMount',
      'BrokenComponentDidMount componentDidMount [!]',
      // 尽管出错，仍继续执行。
      'LastChild componentDidMount',
      // 现在我们准备好处理错误
      'ErrorBoundary componentDidMount',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 安全地卸载每个子组件
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 即使发生错误，也继续安全卸载。
      'Normal componentWillUnmount',
      'BrokenComponentDidMount componentWillUnmount',
      'LastChild componentWillUnmount',
      // componentWillUnmount 抛出的错误也应被捕获并记录。
      'ErrorBoundary componentDidUpdate',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 更新已经完成
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 先提交 didUpdate 抛错组件，再更新；子 didUpdate 失败后父 didUpdate 仍执行，随后边界恢复并卸载失败子组件，日志证明提交错误延后处理。
   */
  it('catches errors in componentDidUpdate', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentDidUpdate />
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentDidUpdate />
        </ErrorBoundary>,
      );
    });
    assertLog([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'BrokenComponentDidUpdate componentWillReceiveProps',
      'BrokenComponentDidUpdate componentWillUpdate',
      'BrokenComponentDidUpdate render',
      // 所有生命周期方法都运行
      'BrokenComponentDidUpdate componentDidUpdate [!]',
      'ErrorBoundary componentDidUpdate',
    // 然后处理错误。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'BrokenComponentDidUpdate componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 边界包裹 passive effect 抛错组件并通过 act 冲刷；边界 didMount 先于 useEffect 错误，恢复后 DOM 为 Hello，覆盖 passive 阶段的 commit 错误捕获。
   */
  it('catches errors in useEffect', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ErrorBoundary>
          <BrokenUseEffect>Initial value</BrokenUseEffect>
        </ErrorBoundary>,
      );
    });

    // 确认 passive effect 已冲刷，然后处理错误。
    assertLog([
      // 正常挂载先完成；随后冲刷 passive effect 并捕获错误。
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenUseEffect render',
      'ErrorBoundary componentDidMount',
      'BrokenUseEffect useEffect [!]',
      // 处理错误
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
  });

  /**
   * 边界包裹 layout effect 抛错组件；子 effect 失败后父 didMount 仍执行，再提交边界回退；日志和 DOM 证明 layout 错误不会中断剩余提交遍历。
   */
  it('catches errors in useLayoutEffect', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenUseLayoutEffect>Initial value</BrokenUseLayoutEffect>
        </ErrorBoundary>,
      );
    });
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenUseLayoutEffect render',
      'BrokenUseLayoutEffect useLayoutEffect [!]',
      // Layout Effect 抛错后仍继续当前 layout 遍历，调用父边界的 componentDidMount。
      'ErrorBoundary componentDidMount',
      // 错误会传播到更高层边界。
      'ErrorBoundary static getDerivedStateFromError',
      // 提交后的恢复更新重新渲染捕获错误的边界。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
  });

  /**
   * 内层边界在 didMount 抛错，即使有 renderError prop 也不能捕获自身错误；外层提交 Hello，内层已提交实例被卸载，日志区分原 layout 与恢复更新。
   */
  it('propagates errors inside boundary during componentDidMount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <BrokenComponentDidMountErrorBoundary
            renderError={error => (
              <div>We should never catch our own error: {error.message}.</div>
            )}
          />
        </ErrorBoundary>,
      );
    });
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    assertLog([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentDidMountErrorBoundary constructor',
      'BrokenComponentDidMountErrorBoundary componentWillMount',
      'BrokenComponentDidMountErrorBoundary render success',
      'BrokenComponentDidMountErrorBoundary componentDidMount [!]',
      // 内层 componentDidMount 抛错后仍继续当前 layout 遍历。
      'ErrorBoundary componentDidMount',
      // 错误会传播到更高层边界。
      'ErrorBoundary static getDerivedStateFromError',
      // 提交后的恢复更新重新渲染捕获错误的边界。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'BrokenComponentDidMountErrorBoundary componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /**
   * 两个内边界分别接收 E1/E2 卸载错误和 E3/E4 更新错误；四次派生调用均入日志，各边界最终显示最后一条 E2/E4，验证错误队列不遗漏同批捕获项。
   */
  it('calls static getDerivedStateFromError for each error that is captured', async () => {

    /**
     * 返回带 unmounting 标记的错误文本；同一边界多次派生更新最终以最后一条错误消息呈现。
     */
    function renderUnmountError(error) {
      return <div>Caught an unmounting error: {error.message}.</div>;
    }

    /**
     * 返回带 updating 标记的错误文本，与另一边界的卸载错误分开验证各自捕获队列。
     */
    function renderUpdateError(error) {
      return <div>Caught an updating error: {error.message}.</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary logName="OuterErrorBoundary">
          <ErrorBoundary
            logName="InnerUnmountBoundary"
            renderError={renderUnmountError}>
            <BrokenComponentWillUnmount errorText="E1" />
            <BrokenComponentWillUnmount errorText="E2" />
          </ErrorBoundary>
          <ErrorBoundary
            logName="InnerUpdateBoundary"
            renderError={renderUpdateError}>
            <BrokenComponentDidUpdate errorText="E3" />
            <BrokenComponentDidUpdate errorText="E4" />
          </ErrorBoundary>
        </ErrorBoundary>,
      );
    });

    Scheduler.unstable_clearLog();
    await act(async () => {
      root.render(
        <ErrorBoundary logName="OuterErrorBoundary">
          <ErrorBoundary
            logName="InnerUnmountBoundary"
            renderError={renderUnmountError}
          />
          <ErrorBoundary
            logName="InnerUpdateBoundary"
            renderError={renderUpdateError}>
            <BrokenComponentDidUpdate errorText="E3" />
            <BrokenComponentDidUpdate errorText="E4" />
          </ErrorBoundary>
        </ErrorBoundary>,
      );
    });

    expect(container.firstChild.textContent).toBe(
      'Caught an unmounting error: E2.' + 'Caught an updating error: E4.',
    );
    assertLog([
      // 开始更新阶段
      'OuterErrorBoundary componentWillReceiveProps',
      'OuterErrorBoundary componentWillUpdate',
      'OuterErrorBoundary render success',
      'InnerUnmountBoundary componentWillReceiveProps',
      'InnerUnmountBoundary componentWillUpdate',
      'InnerUnmountBoundary render success',
      'InnerUpdateBoundary componentWillReceiveProps',
      'InnerUpdateBoundary componentWillUpdate',
      'InnerUpdateBoundary render success',
      // 首先，更新。
      'BrokenComponentDidUpdate componentWillReceiveProps',
      'BrokenComponentDidUpdate componentWillUpdate',
      'BrokenComponentDidUpdate render',
      'BrokenComponentDidUpdate componentWillReceiveProps',
      'BrokenComponentDidUpdate componentWillUpdate',
      'BrokenComponentDidUpdate render',
      // 进入提交阶段，开始执行删除。
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 尽管有错误仍继续提交，等提交结束后再处理它们。
      'InnerUnmountBoundary componentDidUpdate',
      // 我们仍在提交阶段，现在调用更新生命周期方法。
      'BrokenComponentDidUpdate componentDidUpdate [!]',
      // 即使再次出错也继续执行，稍后再处理这些错误。
      'BrokenComponentDidUpdate componentDidUpdate [!]',
      'InnerUpdateBoundary componentDidUpdate',
      'OuterErrorBoundary componentDidUpdate',
      // 提交阶段结束后，尝试从此前捕获的所有错误中恢复。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary static getDerivedStateFromError',
      'InnerUnmountBoundary componentWillUpdate',
      'InnerUnmountBoundary render error',
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary static getDerivedStateFromError',
      'InnerUpdateBoundary componentWillUpdate',
      'InnerUpdateBoundary render error',
      'BrokenComponentDidUpdate componentWillUnmount',
      'BrokenComponentDidUpdate componentWillUnmount',
      'InnerUnmountBoundary componentDidUpdate',
      'InnerUpdateBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog([
      'OuterErrorBoundary componentWillUnmount',
      'InnerUnmountBoundary componentWillUnmount',
      'InnerUpdateBoundary componentWillUnmount',
    ]);
  });

  /**
   * 分别把 null、undefined 当组件类型挂到新根；await act 拒绝各自完整的 invalid element type 错误，覆盖 HostRoot 无有效组件可恢复的入口失败。
   */
  it('discards a bad root if the root component fails', async () => {
    const X = null;
    const Y = undefined;

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(async () => {
        root.render(<X />);
      });
    }).rejects.toThrow(
      'Element type is invalid: ' +
        'expected a string (for built-in components) or a ' +
        'class/function (for composite components) but got: null.',
    );

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(async () => {
        root.render(<Y />);
      });
    }).rejects.toThrow(
      'Element type is invalid: ' +
        'expected a string (for built-in components) or a ' +
        'class/function (for composite components) but got: undefined.',
    );
  });

  /**
   * NoopErrorBoundary 派生不返回恢复状态且继续渲染 BrokenRender；await act 拒绝 Hello，整个根连 sibling 也为空，日志显示无有效回退时错误上升到根。
   */
  it('renders empty output if error boundary does not handle the error', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await expect(async () => {
      await act(async () => {
        root.render(
          <div>
            Sibling
            <NoopErrorBoundary>
              <BrokenRender />
            </NoopErrorBoundary>
          </div>,
        );
      });
    }).rejects.toThrow('Hello');

    expect(container.innerHTML).toBe('');
    assertLog([
      'NoopErrorBoundary constructor',
      'NoopErrorBoundary componentWillMount',
      'NoopErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // Noop 错误边界会重试渲染，并再次失败。
      'NoopErrorBoundary static getDerivedStateFromError',
      'NoopErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 错误重试日志
      'NoopErrorBoundary constructor',
      'NoopErrorBoundary componentWillMount',
      'NoopErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'NoopErrorBoundary static getDerivedStateFromError',
      'NoopErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
    ]);
  });

  /**
   * 无边界 Parent/Child 的 didMount 各自抛错；错误记录按 child、parent 顺序且 act 抛 AggregateError.errors 含两条消息，证明提交继续收集后续错误。
   */
  it('passes an aggregate error when two errors happen in commit', async () => {
    const errors = [];
    let caughtError;

    /**
     * 无边界的父提交故障夹具；其 Child 先 didMount，再由父 didMount 抛错，用于验证聚合顺序。
     */
    class Parent extends React.Component {

      /**
       * 返回 Child，使 layout 提交按子先父后访问两个故障点。
       */
      render() {
        return <Child />;
      }

      /**
       * 先向 errors 追加 parent sad 再抛同消息错误；无返回值，act 应在 child 错误后继续收集此错误。
       */
      componentDidMount() {
        errors.push('parent sad');
        throw new Error('parent sad');
      }
    }

    /**
     * 父提交故障夹具的子节点；以自己的 didMount 错误建立聚合列表的首项。
     */
    class Child extends React.Component {

      /**
       * 返回可挂载的 div，确保错误发生在 layout didMount 而非 render。
       */
      render() {
        return <div />;
      }

      /**
       * 先记录 child sad 再抛同消息错误；后续父 didMount 仍应执行并加入聚合结果。
       */
      componentDidMount() {
        errors.push('child sad');
        throw new Error('child sad');
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    try {
      // 这里测试不存在错误边界、因而委托给 host root 的行为。
      await act(async () => {
        root.render(<Parent />);
      });
    } catch (e) {
      caughtError = e;
    }

    expect(errors).toEqual(['child sad', 'parent sad']);
    expect(caughtError.errors).toEqual([
      expect.objectContaining({message: 'child sad'}),
      expect.objectContaining({message: 'parent sad'}),
    ]);
  });

  /**
   * 标题写 unbatched，但正文实际在 unstable_batchedUpdates 内 await act 首挂 Foo；断言异步结果拒绝 foo error，证明这条实际调用路径不吞无边界 render 错误。
   */
  it('propagates uncaught error inside unbatched initial mount', async () => {

    /**
     * render 立即抛 foo error；供实际 batchedUpdates/act 入口验证无边界异步拒绝。
     */
    function Foo() {
      throw new Error('foo error');
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await ReactDOM.unstable_batchedUpdates(async () => {
        await act(async () => {
          root.render(<Foo />);
        });
      });
    }).rejects.toThrow('foo error');
  });

  /**
   * Parent/Child 首挂成功，再改 value 触发两个 getSnapshotBeforeUpdate 抛错；记录与 AggregateError.errors 都按 child、parent，覆盖 before-mutation 遍历的错误聚合。
   */
  it('handles errors that occur in before-mutation commit hook', async () => {
    const errors = [];
    let caughtError;

    /**
     * 更新时 snapshot 抛错的父 fixture；初挂不走 snapshot，用 value 变化触发子先父后的 before-mutation 访问。
     */
    class Parent extends React.Component {

      /**
       * 记录 parent sad 后抛同消息错误；before-mutation 遍历仍须收集已先发生的子 snapshot 错误。
       */
      getSnapshotBeforeUpdate() {
        errors.push('parent sad');
        throw new Error('parent sad');
      }

      /**
       * 保留空的更新提交钩子，与 snapshot 成对声明，避免缺失 componentDidUpdate 警告干扰异常聚合。
       */
      componentDidUpdate() {}

      /**
       * 把收到的 props 传给 Child，令 value 更新同时覆盖父子 snapshot 阶段。
       */
      render() {
        return <Child {...this.props} />;
      }
    }

    /**
     * snapshot 故障子 fixture；在父节点之前接受 before-mutation 遍历。
     */
    class Child extends React.Component {

      /**
       * 记录 child sad 后抛同消息错误；父 snapshot 随后仍应执行。
       */
      getSnapshotBeforeUpdate() {
        errors.push('child sad');
        throw new Error('child sad');
      }

      /**
       * 提供与 snapshot 配套的空更新钩子，不加入新的日志或错误。
       */
      componentDidUpdate() {}

      /**
       * 返回 div，首挂正常提交，后续错误仅由 snapshot 触发。
       */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Parent value={1} />);
    });
    try {
      await act(async () => {
        root.render(<Parent value={2} />);
      });
    } catch (e) {
      caughtError = e;
    }

    expect(errors).toEqual(['child sad', 'parent sad']);
    expect(caughtError.errors).toEqual([
      expect.objectContaining({message: 'child sad'}),
      expect.objectContaining({message: 'parent sad'}),
    ]);
  });

  /**
   * 只有 componentDidCatch 且不更新状态的边界接收 Throws；断言 DEV 恢复方法警告及空 DOM，证明仅接住异常而不提供状态恢复不能显示回退。
   */
  it('should warn if an error boundary with only componentDidCatch does not update state', async () => {

    /**
     * 故意不提供恢复状态的错误边界；只实现空 didCatch，以观察警告及空 DOM。
     */
    class InvalidErrorBoundary extends React.Component {

      /**
       * 接受捕获 error/info 但不更新状态；此空回调正是缺少有效回退的测试条件。
       */
      componentDidCatch(error, info) {
        // 此组件未定义 getDerivedStateFromError()，也没有调用 setState()。
        // 因此它会吞掉错误（这很可能并非有意为之）。
      }

      /**
       * 直接返回 children，不根据错误替换输出；实际恢复会移除失败子树并提示开发者。
       */
      render() {
        return this.props.children;
      }
    }

    /**
     * 立即抛 expected，驱动只实现 didCatch 的无效边界进入捕获分支。
     */
    const Throws = () => {
      throw new Error('expected');
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <InvalidErrorBoundary>
          <Throws />
        </InvalidErrorBoundary>,
      );
    });
    assertConsoleErrorDev([
      'InvalidErrorBoundary: Error boundaries should implement getDerivedStateFromError(). ' +
        'In that method, return a state update to display an error message or fallback UI.\n' +
        '    in InvalidErrorBoundary (at **)',
    ]);
    expect(container.textContent).toBe('');
  });

  /**
   * 边界同时定义派生和 didCatch，子节点抛固定 Error 对象；DOM 为 ErrorBoundary，两个方法均取得同一对象，证明 render 恢复和提交报告可共同工作。
   */
  it('should call both componentDidCatch and getDerivedStateFromError if both exist on a component', async () => {
    let componentDidCatchError, getDerivedStateFromErrorError;

    /**
     * 同时实现 render 恢复和提交报告的边界；两条回调各保存 Error 引用供严格 identity 断言。
     */
    class ErrorBoundaryWithBothMethods extends React.Component {

      /**
       * 以 error=null 开始成功分支，派生捕获后改为同一 thrownError 对象。
       */
      state = {error: null};

      /**
       * 保存捕获 error 引用并返回 {error} 状态补丁，使下一次 render 产生回退。
       */
      static getDerivedStateFromError(error) {
        getDerivedStateFromErrorError = error;
        return {error};
      }

      /**
       * 提交捕获报告时保存 error 引用；info 未参与断言，也不再次设置状态。
       */
      componentDidCatch(error, info) {
        componentDidCatchError = error;
      }

      /**
       * error 存在时返回 ErrorBoundary 文本，否则透传 children；用 DOM 证明派生状态生效。
       */
      render() {
        return this.state.error ? 'ErrorBoundary' : this.props.children;
      }
    }

    const thrownError = new Error('expected');

    /**
     * 每次 render 都抛同一 thrownError 实例，供两个边界方法的 identity 比较。
     */
    const Throws = () => {
      throw thrownError;
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundaryWithBothMethods>
          <Throws />
        </ErrorBoundaryWithBothMethods>,
      );
    });
    expect(container.textContent).toBe('ErrorBoundary');
    expect(componentDidCatchError).toBe(thrownError);
    expect(getDerivedStateFromErrorError).toBe(thrownError);
  });

  /**
   * 边界内把 div 放进 void input；HostConfig 完成阶段校验失败，DOM 包含 input is a void element tag 回退，证明捕获不限于组件 render。
   */
  it('should catch errors from invariants in completion phase', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <input>
            <div />
          </input>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain(
      'Caught an error: input is a void element tag',
    );
  });

  /**
   * 子节点先抛 original error，读取内边界 componentDidCatch getter 又抛 gotta catch em all；外层回退显示后一错误，覆盖寻找错误边界时自身访问失败的向上传播。
   */
  it('should catch errors from errors in the throw phase from boundaries', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const thrownError = new Error('original error');

    /**
     * 抛 original error，让 renderer 寻找内层边界并触发其危险 componentDidCatch getter。
     */
    const Throws = () => {
      throw thrownError;
    };

    /**
     * 故意在读取 componentDidCatch 属性时失败的边界候选；外层正常边界应接住新的访问错误。
     */
    class EvilErrorBoundary extends React.Component {

      /**
       * 读取捕获方法即抛 gotta catch em all，而不返回函数；模拟错误处理路径中的再次失败。
       */
      get componentDidCatch() {
        throw new Error('gotta catch em all');
      }

      /**
       * 透传 children，使首个 original error 来自下游 Throws。
       */
      render() {
        return this.props.children;
      }
    }

    await act(async () => {
      root.render(
        <ErrorBoundary>
          <EvilErrorBoundary>
            <Throws />
          </EvilErrorBoundary>
        </ErrorBoundary>,
      );
    });

    expect(container.textContent).toContain(
      'Caught an error: gotta catch em all',
    );
  });

  /**
   * 抛出的对象 stack getter 与组件 displayName getter 都会抛错；act 最终拒绝 gotta catch em all，DOM 仍包含边界回退，验证错误栈生成失败不抹去已提交恢复。
   */
  it('should protect errors from errors in the stack generation', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const evilError = {
      message: 'gotta catch em all',

      /**
       * 读取错误对象的 stack 即抛错，模拟生成诊断信息时的不可信错误对象。
       */
      get stack() {
        throw new Error('gotta catch em all');
      },
    };

    /**
     * 抛出 stack getter 会失败的 evilError 对象，进入边界恢复和诊断栈生成两条路径。
     */
    const Throws = () => {
      throw evilError;
    };
    Object.defineProperty(Throws, 'displayName', {

      /**
       * displayName getter 直接抛错，模拟组件栈命名读取失败，不返回名称。
       */
      get: function () {
        throw new Error('gotta catch em all');
      },
    });

    /**
     * 返回 Throws，为组件栈增加一层包装，并把故障传给外层 ErrorBoundary。
     */
    function Wrapper() {
      return <Throws />;
    }

    await expect(async () => {
      await act(async () => {
        root.render(
          <ErrorBoundary>
            <Wrapper />
          </ErrorBoundary>,
        );
      });
    }).rejects.toThrow('gotta catch em all');

    expect(container.textContent).toContain(
      'Caught an error: gotta catch em all.',
    );
  });

  /**
   * 外层边界内有 sibling 和内层边界，更新删除整个内层；其子 willUnmount 抛 Expected；最终仅 OuterFallback 且日志无 InnerFallback，捕获必须跳过正被删除的边界。
   */
  it('catches errors thrown in componentWillUnmount', async () => {

    /**
     * 用 id/fallbackID 区分内外边界的局部夹具；删除内层时只有仍挂载的外层可恢复。
     */
    class LocalErrorBoundary extends React.Component {

      /**
       * 以 error=null 保留 children；捕获删除错误后保存 Error 以切换 fallbackID。
       */
      state = {error: null};

      /**
       * 记录派生调用并返回 {error}，让仍挂载的边界安排回退 render。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
        return {error};
      }

      /**
       * 从 props 读取 id/fallbackID，出错返回对应 Component，否则返回 children/null；日志直接表明实际捕获层级。
       */
      render() {
        const {children, id, fallbackID} = this.props;
        const {error} = this.state;
        if (error) {
          Scheduler.log(`${id} render error`);
          return <Component id={fallbackID} />;
        }
        Scheduler.log(`${id} render success`);
        return children || null;
      }
    }

    /**
     * 输出 id 的文本 fixture，用 sibling 与 OuterFallback 区分正常与恢复子树。
     */
    class Component extends React.Component {

      /**
       * 记录并返回 props.id，使 DOM 与 Scheduler 日志可同时确认回退身份。
       */
      render() {
        const {id} = this.props;
        Scheduler.log('Component render ' + id);
        return id;
      }
    }

    /**
     * 已挂载后卸载抛错的 fixture；放进将被整个删除的内边界，检验错误捕获是否跳过该边界。
     */
    class LocalBrokenComponentWillUnmount extends React.Component {

      /**
       * 卸载时记录故障并抛 Expected；不终止祖先删除清理，由仍挂载的祖先恢复。
       */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillUnmount componentWillUnmount');
        throw Error('Expected');
      }

      /**
       * 首挂返回 broken 文本并记录日志，使故障只发生在后续删除阶段。
       */
      render() {
        Scheduler.log('BrokenComponentWillUnmount render');
        return 'broken';
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(async () => {
      root.render(
        <LocalErrorBoundary id="OuterBoundary" fallbackID="OuterFallback">
          <Component id="sibling" />
          <LocalErrorBoundary id="InnerBoundary" fallbackID="InnerFallback">
            <LocalBrokenComponentWillUnmount />
          </LocalErrorBoundary>
        </LocalErrorBoundary>,
      );
    });

    expect(container.firstChild.textContent).toBe('sibling');
    expect(container.lastChild.textContent).toBe('broken');
    assertLog([
      'OuterBoundary render success',
      'Component render sibling',
      'InnerBoundary render success',
      'BrokenComponentWillUnmount render',
    ]);

    await act(async () => {
      root.render(
        <LocalErrorBoundary id="OuterBoundary" fallbackID="OuterFallback">
          <Component id="sibling" />
        </LocalErrorBoundary>,
      );
    });

    // 应该跳过卸载边界并找到最近的仍然挂载的边界。
    expect(container.firstChild.textContent).toBe('OuterFallback');
    expect(container.lastChild.textContent).toBe('OuterFallback');
    assertLog([
      'OuterBoundary render success',
      'Component render sibling',
      'BrokenComponentWillUnmount componentWillUnmount',
      'ErrorBoundary static getDerivedStateFromError',
      'OuterBoundary render error',
      'Component render OuterFallback',
    ]);
  });

  /**
   * 结构同前例但错误由 callback ref 收到 null 时触发；删除整个内层后 OuterFallback 替换输出，日志记录 ref true→false，证明 detach-ref 错误同样找仍挂载的祖先边界。
   */
  it('catches errors thrown while detaching refs', async () => {

    /**
     * 以 id/fallbackID 区分层级的 ref 错误边界；删除内边界时应由外层回退。
     */
    class LocalErrorBoundary extends React.Component {

      /**
       * error=null 时显示 children，捕获 detach-ref 错误后切换 fallbackID。
       */
      state = {error: null};

      /**
       * 记录并返回捕获 error 状态补丁，使外层边界重新渲染。
       */
      static getDerivedStateFromError(error) {
        Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
        return {error};
      }

      /**
       * 出错返回 fallbackID 对应 Component，正常时返回 children/null；用于判定错误实际由哪层处理。
       */
      render() {
        const {children, id, fallbackID} = this.props;
        const {error} = this.state;
        if (error) {
          Scheduler.log(`${id} render error`);
          return <Component id={fallbackID} />;
        }
        Scheduler.log(`${id} render success`);
        return children || null;
      }
    }

    /**
     * 输出 id 的文本节点，提供 sibling 与 OuterFallback 两种可观察结果。
     */
    class Component extends React.Component {

      /**
       * 记录 props.id 并返回该文本，允许同时核对提交结果与恢复日志。
       */
      render() {
        const {id} = this.props;
        Scheduler.log('Component render ' + id);
        return id;
      }
    }

    /**
     * callback ref 在解绑时抛错的 fixture；初挂接受 DOM，后续删除收到 null 才触发异常。
     */
    class LocalBrokenCallbackRef extends React.Component {

      /**
       * 记录 ref 是否非空；仅 ref===null 时抛 Expected，因此 true→false 日志证明故障来自解绑而非挂接。
       */
      _ref = ref => {
        Scheduler.log('LocalBrokenCallbackRef ref ' + !!ref);
        if (ref === null) {
          throw Error('Expected');
        }
      };

      /**
       * 返回带稳定 _ref 回调的 div 文本 ref；删除时 HostComponent 会把 null 传给该回调。
       */
      render() {
        Scheduler.log('LocalBrokenCallbackRef render');
        return <div ref={this._ref}>ref</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(async () => {
      root.render(
        <LocalErrorBoundary id="OuterBoundary" fallbackID="OuterFallback">
          <Component id="sibling" />
          <LocalErrorBoundary id="InnerBoundary" fallbackID="InnerFallback">
            <LocalBrokenCallbackRef />
          </LocalErrorBoundary>
        </LocalErrorBoundary>,
      );
    });

    expect(container.firstChild.textContent).toBe('sibling');
    expect(container.lastChild.textContent).toBe('ref');
    assertLog([
      'OuterBoundary render success',
      'Component render sibling',
      'InnerBoundary render success',
      'LocalBrokenCallbackRef render',
      'LocalBrokenCallbackRef ref true',
    ]);

    await act(async () => {
      root.render(
        <LocalErrorBoundary id="OuterBoundary" fallbackID="OuterFallback">
          <Component id="sibling" />
        </LocalErrorBoundary>,
      );
    });

    // 应该跳过卸载边界并找到最近的仍然挂载的边界。
    expect(container.firstChild.textContent).toBe('OuterFallback');
    expect(container.lastChild.textContent).toBe('OuterFallback');
    assertLog([
      'OuterBoundary render success',
      'Component render sibling',
      'LocalBrokenCallbackRef ref false',
      'ErrorBoundary static getDerivedStateFromError',
      'OuterBoundary render error',
      'Component render OuterFallback',
    ]);
  });
});
