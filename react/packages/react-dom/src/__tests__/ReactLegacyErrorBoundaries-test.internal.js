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

    BrokenConstructor = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('BrokenConstructor constructor [!]');
        throw new Error('Hello');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenConstructor render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenConstructor componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenConstructor componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenConstructor componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenConstructor componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenConstructor componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenConstructor componentWillUnmount');
      }
    };

    BrokenComponentWillMount = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('BrokenComponentWillMount constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenComponentWillMount render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillMount componentWillMount [!]');
        throw new Error('Hello');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentWillMount componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentWillMount componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillMount componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenComponentWillMount componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentWillMount componentWillUnmount');
      }
    };

    BrokenComponentDidMount = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('BrokenComponentDidMount constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenComponentDidMount render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentDidMount componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentDidMount componentDidMount [!]');
        throw new Error('Hello');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentDidMount componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentDidMount componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenComponentDidMount componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentDidMount componentWillUnmount');
      }
    };

    BrokenComponentWillReceiveProps = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('BrokenComponentWillReceiveProps constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenComponentWillReceiveProps render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillReceiveProps componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentWillReceiveProps componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push(
          'BrokenComponentWillReceiveProps componentWillReceiveProps [!]',
        );
        throw new Error('Hello');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillReceiveProps componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenComponentWillReceiveProps componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentWillReceiveProps componentWillUnmount');
      }
    };

    BrokenComponentWillUpdate = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('BrokenComponentWillUpdate constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenComponentWillUpdate render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillUpdate componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentWillUpdate componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentWillUpdate componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillUpdate componentWillUpdate [!]');
        throw new Error('Hello');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenComponentWillUpdate componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentWillUpdate componentWillUnmount');
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
        log.push('BrokenComponentDidUpdate constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenComponentDidUpdate render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentDidUpdate componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentDidUpdate componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentDidUpdate componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentDidUpdate componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenComponentDidUpdate componentDidUpdate [!]');
        throw new Error(this.props.errorText);
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentDidUpdate componentWillUnmount');
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
        log.push('BrokenComponentWillUnmount constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenComponentWillUnmount render');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentWillUnmount componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentWillUnmount componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenComponentWillUnmount componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenComponentWillUnmount componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenComponentWillUnmount componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentWillUnmount componentWillUnmount [!]');
        throw new Error(this.props.errorText);
      }
    };

    BrokenComponentWillMountErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push('BrokenComponentWillMountErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          log.push('BrokenComponentWillMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        log.push('BrokenComponentWillMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push(
          'BrokenComponentWillMountErrorBoundary componentWillMount [!]',
        );
        throw new Error('Hello');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentWillMountErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentWillMountErrorBoundary componentWillUnmount');
      }
      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        log.push('BrokenComponentWillMountErrorBoundary componentDidCatch');
        this.setState({error});
      }
    };

    BrokenComponentDidMountErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push('BrokenComponentDidMountErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          log.push('BrokenComponentDidMountErrorBoundary render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        log.push('BrokenComponentDidMountErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenComponentDidMountErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenComponentDidMountErrorBoundary componentDidMount [!]');
        throw new Error('Hello');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenComponentDidMountErrorBoundary componentWillUnmount');
      }
      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        log.push('BrokenComponentDidMountErrorBoundary componentDidCatch');
        this.setState({error});
      }
    };

    BrokenRenderErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push('BrokenRenderErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          log.push('BrokenRenderErrorBoundary render error [!]');
          throw new Error('Hello');
        }
        log.push('BrokenRenderErrorBoundary render success');
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenRenderErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenRenderErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenRenderErrorBoundary componentWillUnmount');
      }
      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        log.push('BrokenRenderErrorBoundary componentDidCatch');
        this.setState({error});
      }
    };

    BrokenRender = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('BrokenRender constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('BrokenRender render [!]');
        throw new Error('Hello');
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BrokenRender componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BrokenRender componentDidMount');
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BrokenRender componentWillReceiveProps');
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BrokenRender componentWillUpdate');
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BrokenRender componentDidUpdate');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BrokenRender componentWillUnmount');
      }
    };

    NoopErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('NoopErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('NoopErrorBoundary render');
        return <BrokenRender />;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('NoopErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('NoopErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('NoopErrorBoundary componentWillUnmount');
      }
      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch() {
        log.push('NoopErrorBoundary componentDidCatch');
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
        log.push(`${this.props.logName} constructor`);
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push(`${this.props.logName} render`);
        return <div>{this.props.children}</div>;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push(`${this.props.logName} componentWillMount`);
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push(`${this.props.logName} componentDidMount`);
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push(`${this.props.logName} componentWillReceiveProps`);
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push(`${this.props.logName} componentWillUpdate`);
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push(`${this.props.logName} componentDidUpdate`);
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push(`${this.props.logName} componentWillUnmount`);
      }
    };

    ErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push(`${this.props.logName} constructor`);
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error && !this.props.forceRetry) {
          log.push(`${this.props.logName} render error`);
          return this.props.renderError(this.state.error, this.props);
        }
        log.push(`${this.props.logName} render success`);
        return <div>{this.props.children}</div>;
      }
      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        log.push(`${this.props.logName} componentDidCatch`);
        this.setState({error});
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push(`${this.props.logName} componentWillMount`);
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push(`${this.props.logName} componentDidMount`);
      }
      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push(`${this.props.logName} componentWillReceiveProps`);
      }
      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push(`${this.props.logName} componentWillUpdate`);
      }
      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push(`${this.props.logName} componentDidUpdate`);
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push(`${this.props.logName} componentWillUnmount`);
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

    BothErrorBoundaries = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
        log.push('BothErrorBoundaries constructor');
      }

      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        log.push('BothErrorBoundaries static getDerivedStateFromError');
        return {error};
      }

      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          log.push('BothErrorBoundaries render error');
          return <div>Caught an error: {this.state.error.message}.</div>;
        }
        log.push('BothErrorBoundaries render success');
        return <div>{this.props.children}</div>;
      }

      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        log.push('BothErrorBoundaries componentDidCatch');
        this.setState({error});
      }

      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('BothErrorBoundaries componentWillMount');
      }

      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('BothErrorBoundaries componentDidMount');
      }

      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('BothErrorBoundaries componentWillReceiveProps');
      }

      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('BothErrorBoundaries componentWillUpdate');
      }

      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('BothErrorBoundaries componentDidUpdate');
      }

      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('BothErrorBoundaries componentWillUnmount');
      }
    };

    RetryErrorBoundary = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('RetryErrorBoundary constructor');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('RetryErrorBoundary render');
        return <BrokenRender />;
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('RetryErrorBoundary componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('RetryErrorBoundary componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('RetryErrorBoundary componentWillUnmount');
      }
      /** `componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        log.push('RetryErrorBoundary componentDidCatch [!]');
        // 在 Fiber 中，调用 setState()（并失败）被视为重新抛出。
        this.setState({});
      }
    };

    ErrorMessage = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        log.push('ErrorMessage constructor');
      }
      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('ErrorMessage componentWillMount');
      }
      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('ErrorMessage componentDidMount');
      }
      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('ErrorMessage componentWillUnmount');
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('ErrorMessage render');
        return <div>Caught an error: {this.props.message}.</div>;
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // @gate !disableLegacyMode
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not swallow exceptions on updating without boundaries」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not swallow exceptions on unmounting without boundaries」描述的渲染、交互或错误处理结果。 */
  it('does not swallow exceptions on unmounting without boundaries', async () => {
    const container = document.createElement('div');
    ReactDOM.render(<BrokenComponentWillUnmount />, container);
    await expect(async () => {
      await act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
    }).rejects.toThrow('Hello');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「prevents errors from leaking into other roots」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「logs a single error using both error boundaries」描述的渲染、交互或错误处理结果。 */
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
      // getDerivedStateFromError 和 componentDidCatch 应该被调用。
      'BothErrorBoundaries static getDerivedStateFromError',
      'BothErrorBoundaries componentWillMount',
      'BothErrorBoundaries render error',
      // Fiber 在捕获错误前先以 null 子节点完成挂载。
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「renders an error state if child throws in render」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「renders an error state if child throws in constructor」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「renders an error state if child throws in componentWillMount」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyContext || !__DEV__
  // @gate !disableLegacyMode
  /** 测试场景：验证「renders an error state if context provider throws in componentWillMount」描述的渲染、交互或错误处理结果。 */
  it('renders an error state if context provider throws in componentWillMount', () => {
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「mounts the error message if mounting fails」描述的渲染、交互或错误处理结果。 */
  it('mounts the error message if mounting fails', () => {
    /** `renderError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「propagates errors on retry on mounting」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「propagates errors inside boundary during componentWillMount」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「propagates errors inside boundary while rendering error state」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not call componentWillUnmount when aborting initial mount」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「resets callback refs if mounting aborts」描述的渲染、交互或错误处理结果。 */
  it('resets callback refs if mounting aborts', () => {
    /** `childRef`：封装当前用例复用的操作、回调或断言步骤。 */
    function childRef(x) {
      log.push('Child ref is set to ' + x);
    }
    /** `errorMessageRef`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「resets object refs if mounting aborts」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「successfully mounts if no error occurs」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches if child throws in constructor during update」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches if child throws in componentWillMount during update」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches if child throws in componentWillReceiveProps during update」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches if child throws in componentWillUpdate during update」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches if child throws in render during update」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「keeps refs up-to-date during updates」描述的渲染、交互或错误处理结果。 */
  it('keeps refs up-to-date during updates', () => {
    /** `child1Ref`：封装当前用例复用的操作、回调或断言步骤。 */
    function child1Ref(x) {
      log.push('Child1 ref is set to ' + x);
    }
    /** `child2Ref`：封装当前用例复用的操作、回调或断言步骤。 */
    function child2Ref(x) {
      log.push('Child2 ref is set to ' + x);
    }
    /** `errorMessageRef`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「recovers from componentWillUnmount errors on update」描述的渲染、交互或错误处理结果。 */
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
      // 初始渲染被中止了，因此 Fiber 从根节点重新尝试。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      // 现在渲染错误（Stack 实现稍后才会这样做）。
      'ErrorBoundary render error',
      // 尝试卸载上一个子组件：成功卸载。
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「recovers from nested componentWillUnmount errors on update」描述的渲染、交互或错误处理结果。 */
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
      // 初始渲染被中止了，因此 Fiber 从根节点重新尝试。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary componentDidUpdate',
      // 第二个 componentWillUnmount 错误也应被捕获并记录。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary componentWillUpdate',
      // 现在渲染错误（Stack 实现稍后才会这样做）。
      'ErrorBoundary render error',
      // 完成
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「picks the right boundary when handling unmounting errors」描述的渲染、交互或错误处理结果。 */
  it('picks the right boundary when handling unmounting errors', () => {
    /** `renderInnerError`：封装当前用例复用的操作、回调或断言步骤。 */
    function renderInnerError(error) {
      return <div>Caught an inner error: {error.message}.</div>;
    }
    /** `renderOuterError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「can recover from error state」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「can update multiple times in error state」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「doesn't get into inconsistent state during removals」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「doesn't get into inconsistent state during additions」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「doesn't get into inconsistent state during reorders」描述的渲染、交互或错误处理结果。 */
  it("doesn't get into inconsistent state during reorders", () => {
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches errors originating downstream」描述的渲染、交互或错误处理结果。 */
  it('catches errors originating downstream', () => {
    let fail = false;
    /** `Stateful`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Stateful extends React.Component {
      /** `Stateful.state`：记录测试夹具在当前场景中的状态。 */
      state = {shouldThrow: false};

      /** `Stateful.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches errors in componentDidMount」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「catches errors in componentDidUpdate」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「propagates errors inside boundary during componentDidMount」描述的渲染、交互或错误处理结果。 */
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
      // Fiber 从 root 重新尝试。
      'ErrorBoundary componentWillUpdate',
      'ErrorBoundary render error',
      'ErrorBoundary componentDidUpdate',
    ]);

    log.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(log).toEqual(['ErrorBoundary componentWillUnmount']);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「calls componentDidCatch for each error that is captured」描述的渲染、交互或错误处理结果。 */
  it('calls componentDidCatch for each error that is captured', () => {
    /** `renderUnmountError`：封装当前用例复用的操作、回调或断言步骤。 */
    function renderUnmountError(error) {
      return <div>Caught an unmounting error: {error.message}.</div>;
    }
    /** `renderUpdateError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「discards a bad root if the root component fails」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「renders empty output if error boundary does not handle the error」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「passes first error when two errors happen in commit」描述的渲染、交互或错误处理结果。 */
  it('passes first error when two errors happen in commit', async () => {
    const errors = [];
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「propagates uncaught error inside unbatched initial mount」描述的渲染、交互或错误处理结果。 */
  it('propagates uncaught error inside unbatched initial mount', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「handles errors that occur in before-mutation commit hook」描述的渲染、交互或错误处理结果。 */
  it('handles errors that occur in before-mutation commit hook', async () => {
    const errors = [];
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
    // 该错误应最先被抛出。
  });
});
