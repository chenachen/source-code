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

    BrokenConstructor = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenConstructor constructor [!]');
        throw new Error('Hello');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenConstructor render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenConstructor componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenConstructor componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenConstructor componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenConstructor componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenConstructor componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenConstructor componentWillUnmount');
      }
    };

    BrokenComponentWillMount = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillMount constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenComponentWillMount render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillMount componentWillMount [!]');
        throw new Error('Hello');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillMount componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentWillMount componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillMount componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillMount componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillMount componentWillUnmount');
      }
    };

    BrokenComponentDidMount = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentDidMount constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenComponentDidMount render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentDidMount componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenComponentDidMount componentDidMount [!]');
        throw new Error('Hello');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentDidMount componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentDidMount componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentDidMount componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentDidMount componentWillUnmount');
      }
    };

    BrokenComponentWillReceiveProps = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillReceiveProps constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenComponentWillReceiveProps render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillReceiveProps componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillReceiveProps componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log(
          'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
        );
        throw new Error('Hello');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillReceiveProps componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillReceiveProps componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillReceiveProps componentWillUnmount');
      }
    };

    BrokenComponentWillUpdate = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillUpdate constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenComponentWillUpdate render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillUpdate componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillUpdate componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentWillUpdate componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillUpdate componentWillUpdate [!]');
        throw new Error('Hello');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillUpdate componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillUpdate componentWillUnmount');
      }
    };

    BrokenComponentDidUpdate = class extends React.Component {
      /** `defaultProps`：记录测试夹具在当前场景中的状态。 */
      static defaultProps = {
        errorText: 'Hello',
      };
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentDidUpdate constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenComponentDidUpdate render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentDidUpdate componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenComponentDidUpdate componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentDidUpdate componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentDidUpdate componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentDidUpdate componentDidUpdate [!]');
        throw new Error(this.props.errorText);
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentDidUpdate componentWillUnmount');
      }
    };

    BrokenComponentWillUnmount = class extends React.Component {
      /** `defaultProps`：记录测试夹具在当前场景中的状态。 */
      static defaultProps = {
        errorText: 'Hello',
      };
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenComponentWillUnmount constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenComponentWillUnmount render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenComponentWillUnmount componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenComponentWillUnmount componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenComponentWillUnmount componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenComponentWillUnmount componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenComponentWillUnmount componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillUnmount componentWillUnmount [!]');
        throw new Error(this.props.errorText);
      }
    };

    BrokenComponentWillMountErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log('BrokenComponentWillMountErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          Scheduler.log('BrokenComponentWillMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        Scheduler.log('BrokenComponentWillMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
        );
        throw new Error('Hello');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary componentDidMount',
        );
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary componentWillUnmount',
        );
      }
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log(
          'BrokenComponentWillMountErrorBoundary static getDerivedStateFromError',
        );
        return {error};
      }
    };

    BrokenComponentDidMountErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log('BrokenComponentDidMountErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          Scheduler.log('BrokenComponentDidMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        Scheduler.log('BrokenComponentDidMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary componentWillMount',
        );
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary componentDidMount [!]',
        );
        throw new Error('Hello');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary componentWillUnmount',
        );
      }
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log(
          'BrokenComponentDidMountErrorBoundary static getDerivedStateFromError',
        );
        return {error};
      }
    };

    BrokenRenderErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log('BrokenRenderErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          Scheduler.log('BrokenRenderErrorBoundary render error [!]');
          throw new Error('Hello');
        }
        Scheduler.log('BrokenRenderErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenRenderErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenRenderErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenRenderErrorBoundary componentWillUnmount');
      }
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log(
          'BrokenRenderErrorBoundary static getDerivedStateFromError',
        );
        return {error};
      }
    };

    BrokenRender = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('BrokenRender constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('BrokenRender render [!]');
        throw new Error('Hello');
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('BrokenRender componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('BrokenRender componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('BrokenRender componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('BrokenRender componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('BrokenRender componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenRender componentWillUnmount');
      }
    };

    BrokenUseEffect = ({children}) => {
      Scheduler.log('BrokenUseEffect render');

      React.useEffect(() => {
        Scheduler.log('BrokenUseEffect useEffect [!]');
        throw new Error('Hello');
      });

      return children;
    };

    BrokenUseLayoutEffect = ({children}) => {
      Scheduler.log('BrokenUseLayoutEffect render');

      React.useLayoutEffect(() => {
        Scheduler.log('BrokenUseLayoutEffect useLayoutEffect [!]');
        throw new Error('Hello');
      });

      return children;
    };

    NoopErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('NoopErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('NoopErrorBoundary render');
        return <BrokenRender />;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('NoopErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('NoopErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('NoopErrorBoundary componentWillUnmount');
      }
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError() {
        Scheduler.log('NoopErrorBoundary static getDerivedStateFromError');
      }
    };

    Normal = class extends React.Component {
      /** `defaultProps`：记录测试夹具在当前场景中的状态。 */
      static defaultProps = {
        logName: 'Normal',
      };
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log(`${this.props.logName} constructor`);
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log(`${this.props.logName} render`);
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(`${this.props.logName} componentWillMount`);
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(`${this.props.logName} componentDidMount`);
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log(`${this.props.logName} componentWillReceiveProps`);
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log(`${this.props.logName} componentWillUpdate`);
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log(`${this.props.logName} componentDidUpdate`);
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(`${this.props.logName} componentWillUnmount`);
      }
    };

    ErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        Scheduler.log(`${this.props.logName} constructor`);
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error && !this.props.forceRetry) {
          Scheduler.log(`${this.props.logName} render error`);
          return this.props.renderError(this.state.error, this.props);
        }
        Scheduler.log(`${this.props.logName} render success`);
        return <div>{this.props.children}</div>;
      }
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log('ErrorBoundary static getDerivedStateFromError');
        return {error};
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(`${this.props.logName} componentWillMount`);
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(`${this.props.logName} componentDidMount`);
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log(`${this.props.logName} componentWillReceiveProps`);
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log(`${this.props.logName} componentWillUpdate`);
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log(`${this.props.logName} componentDidUpdate`);
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(`${this.props.logName} componentWillUnmount`);
      }
    };
    ErrorBoundary.defaultProps = {
      logName: 'ErrorBoundary',
      /** `renderError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      renderError(error, props) {
        return (
          <div ref={props.errorMessageRef}>
            Caught an error: {error.message}.
          </div>
        );
      },
    };

    RetryErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('RetryErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('RetryErrorBoundary render');
        return <BrokenRender />;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('RetryErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('RetryErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('RetryErrorBoundary componentWillUnmount');
      }
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log('RetryErrorBoundary static getDerivedStateFromError [!]');
        // 在 Fiber 中，调用 setState()（并失败）被视为重新抛出。
        return {};
      }
    };

    ErrorMessage = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('ErrorMessage constructor');
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('ErrorMessage componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('ErrorMessage componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('ErrorMessage componentWillUnmount');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('ErrorMessage render');
        return <div>Caught an error: {this.props.message}.</div>;
      }
    };
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「does not swallow exceptions on mounting without boundaries」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
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

  /** 测试场景：验证「does not swallow exceptions on updating without boundaries」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「does not swallow exceptions on unmounting without boundaries」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「prevents errors from leaking into other roots」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「logs a single error when using error boundary」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「renders an error state if child throws in render」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「renders an error state if child throws in constructor」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「renders an error state if child throws in componentWillMount」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyContext || !__DEV__
  /** 测试场景：验证「renders an error state if context provider throws in componentWillMount」描述的渲染、交互或错误处理结果。 */
  it('renders an error state if context provider throws in componentWillMount', async () => {
    /** `BrokenComponentWillMountWithContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class BrokenComponentWillMountWithContext extends React.Component {
      /** `BrokenComponentWillMountWithContext.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {foo: PropTypes.number};
      /** `BrokenComponentWillMountWithContext.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {foo: 42};
      }
      /** `BrokenComponentWillMountWithContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
      /** `BrokenComponentWillMountWithContext.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「mounts the error message if mounting fails」描述的渲染、交互或错误处理结果。 */
  it('mounts the error message if mounting fails', async () => {
    /** `renderError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「propagates errors on retry on mounting」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「propagates errors inside boundary during componentWillMount」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「propagates errors inside boundary while rendering error state」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「does not call componentWillUnmount when aborting initial mount」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「resets callback refs if mounting aborts」描述的渲染、交互或错误处理结果。 */
  it('resets callback refs if mounting aborts', async () => {
    /** `childRef`：封装当前用例复用的操作、回调或断言步骤。 */
    function childRef(x) {
      Scheduler.log('Child ref is set to ' + x);
    }
    /** `errorMessageRef`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「resets object refs if mounting aborts」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「successfully mounts if no error occurs」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches if child throws in constructor during update」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches if child throws in componentWillMount during update」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches if child throws in componentWillReceiveProps during update」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches if child throws in componentWillUpdate during update」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches if child throws in render during update」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「keeps refs up-to-date during updates」描述的渲染、交互或错误处理结果。 */
  it('keeps refs up-to-date during updates', async () => {
    /** `child1Ref`：封装当前用例复用的操作、回调或断言步骤。 */
    function child1Ref(x) {
      Scheduler.log('Child1 ref is set to ' + x);
    }
    /** `child2Ref`：封装当前用例复用的操作、回调或断言步骤。 */
    function child2Ref(x) {
      Scheduler.log('Child2 ref is set to ' + x);
    }
    /** `errorMessageRef`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「recovers from componentWillUnmount errors on update」描述的渲染、交互或错误处理结果。 */
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
      // 初始渲染被中止了，因此 Fiber 从根节点重新尝试。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'BrokenComponentWillUnmount componentWillUnmount [!]',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary static getDerivedStateFromError',
      'ErrorBoundary componentWillUpdate',
      // 现在渲染错误（Stack 实现稍后才会这样做）。
      'ErrorBoundary render error',
      // 尝试卸载上一个子节点：完成。
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /** 测试场景：验证「recovers from nested componentWillUnmount errors on update」描述的渲染、交互或错误处理结果。 */
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
      // 现在渲染错误（Stack 实现稍后才会这样做）。
      'ErrorBoundary render error',
      // 完成
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /** 测试场景：验证「picks the right boundary when handling unmounting errors」描述的渲染、交互或错误处理结果。 */
  it('picks the right boundary when handling unmounting errors', async () => {
    /** `renderInnerError`：封装当前用例复用的操作、回调或断言步骤。 */
    function renderInnerError(error) {
      return <div>Caught an inner error: {error.message}.</div>;
    }
    /** `renderOuterError`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // 在 Fiber 中，这是内层边界的局部更新，因此只触发它自己的 Hook。
      'InnerErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog([
      'OuterErrorBoundary componentWillUnmount',
      'InnerErrorBoundary componentWillUnmount',
    ]);
  });

  /** 测试场景：验证「can recover from error state」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「can update multiple times in error state」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「doesn't get into inconsistent state during removals」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「doesn't get into inconsistent state during additions」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「doesn't get into inconsistent state during reorders」描述的渲染、交互或错误处理结果。 */
  it("doesn't get into inconsistent state during reorders", async () => {
    /** `getAMixOfNormalAndBrokenRenderElements`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `MaybeBrokenRender`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MaybeBrokenRender extends React.Component {
      /** `MaybeBrokenRender.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「catches errors originating downstream」描述的渲染、交互或错误处理结果。 */
  it('catches errors originating downstream', async () => {
    let fail = false;
    /** `Stateful`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Stateful extends React.Component {
      /** `Stateful.state`：记录测试夹具在当前场景中的状态。 */
      state = {shouldThrow: false};

      /** `Stateful.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「catches errors in componentDidMount」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches errors in componentDidUpdate」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「catches errors in useEffect」描述的渲染、交互或错误处理结果。 */
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
      // 错误重试日志
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

  /** 测试场景：验证「catches errors in useLayoutEffect」描述的渲染、交互或错误处理结果。 */
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
      // Fiber 继续执行 hooks。
      'ErrorBoundary componentDidMount',
      // 错误会传播到更高层边界。
      'ErrorBoundary static getDerivedStateFromError',
      // Fiber 从 root 重新尝试。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    expect(container.firstChild.textContent).toBe('Caught an error: Hello.');
  });

  /** 测试场景：验证「propagates errors inside boundary during componentDidMount」描述的渲染、交互或错误处理结果。 */
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
      // Fiber 继续执行 hooks。
      'ErrorBoundary componentDidMount',
      // 错误会传播到更高层边界。
      'ErrorBoundary static getDerivedStateFromError',
      // Fiber 从 root 重新尝试。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'BrokenComponentDidMountErrorBoundary componentWillUnmount',
      'ErrorBoundary componentDidUpdate',
    ]);

    root.unmount();
    assertLog(['ErrorBoundary componentWillUnmount']);
  });

  /** 测试场景：验证「calls static getDerivedStateFromError for each error that is captured」描述的渲染、交互或错误处理结果。 */
  it('calls static getDerivedStateFromError for each error that is captured', async () => {
    /** `renderUnmountError`：封装当前用例复用的操作、回调或断言步骤。 */
    function renderUnmountError(error) {
      return <div>Caught an unmounting error: {error.message}.</div>;
    }
    /** `renderUpdateError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「discards a bad root if the root component fails」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「renders empty output if error boundary does not handle the error」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「passes an aggregate error when two errors happen in commit」描述的渲染、交互或错误处理结果。 */
  it('passes an aggregate error when two errors happen in commit', async () => {
    const errors = [];
    let caughtError;
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child />;
      }
      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        errors.push('parent sad');
        throw new Error('parent sad');
      }
    }
    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「propagates uncaught error inside unbatched initial mount」描述的渲染、交互或错误处理结果。 */
  it('propagates uncaught error inside unbatched initial mount', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「handles errors that occur in before-mutation commit hook」描述的渲染、交互或错误处理结果。 */
  it('handles errors that occur in before-mutation commit hook', async () => {
    const errors = [];
    let caughtError;
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {
        errors.push('parent sad');
        throw new Error('parent sad');
      }
      /** `Parent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child {...this.props} />;
      }
    }
    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {
        errors.push('child sad');
        throw new Error('child sad');
      }
      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should warn if an error boundary with only componentDidCatch does not update state」描述的渲染、交互或错误处理结果。 */
  it('should warn if an error boundary with only componentDidCatch does not update state', async () => {
    /** `InvalidErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class InvalidErrorBoundary extends React.Component {
      /** `InvalidErrorBoundary.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error, info) {
        // 此组件未定义 getDerivedStateFromError()，也没有调用 setState()。
        // 因此它会吞掉错误（这很可能并非有意为之）。
      }
      /** `InvalidErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.children;
      }
    }

    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should call both componentDidCatch and getDerivedStateFromError if both exist on a component」描述的渲染、交互或错误处理结果。 */
  it('should call both componentDidCatch and getDerivedStateFromError if both exist on a component', async () => {
    let componentDidCatchError, getDerivedStateFromErrorError;
    /** `ErrorBoundaryWithBothMethods`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundaryWithBothMethods extends React.Component {
      /** `ErrorBoundaryWithBothMethods.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundaryWithBothMethods.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        getDerivedStateFromErrorError = error;
        return {error};
      }
      /** `ErrorBoundaryWithBothMethods.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error, info) {
        componentDidCatchError = error;
      }
      /** `ErrorBoundaryWithBothMethods.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.state.error ? 'ErrorBoundary' : this.props.children;
      }
    }

    const thrownError = new Error('expected');
    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should catch errors from invariants in completion phase」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should catch errors from errors in the throw phase from boundaries」描述的渲染、交互或错误处理结果。 */
  it('should catch errors from errors in the throw phase from boundaries', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const thrownError = new Error('original error');
    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
    const Throws = () => {
      throw thrownError;
    };

    /** `EvilErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class EvilErrorBoundary extends React.Component {
      /** `EvilErrorBoundary.componentDidCatch`：保存当前测试场景复用的夹具、状态或回调。 */
      get componentDidCatch() {
        throw new Error('gotta catch em all');
      }
      /** `EvilErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should protect errors from errors in the stack generation」描述的渲染、交互或错误处理结果。 */
  it('should protect errors from errors in the stack generation', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const evilError = {
      message: 'gotta catch em all',
      /** `stack`：保存当前测试场景复用的夹具、状态或回调。 */
      get stack() {
        throw new Error('gotta catch em all');
      },
    };
    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
    const Throws = () => {
      throw evilError;
    };
    Object.defineProperty(Throws, 'displayName', {
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
      get: function () {
        throw new Error('gotta catch em all');
      },
    });

    /** `Wrapper`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「catches errors thrown in componentWillUnmount」描述的渲染、交互或错误处理结果。 */
  it('catches errors thrown in componentWillUnmount', async () => {
    /** `LocalErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LocalErrorBoundary extends React.Component {
      /** `LocalErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `LocalErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
        return {error};
      }
      /** `LocalErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {id} = this.props;
        Scheduler.log('Component render ' + id);
        return id;
      }
    }

    /** `LocalBrokenComponentWillUnmount`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LocalBrokenComponentWillUnmount extends React.Component {
      /** `LocalBrokenComponentWillUnmount.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log('BrokenComponentWillUnmount componentWillUnmount');
        throw Error('Expected');
      }

      /** `LocalBrokenComponentWillUnmount.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「catches errors thrown while detaching refs」描述的渲染、交互或错误处理结果。 */
  it('catches errors thrown while detaching refs', async () => {
    /** `LocalErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LocalErrorBoundary extends React.Component {
      /** `LocalErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `LocalErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
        return {error};
      }
      /** `LocalErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {id} = this.props;
        Scheduler.log('Component render ' + id);
        return id;
      }
    }

    /** `LocalBrokenCallbackRef`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LocalBrokenCallbackRef extends React.Component {
      /** `LocalBrokenCallbackRef._ref`：封装当前用例复用的操作、回调或断言步骤。 */
      _ref = ref => {
        Scheduler.log('LocalBrokenCallbackRef ref ' + !!ref);
        if (ref === null) {
          throw Error('Expected');
        }
      };

      /** `LocalBrokenCallbackRef.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
