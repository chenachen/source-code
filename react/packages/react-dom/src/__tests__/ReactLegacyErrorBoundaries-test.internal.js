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
let act;
let assertConsoleErrorDev;

// TODO：componentDidCatch 中的 setState 弃用后，重构此测试。
describe('ReactLegacyErrorBoundaries', () => {
  let log;

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
  let ErrorBoundary;
  let BothErrorBoundaries;
  let ErrorMessage;
  let NoopErrorBoundary;
  let RetryErrorBoundary;
  let Normal;

  beforeEach(() => {
    jest.resetModules();
    PropTypes = require('prop-types');
    ReactDOM = require('react-dom');
    React = require('react');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    log = [];

    /**
     * 构造器抛 Hello 的故障组件；其他生命周期日志用于确认失败后哪些阶段不会发生。
     */
    BrokenConstructor = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；立即抛 Hello，实例不会完成构造或提交。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        log.push('BrokenConstructor constructor [!]');
        throw new Error('Hello');
      }

      /**
       * 记录 BrokenConstructor 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenConstructor render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenConstructor 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenConstructor componentWillMount');
      }

      /**
       * 把 BrokenConstructor 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenConstructor componentDidMount');
      }

      /**
       * 把 BrokenConstructor 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenConstructor componentWillReceiveProps');
      }

      /**
       * 把 BrokenConstructor 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenConstructor componentWillUpdate');
      }

      /**
       * 把 BrokenConstructor 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenConstructor componentDidUpdate');
      }

      /**
       * 把 BrokenConstructor 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenConstructor componentWillUnmount');
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
        log.push('BrokenComponentWillMount constructor');
      }

      /**
       * 记录 BrokenComponentWillMount 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenComponentWillMount render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 记录 BrokenComponentWillMount 在首次 render 前的旧式挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillMount componentWillMount [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillMount 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenComponentWillMount componentDidMount');
      }

      /**
       * 把 BrokenComponentWillMount 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentWillMount componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentWillMount 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillMount componentWillUpdate');
      }

      /**
       * 把 BrokenComponentWillMount 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenComponentWillMount componentDidUpdate');
      }

      /**
       * 把 BrokenComponentWillMount 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentWillMount componentWillUnmount');
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
        log.push('BrokenComponentDidMount constructor');
      }

      /**
       * 记录 BrokenComponentDidMount 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenComponentDidMount render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentDidMount 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentDidMount componentWillMount');
      }

      /**
       * 记录 BrokenComponentDidMount 在layout 提交中的挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentDidMount() {
        log.push('BrokenComponentDidMount componentDidMount [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentDidMount 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentDidMount componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentDidMount 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentDidMount componentWillUpdate');
      }

      /**
       * 把 BrokenComponentDidMount 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenComponentDidMount componentDidUpdate');
      }

      /**
       * 把 BrokenComponentDidMount 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentDidMount componentWillUnmount');
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
        log.push('BrokenComponentWillReceiveProps constructor');
      }

      /**
       * 记录 BrokenComponentWillReceiveProps 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenComponentWillReceiveProps render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillReceiveProps componentWillMount');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenComponentWillReceiveProps componentDidMount');
      }

      /**
       * 记录 BrokenComponentWillReceiveProps 在接收新 props 的更新 render 阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push(
          'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
        );
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillReceiveProps componentWillUpdate');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenComponentWillReceiveProps componentDidUpdate');
      }

      /**
       * 把 BrokenComponentWillReceiveProps 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentWillReceiveProps componentWillUnmount');
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
        log.push('BrokenComponentWillUpdate constructor');
      }

      /**
       * 记录 BrokenComponentWillUpdate 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenComponentWillUpdate render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentWillUpdate 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillUpdate componentWillMount');
      }

      /**
       * 把 BrokenComponentWillUpdate 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenComponentWillUpdate componentDidMount');
      }

      /**
       * 把 BrokenComponentWillUpdate 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentWillUpdate componentWillReceiveProps');
      }

      /**
       * 记录 BrokenComponentWillUpdate 在更新 render 前的旧式阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillUpdate componentWillUpdate [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillUpdate 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenComponentWillUpdate componentDidUpdate');
      }

      /**
       * 把 BrokenComponentWillUpdate 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentWillUpdate componentWillUnmount');
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
        log.push('BrokenComponentDidUpdate constructor');
      }

      /**
       * 记录 BrokenComponentDidUpdate 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenComponentDidUpdate render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentDidUpdate 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentDidUpdate componentWillMount');
      }

      /**
       * 把 BrokenComponentDidUpdate 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenComponentDidUpdate componentDidMount');
      }

      /**
       * 把 BrokenComponentDidUpdate 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentDidUpdate componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentDidUpdate 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentDidUpdate componentWillUpdate');
      }

      /**
       * 记录 BrokenComponentDidUpdate 在layout 提交中的更新阶段的故障，再抛 props.errorText；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentDidUpdate() {
        log.push('BrokenComponentDidUpdate componentDidUpdate [!]');
        throw new Error(this.props.errorText);
      }

      /**
       * 把 BrokenComponentDidUpdate 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentDidUpdate componentWillUnmount');
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
        log.push('BrokenComponentWillUnmount constructor');
      }

      /**
       * 记录 BrokenComponentWillUnmount 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push('BrokenComponentWillUnmount render');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentWillUnmount 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillUnmount componentWillMount');
      }

      /**
       * 把 BrokenComponentWillUnmount 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenComponentWillUnmount componentDidMount');
      }

      /**
       * 把 BrokenComponentWillUnmount 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentWillUnmount componentWillReceiveProps');
      }

      /**
       * 把 BrokenComponentWillUnmount 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillUnmount componentWillUpdate');
      }

      /**
       * 把 BrokenComponentWillUnmount 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenComponentWillUnmount componentDidUpdate');
      }

      /**
       * 记录 BrokenComponentWillUnmount 在删除已提交实例的清理阶段的故障，再抛 props.errorText；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentWillUnmount() {
        log.push('BrokenComponentWillUnmount componentWillUnmount [!]');
        throw new Error(this.props.errorText);
      }
    };

    /**
     * 虽提供componentDidCatch 恢复状态却在自身 willMount 抛错的边界；证明边界不能捕获自己的初始化错误。
     */
    BrokenComponentWillMountErrorBoundary = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push('BrokenComponentWillMountErrorBoundary constructor');
      }

      /**
       * error 存在时返回错误消息 div，否则包住 children；自身生命周期抛错不能由自己的componentDidCatch 捕获。
       */
      render() {
        if (this.state.error) {
          log.push('BrokenComponentWillMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        log.push('BrokenComponentWillMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 记录 BrokenComponentWillMountErrorBoundary 在首次 render 前的旧式挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      UNSAFE_componentWillMount() {
        log.push(
          'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
        );
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentWillMountErrorBoundary 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenComponentWillMountErrorBoundary componentDidMount');
      }

      /**
       * 把 BrokenComponentWillMountErrorBoundary 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentWillMountErrorBoundary componentWillUnmount');
      }

      /**
       * 提交捕获回调接收 error，记录并 setState({error})；下一次更新由 render 返回回退，不能捕获自身生命周期或回退 render 的错误。
       */
      componentDidCatch(error) {
        log.push('BrokenComponentWillMountErrorBoundary componentDidCatch');
        this.setState({error});
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
        log.push('BrokenComponentDidMountErrorBoundary constructor');
      }

      /**
       * error 存在时返回错误消息 div，否则包住 children；自身生命周期抛错不能由自己的componentDidCatch 捕获。
       */
      render() {
        if (this.state.error) {
          log.push('BrokenComponentDidMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        log.push('BrokenComponentDidMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenComponentDidMountErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentDidMountErrorBoundary componentWillMount');
      }

      /**
       * 记录 BrokenComponentDidMountErrorBoundary 在layout 提交中的挂载阶段的故障，再抛 Hello；由父边界或根处理，不能依赖后续本实例代码继续执行。
       */
      componentDidMount() {
        log.push('BrokenComponentDidMountErrorBoundary componentDidMount [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenComponentDidMountErrorBoundary 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenComponentDidMountErrorBoundary componentWillUnmount');
      }

      /**
       * 提交捕获回调接收 error，记录并 setState({error})；下一次更新由 render 返回回退，不能捕获自身生命周期或回退 render 的错误。
       */
      componentDidCatch(error) {
        log.push('BrokenComponentDidMountErrorBoundary componentDidCatch');
        this.setState({error});
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
        log.push('BrokenRenderErrorBoundary constructor');
      }

      /**
       * error 存在时记录回退 render 并再次抛 Hello，否则返回 children 的 div；自身回退错误必须交给外层边界。
       */
      render() {
        if (this.state.error) {
          log.push('BrokenRenderErrorBoundary render error [!]');
          throw new Error('Hello');
        }
        log.push('BrokenRenderErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 BrokenRenderErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenRenderErrorBoundary componentWillMount');
      }

      /**
       * 把 BrokenRenderErrorBoundary 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenRenderErrorBoundary componentDidMount');
      }

      /**
       * 把 BrokenRenderErrorBoundary 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenRenderErrorBoundary componentWillUnmount');
      }

      /**
       * 提交捕获回调接收 error，记录并 setState({error})；下一次更新由 render 返回回退，不能捕获自身生命周期或回退 render 的错误。
       */
      componentDidCatch(error) {
        log.push('BrokenRenderErrorBoundary componentDidCatch');
        this.setState({error});
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
        log.push('BrokenRender constructor');
      }

      /**
       * 记录 render 故障并抛 Hello；不返回 UI，父边界或 HostRoot 必须恢复。
       */
      render() {
        log.push('BrokenRender render [!]');
        throw new Error('Hello');
      }

      /**
       * 把 BrokenRender 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BrokenRender componentWillMount');
      }

      /**
       * 把 BrokenRender 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BrokenRender componentDidMount');
      }

      /**
       * 把 BrokenRender 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenRender componentWillReceiveProps');
      }

      /**
       * 把 BrokenRender 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenRender componentWillUpdate');
      }

      /**
       * 把 BrokenRender 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BrokenRender componentDidUpdate');
      }

      /**
       * 把 BrokenRender 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BrokenRender componentWillUnmount');
      }
    };

    /**
     * 仅记录 didCatch、不更新状态的无效恢复边界；失败 children 被置空，但边界外 sibling 保留，用来观察警告与实际输出。
     */
    NoopErrorBoundary = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        log.push('NoopErrorBoundary constructor');
      }

      /**
       * 始终返回 BrokenRender；本 fixture 的 didCatch 没有建立有效回退，具体捕获结果由用例断言区分。
       */
      render() {
        log.push('NoopErrorBoundary render');
        return <BrokenRender />;
      }

      /**
       * 把 NoopErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('NoopErrorBoundary componentWillMount');
      }

      /**
       * 把 NoopErrorBoundary 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('NoopErrorBoundary componentDidMount');
      }

      /**
       * 把 NoopErrorBoundary 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('NoopErrorBoundary componentWillUnmount');
      }

      /**
       * 只记录捕获，不设置状态也不返回回退；因此失败 children 被置空并触发缺少恢复状态的 DEV 警告。
       */
      componentDidCatch() {
        log.push('NoopErrorBoundary componentDidCatch');
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
        log.push(`${this.props.logName} constructor`);
      }

      /**
       * 记录 Normal 的 render，并返回包住 props.children 的 div；不在此处抛错，测试由指定生命周期制造故障。
       */
      render() {
        log.push(`${this.props.logName} render`);
        return <div>{this.props.children}</div>;
      }

      /**
       * 把 Normal 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push(`${this.props.logName} componentWillMount`);
      }

      /**
       * 把 Normal 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push(`${this.props.logName} componentDidMount`);
      }

      /**
       * 把 Normal 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push(`${this.props.logName} componentWillReceiveProps`);
      }

      /**
       * 把 Normal 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push(`${this.props.logName} componentWillUpdate`);
      }

      /**
       * 把 Normal 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push(`${this.props.logName} componentDidUpdate`);
      }

      /**
       * 把 Normal 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push(`${this.props.logName} componentWillUnmount`);
      }
    };

    /**
     * 旧式错误边界；componentDidCatch 在提交后 setState({error})，renderError 显示回退，forceRetry 显式绕过错误态，日志核对两次提交及清理。
     */
    ErrorBoundary = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push(`${this.props.logName} constructor`);
      }

      /**
       * error 存在且未 forceRetry 时把 error/props 传给 renderError 返回回退；否则返回包含 children 的 div。状态保留到测试显式重试，不会仅因 children 改变自动清除。
       */
      render() {
        if (this.state.error && !this.props.forceRetry) {
          log.push(`${this.props.logName} render error`);
          return this.props.renderError(this.state.error, this.props);
        }
        log.push(`${this.props.logName} render success`);
        return <div>{this.props.children}</div>;
      }

      /**
       * 提交捕获回调接收 error，记录并 setState({error})；下一次更新由 render 返回回退，不能捕获自身生命周期或回退 render 的错误。
       */
      componentDidCatch(error) {
        log.push(`${this.props.logName} componentDidCatch`);
        this.setState({error});
      }

      /**
       * 把 ErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push(`${this.props.logName} componentWillMount`);
      }

      /**
       * 把 ErrorBoundary 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push(`${this.props.logName} componentDidMount`);
      }

      /**
       * 把 ErrorBoundary 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push(`${this.props.logName} componentWillReceiveProps`);
      }

      /**
       * 把 ErrorBoundary 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push(`${this.props.logName} componentWillUpdate`);
      }

      /**
       * 把 ErrorBoundary 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push(`${this.props.logName} componentDidUpdate`);
      }

      /**
       * 把 ErrorBoundary 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push(`${this.props.logName} componentWillUnmount`);
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
     * 同时提供派生状态恢复和提交后 didCatch 的测试边界；两者都保存 error，日志用来核对首个回退与后续捕获更新。
     */
    BothErrorBoundaries = class extends React.Component {

      /**
       * 初始化 error=null 的成功状态，再记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push('BothErrorBoundaries constructor');
      }

      /**
       * 记录捕获并返回 {error} 状态补丁；React 在恢复 render 前合并，使 render 能选择回退；error 为当前捕获对象。
       */
      static getDerivedStateFromError(error) {
        log.push('BothErrorBoundaries static getDerivedStateFromError');
        return {error};
      }

      /**
       * error 存在时返回 Hello 等错误消息 div，否则承载 children；派生方法可在首个恢复 render 生效，didCatch 又追加同一错误状态。
       */
      render() {
        if (this.state.error) {
          log.push('BothErrorBoundaries render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        log.push('BothErrorBoundaries render success');
        return <div>{this.props.children}</div>;
      }

      /**
       * 提交捕获回调接收 error，记录并 setState({error})；下一次更新由 render 返回回退，不能捕获自身生命周期或回退 render 的错误。
       */
      componentDidCatch(error) {
        log.push('BothErrorBoundaries componentDidCatch');
        this.setState({error});
      }

      /**
       * 把 BothErrorBoundaries 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('BothErrorBoundaries componentWillMount');
      }

      /**
       * 把 BothErrorBoundaries 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('BothErrorBoundaries componentDidMount');
      }

      /**
       * 把 BothErrorBoundaries 在接收新 props 的更新 render 阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('BothErrorBoundaries componentWillReceiveProps');
      }

      /**
       * 把 BothErrorBoundaries 在更新 render 前的旧式阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillUpdate() {
        log.push('BothErrorBoundaries componentWillUpdate');
      }

      /**
       * 把 BothErrorBoundaries 在layout 提交中的更新阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidUpdate() {
        log.push('BothErrorBoundaries componentDidUpdate');
      }

      /**
       * 把 BothErrorBoundaries 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('BothErrorBoundaries componentWillUnmount');
      }
    };

    /**
     * didCatch 仅 setState({}) 的旧式重试边界；仍返回 BrokenRender，恢复再次失败并向外层传播。
     */
    RetryErrorBoundary = class extends React.Component {

      /**
       * 调用 super(props) 后记录构造日志；供断言区别新建实例与仅更新已有实例。 参数 props 交由 React.Component 保存。
       */
      constructor(props) {
        super(props);
        log.push('RetryErrorBoundary constructor');
      }

      /**
       * 始终返回 BrokenRender；本 fixture 的 didCatch 没有建立有效回退，具体捕获结果由用例断言区分。
       */
      render() {
        log.push('RetryErrorBoundary render');
        return <BrokenRender />;
      }

      /**
       * 把 RetryErrorBoundary 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('RetryErrorBoundary componentWillMount');
      }

      /**
       * 把 RetryErrorBoundary 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('RetryErrorBoundary componentDidMount');
      }

      /**
       * 把 RetryErrorBoundary 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('RetryErrorBoundary componentWillUnmount');
      }

      /**
       * 接收捕获 error，记录后 setState({})；空补丁不更换 BrokenRender，下一轮失败必须交给外层边界。
       */
      componentDidCatch(error) {
        log.push('RetryErrorBoundary componentDidCatch [!]');
        // 空状态补丁不更换失败输出，下一轮仍抛错，随后由外层边界接手。
        this.setState({});
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
        log.push('ErrorMessage constructor');
      }

      /**
       * 把 ErrorMessage 在首次 render 前的旧式挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      UNSAFE_componentWillMount() {
        log.push('ErrorMessage componentWillMount');
      }

      /**
       * 把 ErrorMessage 在layout 提交中的挂载阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentDidMount() {
        log.push('ErrorMessage componentDidMount');
      }

      /**
       * 把 ErrorMessage 在删除已提交实例的清理阶段的访问记入 log 数组；无状态更新或返回值，让测试根据日志确认实际执行阶段及错误后是否继续遍历。
       */
      componentWillUnmount() {
        log.push('ErrorMessage componentWillUnmount');
      }

      /**
       * 记录回退 render 并返回 props.message 的错误文本 div；didMount 日志另外证明这份候选输出真正提交。
       */
      render() {
        log.push('ErrorMessage render');
        return <div>Caught an error: {this.props.message}.</div>;
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  /**
   * 在 legacy gate 启用时，分别以 ReactDOM.render 初挂 render/willMount/didMount 抛错组件；await act 全部拒绝 Hello，覆盖无边界 render 与提交异常。
   */

  // @gate !disableLegacyMode

  it('does not swallow exceptions on mounting without boundaries', async () => {
    let container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenRender />, container);
      });
    }).rejects.toThrow('Hello');

    container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenComponentWillMount />, container);
      });
    }).rejects.toThrow('Hello');

    container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenComponentDidMount />, container);
      });
    }).rejects.toThrow('Hello');
  });
  /**
   * 先通过 ReactDOM.render 成功挂载，再分别更新触发 willUpdate/willReceiveProps/didUpdate 错误；await act 均拒绝 Hello，证明旧入口也报告更新错误。
   */

  // @gate !disableLegacyMode

  it('does not swallow exceptions on updating without boundaries', async () => {
    let container = document.createElement('div');
    ReactDOM.render(<BrokenComponentWillUpdate />, container);
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenComponentWillUpdate />, container);
      });
    }).rejects.toThrow('Hello');

    container = document.createElement('div');
    ReactDOM.render(<BrokenComponentWillReceiveProps />, container);
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenComponentWillReceiveProps />, container);
      });
    }).rejects.toThrow('Hello');

    container = document.createElement('div');
    ReactDOM.render(<BrokenComponentDidUpdate />, container);
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenComponentDidUpdate />, container);
      });
    }).rejects.toThrow('Hello');
  });
  /**
   * 先提交卸载抛错节点，再 unmountComponentAtNode；await act 拒绝 Hello，覆盖旧根删除阶段的异常出口。
   */

  // @gate !disableLegacyMode

  it('does not swallow exceptions on unmounting without boundaries', async () => {
    const container = document.createElement('div');
    ReactDOM.render(<BrokenComponentWillUnmount />, container);
    await expect(async () => {
      await act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
    }).rejects.toThrow('Hello');
  });
  /**
   * 三个独立根分别正常、无边界失败、有边界失败；失败后前根保持 Before 1、第二根为空、第三根为回退；再分别更新到 After 1/2/3 并卸载，证明根之间错误状态隔离且各自可继续使用。
   */

  // @gate !disableLegacyMode

  it('prevents errors from leaking into other roots', async () => {
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');
    const container3 = document.createElement('div');

    ReactDOM.render(<span>Before 1</span>, container1);
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<BrokenRender />, container2);
      });
    }).rejects.toThrow('Hello');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
      container3,
    );
    expect(container1.firstChild.textContent).toBe('Before 1');
    expect(container2.firstChild).toBe(null);
    expect(container3.firstChild.textContent).toBe('Caught an error: Hello.');

    ReactDOM.render(<span>After 1</span>, container1);
    ReactDOM.render(<span>After 2</span>, container2);
    ReactDOM.render(
      <ErrorBoundary forceRetry={true}>After 3</ErrorBoundary>,
      container3,
    );
    expect(container1.firstChild.textContent).toBe('After 1');
    expect(container2.firstChild.textContent).toBe('After 2');
    expect(container3.firstChild.textContent).toBe('After 3');

    ReactDOM.unmountComponentAtNode(container1);
    ReactDOM.unmountComponentAtNode(container2);
    ReactDOM.unmountComponentAtNode(container3);
    expect(container1.firstChild).toBe(null);
    expect(container2.firstChild).toBe(null);
    expect(container3.firstChild).toBe(null);
  });
  /**
   * BothErrorBoundaries 同时使用派生方法与 didCatch；子 render 抛错后 DOM 为 Hello，两方法均记录；DEV console.error 两次分别是 legacy render 弃用提示和一条捕获错误报告。
   */

  // @gate !disableLegacyMode

  it('logs a single error using both error boundaries', () => {
    const container = document.createElement('div');
    spyOnDev(console, 'error');
    ReactDOM.render(
      <BothErrorBoundaries>
        <BrokenRender />
      </BothErrorBoundaries>,
      container,
    );
    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(2);
      expect(console.error.mock.calls[0][0]).toContain(
        'ReactDOM.render has not been supported since React 18',
      );
      expect(console.error.mock.calls[1][2]).toContain(
        'The above error occurred in the <BrokenRender> component',
      );
    }

    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'BothErrorBoundaries constructor',
      'BothErrorBoundaries componentWillMount',
      'BothErrorBoundaries render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 派生方法先生成回退状态；didCatch 稍后在提交中接收同一错误。
      'BothErrorBoundaries static getDerivedStateFromError',
      'BothErrorBoundaries componentWillMount',
      'BothErrorBoundaries render error',
      // 派生状态产生的回退已提交；随后 didCatch 再安排一次状态更新。
      'BothErrorBoundaries componentDidMount',
      // 捕获并渲染错误消息
      'BothErrorBoundaries componentDidCatch',
      'BothErrorBoundaries componentWillUpdate',
      'BothErrorBoundaries render error',
      'BothErrorBoundaries componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['BothErrorBoundaries componentWillUnmount']);
  });
  /**
   * 边界内 BrokenRender 首挂抛 Hello；旧式 didCatch 边界先提交空 children，再在 didCatch 设置状态，更新提交 Hello 回退；最后仅边界卸载。
   */

  // @gate !disableLegacyMode

  it('renders an error state if child throws in render', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // Fiber 在捕获错误前先以 null 子节点完成挂载。
      'ErrorBoundary componentDidMount',
      // 捕获并渲染错误消息
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 边界内构造器抛 Hello；子实例未完成初始化，边界先提交空 children 再由 didCatch 设置 error，DOM 为 Hello，日志不含失败子实例的卸载。
   */

  // @gate !disableLegacyMode

  it('renders an error state if child throws in constructor', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenConstructor />
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenConstructor constructor [!]',
      // Fiber 在捕获错误前先以 null 子节点完成挂载。
      'ErrorBoundary componentDidMount',
      // 捕获并渲染错误消息
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 边界内 willMount 抛 Hello；先以空 children 完成边界挂载，再 didCatch 安排回退更新，最终 Hello；未提交子实例不执行卸载。
   */

  // @gate !disableLegacyMode

  it('renders an error state if child throws in componentWillMount', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentWillMount />
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillMount constructor',
      'BrokenComponentWillMount componentWillMount [!]',
      'ErrorBoundary componentDidMount',
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * legacy Context provider 在 willMount 抛 Hello；受 gate 控制的配置下断言 legacy API 警告和边界错误文本，证明 provider 初始化错误也向父边界传播。
   */

  // @gate !disableLegacyContext || !__DEV__
  // @gate !disableLegacyMode

  it('renders an error state if context provider throws in componentWillMount', () => {

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
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentWillMountWithContext />
      </ErrorBoundary>,
      container,
    );
    assertConsoleErrorDev([
      'BrokenComponentWillMountWithContext uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in BrokenComponentWillMountWithContext (at **)',
    ]);
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
  });
  /**
   * 自定义 renderError 返回有生命周期日志的 ErrorMessage；子 render 失败后，边界先 didMount/didCatch，再回退组件首次挂载；根清理依次卸载边界与回退。
   */

  // @gate !disableLegacyMode

  it('mounts the error message if mounting fails', () => {

    /**
     * 把捕获 Error.message 传给 ErrorMessage，返回有完整挂载/卸载日志的回退组件；借此区别回退 render 尝试与真正提交。
     */
    function renderError(error) {
      return <ErrorMessage message={error.message} />;
    }

    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary renderError={renderError}>
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      'ErrorBoundary componentDidMount',
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorMessage constructor',
      'ErrorMessage componentWillMount',
      'ErrorMessage render',
      'ErrorMessage componentDidMount',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual([
      'ErrorBoundary componentWillUnmount',
      'ErrorMessage componentWillUnmount',
    ]);
  });
  /**
   * RetryErrorBoundary 的 didCatch 仅 setState({})，恢复仍返回 BrokenRender；再次失败后内边界被卸载，外层 didCatch 提交 Hello，日志证明该无效重试不会吞掉错误。
   */

  // @gate !disableLegacyMode

  it('propagates errors on retry on mounting', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <RetryErrorBoundary>
          <BrokenRender />
        </RetryErrorBoundary>
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'RetryErrorBoundary constructor',
      'RetryErrorBoundary componentWillMount',
      'RetryErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 在 Fiber 中，失败的错误边界会在尝试恢复前渲染 null。
      'RetryErrorBoundary componentDidMount',
      'RetryErrorBoundary componentDidCatch [!]',
      'ErrorBoundary componentDidMount',
      // 重试
      'RetryErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 这一次，错误会传播到更高层边界。
      'RetryErrorBoundary componentWillUnmount',
      'ErrorBoundary componentDidCatch',
      // 渲染错误
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 内层边界自身 willMount 抛 Hello；外层先以空 children 挂载，再 didCatch 设置 error 并提交回退，内层自己的捕获方法不会接住自身初始化故障。
   */

  // @gate !disableLegacyMode

  it('propagates errors inside boundary during componentWillMount', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentWillMountErrorBoundary />
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentWillMountErrorBoundary constructor',
      'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
      // 错误会传播到更高层边界。
      'ErrorBoundary componentDidMount',
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 内层 didCatch 保存 error，但下一轮回退 render 又抛 Hello；已挂载内层被卸载，外层 didCatch 更新为 Hello，日志核对逐层传播与清理。
   */

  // @gate !disableLegacyMode

  it('propagates errors inside boundary while rendering error state', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenRenderErrorBoundary>
          <BrokenRender />
        </BrokenRenderErrorBoundary>
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRenderErrorBoundary constructor',
      'BrokenRenderErrorBoundary componentWillMount',
      'BrokenRenderErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 第一个错误边界捕获错误；它调整状态，但在显示消息时再次抛错，最终以 null 子节点完成挂载。
      'BrokenRenderErrorBoundary componentDidMount',
      // 试图处理错误
      'BrokenRenderErrorBoundary componentDidCatch',
      'ErrorBoundary componentDidMount',
      'BrokenRenderErrorBoundary render error [!]',
      // 当前边界以新错误失败，继续传播到下一层边界。
      'BrokenRenderErrorBoundary componentWillUnmount',
      // 再次尝试处理错误。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 正常 sibling 后跟 BrokenRender 和另一个正常 sibling；初挂 render 被中止后只提交边界回退，日志没有任何未提交子组件的 didMount 或 willUnmount。
   */

  // @gate !disableLegacyMode

  it('does not call componentWillUnmount when aborting initial mount', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenRender />
        <Normal />
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
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
      // 跳过剩余 sibling，然后以 null 子节点完成挂载。
      'ErrorBoundary componentDidMount',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 初挂包含 callback ref 节点及 BrokenRender；失败子树的 ref 从未挂接，只有错误回退 ref 获得 DOM；卸载时回退 ref 收到 null，避免把中止 render 误当成已提交挂载。
   */

  // @gate !disableLegacyMode

  it('resets callback refs if mounting aborts', () => {

    /**
     * 记录失败子树 ref 的 DOM/null 参数；初挂中止时应完全没有这条日志，因为 ref 只在提交时挂接。
     */
    function childRef(x) {
      log.push('Child ref is set to ' + x);
    }

    /**
     * 记录回退 ref 收到的 DOM 或卸载 null；日志用于证明成功提交的回退拥有独立 ref 生命周期。
     */
    function errorMessageRef(x) {
      log.push('Error message ref is set to ' + x);
    }

    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary errorMessageRef={errorMessageRef}>
        <div ref={childRef} />
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 处理错误：完成挂载 null 子元素
      'ErrorBoundary componentDidMount',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Error message ref is set to [object HTMLDivElement]',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual([
      'ErrorBoundary componentWillUnmount',
      'Error message ref is set to null',
    ]);
  });
  /**
   * 初挂包含对象 ref 和 BrokenRender；断言回退 ref 指向 HTMLDivElement、根卸载后变 null；日志只提交边界，不把未提交子树当成需卸载的实例。
   */

  // @gate !disableLegacyMode

  it('resets object refs if mounting aborts', () => {
    const childRef = React.createRef();
    const errorMessageRef = React.createRef();

    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary errorMessageRef={errorMessageRef}>
        <div ref={childRef} />
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 处理错误：完成挂载 null 子元素
      'ErrorBoundary componentDidMount',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);
    expect(errorMessageRef.current.toString()).toEqual(
      '[object HTMLDivElement]',
    );

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
    expect(errorMessageRef.current).toEqual(null);
  });
  /**
   * 边界内只放正常文本；首挂直接提交 Mounted successfully，日志无捕获分支，卸载正常清理边界，作为异常路径的成功对照。
   */

  // @gate !disableLegacyMode

  it('successfully mounts if no error occurs', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <div>Mounted successfully.</div>
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Mounted successfully.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'ErrorBoundary componentDidMount',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先提交 Normal，再添加 Normal2 与构造器抛错节点；旧 Normal 在空 children 恢复提交时卸载，随后 didCatch 提交回退；新 Normal2 未提交，不能执行卸载。
   */

  // @gate !disableLegacyMode

  it('catches if child throws in constructor during update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <Normal logName="Normal2" />
        <BrokenConstructor />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
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
      // 完成更新，使用 null 子元素。
      'Normal componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先提交 Normal，再添加 Normal2 与 willMount 抛错节点；错误恢复先清理旧 Normal，再由 didCatch 设置错误回退，新建候选节点不会被误当成已提交实例清理。
   */

  // @gate !disableLegacyMode

  it('catches if child throws in componentWillMount during update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <Normal logName="Normal2" />
        <BrokenComponentWillMount />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
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
      // 完成更新，使用 null 子元素。
      'Normal componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      // 渲染错误消息
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 已有 Normal 与 willReceiveProps 抛错节点，再次渲染同结构；旧子实例均被删除，边界先 didUpdate 后 didCatch，再提交 Hello，覆盖更新 render 错误的提交后恢复。
   */

  // @gate !disableLegacyMode

  it('catches if child throws in componentWillReceiveProps during update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenComponentWillReceiveProps />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenComponentWillReceiveProps />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
        // BrokenComponentWillReceiveProps 会中止渲染：
      'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
      // 完成更新，使用 null 子元素。
      'Normal componentWillUnmount',
      'BrokenComponentWillReceiveProps componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 已挂载 Normal 与 willUpdate 抛错节点，更新触发错误；断言 Hello，日志证明先清理旧子树、完成原边界 didUpdate，再 didCatch 安排回退。
   */

  // @gate !disableLegacyMode

  it('catches if child throws in componentWillUpdate during update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenComponentWillUpdate />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenComponentWillUpdate />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'Normal componentWillReceiveProps',
      'Normal componentWillUpdate',
      'Normal render',
      // BrokenComponentWillUpdate 将中断渲染：
      'BrokenComponentWillUpdate componentWillReceiveProps',
      'BrokenComponentWillUpdate componentWillUpdate [!]',
      // 完成更新，使用 null 子元素。
      'Normal componentWillUnmount',
      'BrokenComponentWillUpdate componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先提交 Normal，再添加 Normal2 与 BrokenRender；失败候选中止，已提交 Normal 被删除，didCatch 随后提交 Hello；未提交的新增实例没有卸载日志。
   */

  // @gate !disableLegacyMode

  it('catches if child throws in render during update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <Normal logName="Normal2" />
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
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
      // 完成更新，使用 null 子元素。
      'Normal componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先挂接 Child1 callback ref，再新增 Child2 与抛错节点；原 Child1 ref 先收到 null，didCatch 恢复后回退 ref 得到 DOM，Child2 从未挂接；卸载回退 ref 再收到 null。
   */

  // @gate !disableLegacyMode

  it('keeps refs up-to-date during updates', () => {

    /**
     * 记录已提交 Child1 ref 的 DOM/null；更新失败删除旧节点时必须收到 null。
     */
    function child1Ref(x) {
      log.push('Child1 ref is set to ' + x);
    }

    /**
     * 记录本轮新 Child2 ref 的 DOM/null；失败 render 未提交时不应调用该回调。
     */
    function child2Ref(x) {
      log.push('Child2 ref is set to ' + x);
    }

    /**
     * 记录错误回退 ref 挂接与卸载清空，和 Child1 的清理日志共同验证提交顺序。
     */
    function errorMessageRef(x) {
      log.push('Error message ref is set to ' + x);
    }

    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary errorMessageRef={errorMessageRef}>
        <div ref={child1Ref} />
      </ErrorBoundary>,
      container,
    );
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'Child1 ref is set to [object HTMLDivElement]',
      'ErrorBoundary componentDidMount',
    ]);

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary errorMessageRef={errorMessageRef}>
        <div ref={child1Ref} />
        <div ref={child2Ref} />
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      // BrokenRender 将中断渲染：
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 完成更新，使用 null 子元素。
      'Child1 ref is set to null',
      'ErrorBoundary componentDidUpdate',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'Error message ref is set to [object HTMLDivElement]',
      // 由于其挂载中断, Child2 ref 永远不会设置
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual([
      'ErrorBoundary componentWillUnmount',
      'Error message ref is set to null',
    ]);
  });
  /**
   * 已提交两个卸载抛错节点和 Normal，更新删去后两项；提交遍历继续完成其余生命周期，随后边界恢复再删除剩余抛错节点并再次捕获，最终 DOM 为 Hello。
   */

  // @gate !disableLegacyMode

  it('recovers from componentWillUnmount errors on update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentWillUnmount />
        <BrokenComponentWillUnmount />
        <Normal />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentWillUnmount />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
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
      // 提交阶段结束后，Fiber 会卸载该边界的子节点。
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      'ErrorBoundary componentDidCatch',
      // 捕获回调安排边界恢复更新；本轮子树清理又产生错误，下一次捕获仍需继续处理。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      // 两次提交错误均已交给 didCatch；现在把其状态更新提交为错误回退。
      'ErrorBoundary render error',
      // 尝试卸载上一个子组件：成功卸载。
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 嵌套 Normal 内含卸载抛错节点，旁边还有同类节点；删除旁节点触发恢复，再清理嵌套旧子树产生第二次错误；日志证明清理继续、每次错误均被处理。
   */

  // @gate !disableLegacyMode

  it('recovers from nested componentWillUnmount errors on update', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal>
          <BrokenComponentWillUnmount />
        </Normal>
        <BrokenComponentWillUnmount />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <Normal>
          <BrokenComponentWillUnmount />
        </Normal>
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
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
      'Normal componentWillUnmount',
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 提交阶段完成后，Fiber 开始处理错误。
      'ErrorBoundary componentDidCatch',
      // 捕获回调安排边界恢复更新；本轮子树清理又产生错误，下一次捕获仍需继续处理。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      // 两次提交错误均已交给 didCatch；现在把其状态更新提交为错误回退。
      'ErrorBoundary render error',
      // 完成
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 外层与内层边界包裹卸载抛错节点，更新仅移除该节点；最近仍保留的内层边界提交 inner 回退，外层只参与原更新，不再为错误恢复重渲染。
   */

  // @gate !disableLegacyMode

  it('picks the right boundary when handling unmounting errors', () => {

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
    ReactDOM.render(
      <ErrorBoundary
        logName="OuterErrorBoundary"
        renderError={renderOuterError}>
        <ErrorBoundary
          logName="InnerErrorBoundary"
          renderError={renderInnerError}>
          <BrokenComponentWillUnmount />
        </ErrorBoundary>
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary
        logName="OuterErrorBoundary"
        renderError={renderOuterError}>
        <ErrorBoundary
          logName="InnerErrorBoundary"
          renderError={renderInnerError}
        />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an inner error: Hello.');
    expect(log).toEqual([
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
      // 尽管有错误，Fiber 仍继续执行生命周期；内外边界都已在此阶段更新。
      'InnerErrorBoundary componentDidUpdate',
      'OuterErrorBoundary componentDidUpdate',
      // 提交阶段结束后，Fiber 开始处理错误；只有内层边界会收到该错误：
      'InnerErrorBoundary componentDidCatch',
      'InnerErrorBoundary componentWillUpdate',
      // 此时渲染一个错误。
      'InnerErrorBoundary render error',
      // 在 Fiber 中，这是内层边界的局部更新，因此只触发它自己的 Hook。
      'InnerErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual([
      'OuterErrorBoundary componentWillUnmount',
      'InnerErrorBoundary componentWillUnmount',
    ]);
  });
  /**
   * 先进入错误态，直接换成 Normal 仍保留 Hello；设置 forceRetry 才走成功分支并挂载 Normal；证明是否重试由本 fixture 的状态/prop 协议控制，最后正常清理。
   */

  // @gate !disableLegacyMode

  it('can recover from error state', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );

    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
      </ErrorBoundary>,
      container,
    );
    // 错误边界不会自动重试：
    expect(container.textContent).toBe('Caught an error: Hello.');

    // 强制成功路径：
    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary forceRetry={true}>
        <Normal />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).not.toContain('Caught an error');
    expect(log).toEqual([
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

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual([
      'ErrorBoundary componentWillUnmount',
      'Normal componentWillUnmount',
    ]);
  });
  /**
   * 进入错误态后重复提交相同失败 children 仍保持回退，再替换整个边界为 Other screen；断言两次错误文本与最终普通输出，验证错误态可以继续更新和被移除。
   */

  // @gate !disableLegacyMode

  it('can update multiple times in error state', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');

    ReactDOM.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');

    ReactDOM.render(<div>Other screen</div>, container);
    expect(container.textContent).toBe('Other screen');

    ReactDOM.unmountComponentAtNode(container);
  });
  /**
   * 已提交 Normal、卸载抛错节点、Normal 后删去全部 children；边界恢复为 Hello，最后卸载只清理边界，验证删除中异常不残留失效子树。
   */

  // @gate !disableLegacyMode

  it("doesn't get into inconsistent state during removals", () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenComponentWillUnmount />
        <Normal />
      </ErrorBoundary>,
      container,
    );

    ReactDOM.render(<ErrorBoundary />, container);
    expect(container.textContent).toBe('Caught an error: Hello.');

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先提交空边界，再添加正常/抛错/正常节点；失败后 DOM 为 Hello，最后只卸载边界，验证新增 render 中止不会留下需清理的子实例。
   */

  // @gate !disableLegacyMode

  it("doesn't get into inconsistent state during additions", () => {
    const container = document.createElement('div');
    ReactDOM.render(<ErrorBoundary />, container);
    ReactDOM.render(
      <ErrorBoundary>
        <Normal />
        <BrokenRender />
        <Normal />
      </ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 随机重排 100 个 keyed Normal 与一个可抛错节点；先成功挂载，再开启 fail 重排；最终提交 Hello 且卸载只剩边界，验证错误恢复不依赖 sibling 的原排列。
   */

  // @gate !disableLegacyMode

  it("doesn't get into inconsistent state during reorders", () => {

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
    ReactDOM.render(
      <ErrorBoundary>{getAMixOfNormalAndBrokenRenderElements()}</ErrorBoundary>,
      container,
    );
    expect(container.textContent).not.toContain('Caught an error');

    fail = true;
    ReactDOM.render(
      <ErrorBoundary>{getAMixOfNormalAndBrokenRenderElements()}</ErrorBoundary>,
      container,
    );
    expect(container.textContent).toBe('Caught an error: Hello.');

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先挂载 Stateful 并取得实例，设置闭包 fail 后 forceUpdate；调用不抛，日志确实包含子 render 故障、父 didCatch 和回退更新，证明实例发起的下游更新也走祖先边界。
   */

  // @gate !disableLegacyMode

  it('catches errors originating downstream', () => {
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
       * 读取闭包 fail，开启时记录 render 故障并抛 Hello，否则返回 div；旧根 forceUpdate 同步恢复后，日志验证父 didCatch 与回退更新。
       */
      render() {
        if (fail) {
          log.push('Stateful render [!]');
          throw new Error('Hello');
        }
        return <div>{this.props.children}</div>;
      }
    }

    let statefulInst;
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <Stateful ref={inst => (statefulInst = inst)} />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    expect(() => {
      fail = true;
      statefulInst.forceUpdate();
    }).not.toThrow();

    expect(log).toEqual([
      'Stateful render [!]',
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 首挂中 didMount 抛错且另一个子组件卸载也抛错；日志显示其余 didMount 继续，随后恢复删除所有 children，再捕获卸载错误，最终边界可正常卸载。
   */

  // @gate !disableLegacyMode

  it('catches errors in componentDidMount', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentWillUnmount>
          <Normal />
        </BrokenComponentWillUnmount>
        <BrokenComponentDidMount />
        <Normal logName="LastChild" />
      </ErrorBoundary>,
      container,
    );
    expect(log).toEqual([
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
      'ErrorBoundary componentDidMount',
      // 现在已准备好处理错误，可以安全卸载每个子组件。
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      // 即使发生错误，也继续安全卸载。
      'Normal componentWillUnmount',
      'BrokenComponentDidMount componentWillUnmount',
      'LastChild componentWillUnmount',
      // 处理错误
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      // componentWillUnmount 抛出的错误也应被捕获并记录。
      'ErrorBoundary componentDidUpdate',
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      // 更新已经完成
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 先提交 didUpdate 抛错组件，再更新；子 didUpdate 失败后父 didUpdate 仍执行，随后边界恢复并卸载失败子组件，日志证明提交错误延后处理。
   */

  // @gate !disableLegacyMode

  it('catches errors in componentDidUpdate', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentDidUpdate />
      </ErrorBoundary>,
      container,
    );

    log.length = 0;
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentDidUpdate />
      </ErrorBoundary>,
      container,
    );
    expect(log).toEqual([
      'ErrorBoundary componentWillReceiveProps',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render success',
      'BrokenComponentDidUpdate componentWillReceiveProps',
      'BrokenComponentDidUpdate componentWillUpdate',
      'BrokenComponentDidUpdate render',
      // 所有生命周期方法都运行
      'BrokenComponentDidUpdate componentDidUpdate [!]',
      'ErrorBoundary componentDidUpdate',
      'BrokenComponentDidUpdate componentWillUnmount',
    // 然后处理错误。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 内层边界在 didMount 抛错，即使有 renderError prop 也不能捕获自身错误；外层提交 Hello，内层已提交实例被卸载，日志区分原 layout 与恢复更新。
   */

  // @gate !disableLegacyMode

  it('propagates errors inside boundary during componentDidMount', () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <ErrorBoundary>
        <BrokenComponentDidMountErrorBoundary
          renderError={error => (
            <div>We should never catch our own error: {error.message}.</div>
          )}
        />
      </ErrorBoundary>,
      container,
    );
    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
    expect(log).toEqual([
      'ErrorBoundary constructor',
      'ErrorBoundary componentWillMount',
      'ErrorBoundary render success',
      'BrokenComponentDidMountErrorBoundary constructor',
      'BrokenComponentDidMountErrorBoundary componentWillMount',
      'BrokenComponentDidMountErrorBoundary render success',
      'BrokenComponentDidMountErrorBoundary componentDidMount [!]',
      // Fiber 继续执行 hooks。
      'ErrorBoundary componentDidMount',
      'BrokenComponentDidMountErrorBoundary componentWillUnmount',
      // 错误会传播到更高层边界。
      'ErrorBoundary componentDidCatch',
      // 外层边界的捕获状态更新重新渲染该边界。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });
  /**
   * 两个内边界分别收到 E1/E2 删除错误和 E3/E4 更新错误；日志四次 didCatch，最终分别显示 E2/E4，证明提交捕获的每条错误都会交给对应边界且状态按队列顺序合并。
   */

  // @gate !disableLegacyMode

  it('calls componentDidCatch for each error that is captured', () => {

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
    ReactDOM.render(
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
      container,
    );

    log.length = 0;
    ReactDOM.render(
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
      container,
    );

    expect(container.firstChild.textContent).toBe(
      'Caught an unmounting error: E2.' + 'Caught an updating error: E4.',
    );
    expect(log).toEqual([
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
      'BrokenComponentDidUpdate componentWillUnmount',
      'BrokenComponentDidUpdate componentWillUnmount',
      'InnerUnmountBoundary componentDidCatch',
      'InnerUnmountBoundary componentDidCatch',
      'InnerUpdateBoundary componentDidCatch',
      'InnerUpdateBoundary componentDidCatch',
      'InnerUnmountBoundary componentWillUpdate',
      'InnerUnmountBoundary render error',
      'InnerUpdateBoundary componentWillUpdate',
      'InnerUpdateBoundary render error',
      'InnerUnmountBoundary componentDidUpdate',
      'InnerUpdateBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual([
      'OuterErrorBoundary componentWillUnmount',
      'InnerUnmountBoundary componentWillUnmount',
      'InnerUpdateBoundary componentWillUnmount',
    ]);
  });
  /**
   * null 与 undefined 分别作为组件类型送入 ReactDOM.render；await act 拒绝 got: null/undefined，覆盖旧根入口无有效组件类型时的错误出口。
   */

  // @gate !disableLegacyMode

  it('discards a bad root if the root component fails', async () => {
    const X = null;
    const Y = undefined;

    await expect(async () => {
      const container = document.createElement('div');
      await act(() => {
        ReactDOM.render(<X />, container);
      });
    }).rejects.toThrow('got: null');

    await expect(async () => {
      const container = document.createElement('div');
      await act(() => {
        ReactDOM.render(<Y />, container);
      });
    }).rejects.toThrow('got: undefined');
  });
  /**
   * 标题写 empty output，实际 NoopErrorBoundary 的空 didCatch 只移除失败子树；断言外部 Sibling 保留和 DEV 恢复方法警告，日志没有回退更新，不能把此例讲成整个根被清空。
   */

  // @gate !disableLegacyMode

  it('renders empty output if error boundary does not handle the error', async () => {
    const container = document.createElement('div');
    ReactDOM.render(
      <div>
        Sibling
        <NoopErrorBoundary>
          <BrokenRender />
        </NoopErrorBoundary>
      </div>,
      container,
    );
    assertConsoleErrorDev([
      'NoopErrorBoundary: Error boundaries should implement getDerivedStateFromError(). ' +
        'In that method, return a state update to display an error message or fallback UI.\n' +
        '    in NoopErrorBoundary (at **)',
    ]);
    expect(container.firstChild.textContent).toBe('Sibling');
    expect(log).toEqual([
      'NoopErrorBoundary constructor',
      'NoopErrorBoundary componentWillMount',
      'NoopErrorBoundary render',
      'BrokenRender constructor',
      'BrokenRender componentWillMount',
      'BrokenRender render [!]',
      // 在 Fiber 中，noop 错误边界渲染 null
      'NoopErrorBoundary componentDidMount',
      'NoopErrorBoundary componentDidCatch',
      // 没有任何事情发生。
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['NoopErrorBoundary componentWillUnmount']);
  });
  /**
   * 标题写 first error，实际 Parent/Child didMount 均抛错且 act 拒绝对象的 errors 包含 child sad、parent sad；errors 记录同序，证明提交继续并聚合两个异常。
   */

  // @gate !disableLegacyMode

  it('passes first error when two errors happen in commit', async () => {
    const errors = [];

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
    await expect(async () => {
      await act(() => {
        // 这里测试不存在错误边界、因而委托给 host root 的行为。
        ReactDOM.render(<Parent />, container);
      });
    }).rejects.toThrow(
      expect.objectContaining({
        errors: [
          expect.objectContaining({message: 'child sad'}),
          expect.objectContaining({message: 'parent sad'}),
        ],
      }),
    );

    expect(errors).toEqual(['child sad', 'parent sad']);
  });
  /**
   * 标题写 unbatched，正文是 act 内 unstable_batchedUpdates 调用 ReactDOM.render(Foo)；await act 拒绝 foo error，验证实际批处理路径仍报告未捕获错误。
   */

  // @gate !disableLegacyMode

  it('propagates uncaught error inside unbatched initial mount', async () => {

    /**
     * render 立即抛 foo error；供实际 batchedUpdates/act 入口验证无边界异步拒绝。
     */
    function Foo() {
      throw new Error('foo error');
    }
    const container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.unstable_batchedUpdates(() => {
          ReactDOM.render(<Foo />, container);
        });
      });
    }).rejects.toThrow('foo error');
  });
  /**
   * Parent/Child 首挂成功，value 更新触发两个 snapshot 抛错；act 拒绝对象的 errors 按 child、parent 包含两条消息，独立 errors 日志同序，覆盖 before-mutation 的错误聚合。
   */

  // @gate !disableLegacyMode

  it('handles errors that occur in before-mutation commit hook', async () => {
    const errors = [];

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
    await act(() => {
      ReactDOM.render(<Parent value={1} />, container);
    });

    await expect(async () => {
      await act(() => {
        ReactDOM.render(<Parent value={2} />, container);
      });
    }).rejects.toThrow(
      expect.objectContaining({
        errors: [
          expect.objectContaining({message: 'child sad'}),
          expect.objectContaining({message: 'parent sad'}),
        ],
      }),
    );

    expect(errors).toEqual(['child sad', 'parent sad']);
    // errors 数组同时保留 child 和 parent 的 snapshot 错误，顺序与遍历日志一致。
  });
});
