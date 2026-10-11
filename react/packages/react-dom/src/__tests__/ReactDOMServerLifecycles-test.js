/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 加载模块重置helper；本文件所有case直接调用同步SSR而不使用五模式包装。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMServer;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

/** 重置React/服务器模块及生命周期诊断缓存，返回当前服务端入口给helper。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMServer = require('react-dom/server');
  assertConsoleErrorDev = require('internal-test-utils').assertConsoleErrorDev;
  assertConsoleWarnDev = require('internal-test-utils').assertConsoleWarnDev;

  // 返回当前DOM入口供模块重置helper使用。
  return {
    ReactDOMServer,
  };
}

/** 绑定initModules，取得每例隔离用resetModules。 */
const {resetModules} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerLifecycles', () => {
  beforeEach(() => {
    resetModules();
  });

  /** SSR Outer套Inner，各UNSAFE_componentWillMount/render记日志；顺序外willMount→外render→内willMount→内render，验证服务器初次遍历的旧生命周期顺序。 */
  it('should invoke the correct legacy lifecycle hooks', () => {
    const log = [];

    /** 记录旧挂载钩子与render后返回Inner的外层类。 */
    class Outer extends React.Component {
      /** 记录外willMount，验证它在外render前。 */
      UNSAFE_componentWillMount() {
        log.push('outer componentWillMount');
      }
      /** 记录外render再返回Inner，开始内层遍历。 */
      render() {
        log.push('outer render');
        return <Inner />;
      }
    }

    /** 旧生命周期顺序的内层类，最终空输出。 */
    class Inner extends React.Component {
      /** 记录内willMount，应在外render之后、内render之前。 */
      UNSAFE_componentWillMount() {
        log.push('inner componentWillMount');
      }
      /** 记录内render并返回null，结束本次遍历。 */
      render() {
        log.push('inner render');
        return null;
      }
    }

    ReactDOMServer.renderToString(<Outer />);
    expect(log).toEqual([
      'outer componentWillMount',
      'outer render',
      'inner componentWillMount',
      'inner render',
    ]);
  });

  /** Outer/Inner均初始化state并定义静态gDSFP；SSR日志外gDSFP/render再内gDSFP/render，验证新派生状态早于各自render。 */
  it('should invoke the correct new lifecycle hooks', () => {
    const log = [];

    /** 新派生状态API顺序的外层类。 */
    class Outer extends React.Component {
      /** 提供已初始化state对象，避免undefined初始状态诊断。 */
      state = {};
      /** 记录外gDSFP并返回null，不改变state。 */
      static getDerivedStateFromProps() {
        log.push('outer getDerivedStateFromProps');
        return null;
      }
      /** 记录外render后返回Inner。 */
      render() {
        log.push('outer render');
        return <Inner />;
      }
    }

    /** 新派生状态API顺序的内层类。 */
    class Inner extends React.Component {
      /** 初始化state对象，隔离生命周期顺序验证。 */
      state = {};
      /** 记录内gDSFP并返回null，早于内render。 */
      static getDerivedStateFromProps() {
        log.push('inner getDerivedStateFromProps');
        return null;
      }
      /** 记录内render后返回null。 */
      render() {
        log.push('inner render');
        return null;
      }
    }

    ReactDOMServer.renderToString(<Outer />);
    expect(log).toEqual([
      'outer getDerivedStateFromProps',
      'outer render',
      'inner getDerivedStateFromProps',
      'inner render',
    ]);
  });

  /** Component同时gDSFP和会抛unexpected的UNSAFE_componentWillMount；SSR成功并DEV诊断兼容冲突，验证新API使旧unsafe挂载钩子不执行。 */
  it('should not invoke unsafe cWM if static gDSFP is present', () => {
    /** 同时定义gDSFP和unsafe旧挂载钩子的冲突fixture。 */
    class Component extends React.Component {
      /** 初始化state避免无关诊断。 */
      state = {};
      /** 返回null的新API，应该使unsafe旧挂载钩子失效。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** 若被调用即抛unexpected，SSR成功证明它被禁用。 */
      UNSAFE_componentWillMount() {
        throw Error('unexpected');
      }
      /** 返回null，保持输出无关而只测试生命周期选择。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n' +
        '\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n' +
        '\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
  });

  /** Grandparent初始foo，Parent派生bar为not bar保留baz，Child派生qux；SSR含各文本，验证派生状态浅合并并供同次render读取。 */
  it('should update instance.state with value returned from getDerivedStateFromProps', () => {
    /** 持有foo的祖父类，包派生bar的Parent。 */
    class Grandparent extends React.Component {
      /** 初始foo=foo，不定义派生状态。 */
      state = {
        foo: 'foo',
      };
      /** 输出本state.foo并返回Parent，检查各实例状态隔离。 */
      render() {
        return (
          <div>
            {`Grandparent: ${this.state.foo}`}
            <Parent />
          </div>
        );
      }
    }

    /** 初始bar/baz，gDSFP仅覆盖bar的父类。 */
    class Parent extends React.Component {
      /** 初始bar=bar/baz=baz，派生后baz应保留。 */
      state = {
        bar: 'bar',
        baz: 'baz',
      };
      /** 基于prevState.bar返回not bar，浅合并不删除baz。 */
      static getDerivedStateFromProps(props, prevState) {
        return {
          bar: `not ${prevState.bar}`,
        };
      }
      /** 输出派生bar和保留baz，继续渲染Child。 */
      render() {
        return (
          <div>
            {`Parent: ${this.state.bar}, ${this.state.baz}`}
            <Child />;
          </div>
        );
      }
    }

    /** 派生新增qux的子类，初始空state。 */
    class Child extends React.Component {
      /** 空state作为派生对象合并目标。 */
      state = {};
      /** 返回qux=qux供同次render使用。 */
      static getDerivedStateFromProps() {
        return {
          qux: 'qux',
        };
      }
      /** 输出this.state.qux证明派生已应用。 */
      render() {
        return `Child: ${this.state.qux}`;
      }
    }

    const markup = ReactDOMServer.renderToString(<Grandparent />);
    expect(markup).toContain('Grandparent: foo');
    expect(markup).toContain('Parent: not bar, baz');
    expect(markup).toContain('Child: qux');
  });

  /** gDSFP无返回值；第一次SSR DEV诊断undefined非法、第二次无重复，验证必须返回对象/null及按类型去重。 */
  it('should warn if getDerivedStateFromProps returns undefined', () => {
    /** gDSFP无返回值的非法结果诊断fixture。 */
    class Component extends React.Component {
      /** 有效初始state使诊断只指向undefined返回。 */
      state = {};
      /** 故意返回undefined，DEV必须提示对象/null要求。 */
      static getDerivedStateFromProps() {}
      /** 返回null，不产生其它SSR内容。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      'Component.getDerivedStateFromProps(): A valid state object (or null) must ' +
        'be returned. You have returned undefined.\n' +
        '    in Component (at **)',
    ]);

    // 去重
    ReactDOMServer.renderToString(<Component />);
  });

  /** gDSFP返回null但未初始化state；第一次DEV警告初始state undefined、第二次去重，验证参数形状初始化诊断。 */
  it('should warn if state is not initialized before getDerivedStateFromProps', () => {
    /** 故意不初始化state却定义gDSFP的类。 */
    class Component extends React.Component {
      /** 返回null，诊断来自初始state undefined而非派生返回值。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** 返回null，重复SSR用于去重。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      '`Component` uses `getDerivedStateFromProps` but its initial state is ' +
        'undefined. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `Component`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in Component (at **)',
    ]);

    // 去重
    ReactDOMServer.renderToString(<Component />);
  });

  /** Component同时旧componentWillMount与UNSAFE_componentWillMount而没有gDSFP；SSR两钩子按旧→unsafe执行并给重命名诊断，验证两旧入口兼容调用；不是新派生状态API。 */
  it('should invoke both deprecated and new lifecycles if both are present', () => {
    const log = [];

    /** 同时有两种旧挂载钩子的类，没有新gDSFP。 */
    class Component extends React.Component {
      /** 记录旧componentWillMount，应先于UNSAFE别名。 */
      componentWillMount() {
        log.push('componentWillMount');
      }
      /** 记录UNSAFE_componentWillMount，两个旧钩子都应执行。 */
      UNSAFE_componentWillMount() {
        log.push('UNSAFE_componentWillMount');
      }
      /** 返回null，日志只包含两次旧挂载钩子。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n' +
        '\n' +
        '* Move code from componentWillMount to componentDidMount (preferred in most cases) or the constructor.\n' +
        '\n' +
        'Please update the following components: Component\n' +
        '    in Component (at **)',
    ]);
    expect(log).toEqual(['componentWillMount', 'UNSAFE_componentWillMount']);
  });

  /** Outer在挂载前setState x=1，Inner自身x=2并再更新Outer为3；静态HTML为1-2，父更新no-op诊断，验证服务器只接受当前挂载组件的状态更新。 */
  it('tracks state updates across components', () => {
    /** 挂载前自身x=1，但被Inner试图再更新的外层类。 */
    class Outer extends React.Component {
      /** 在自己挂载期间setState x=1，服务器应接受。 */
      UNSAFE_componentWillMount() {
        this.setState({x: 1});
      }
      /** 把已取得x=1作为children及父更新函数传给Inner。 */
      render() {
        return <Inner updateParent={this.updateParent}>{this.state.x}</Inner>;
      }
      /** 试图将Outer x设3；调用时已在Inner挂载阶段，因此服务器报告并忽略。 */
      updateParent = () => {
        this.setState({x: 3});
      };
    }
    /** 自身挂载前x=2并调用父更新的内层类。 */
    class Inner extends React.Component {
      /** 自身setState有效，再调用updateParent制造非当前挂载实例更新。 */
      UNSAFE_componentWillMount() {
        this.setState({x: 2});
        this.props.updateParent();
      }
      /** 拼接已传父值1和自身状态2，静态HTML应1-2。 */
      render() {
        return <div>{this.props.children + '-' + this.state.x}</div>;
      }
    }
    // Inner期间对Outer的x=3更新无效；原父children=1与内状态2组成1-2。
    expect(ReactDOMServer.renderToStaticMarkup(<Outer />)).toBe(
      '<div>1-2</div>',
    );
    assertConsoleErrorDev([
      'Can only update a mounting component. This ' +
        'usually means you called setState() outside componentWillMount() on ' +
        'the server. This is a no-op.\n\n' +
        'Please check the code for the Outer component.\n' +
        '    in Outer (at **)',
    ]);
  });

  /** gDSFP与会抛unexpected的旧componentWillMount并存；SSR成功并警告旧钩子被禁用，验证非UNSAFE别名也受新API约束。 */
  it('should not invoke cWM if static gDSFP is present', () => {
    /** gDSFP与旧componentWillMount冲突fixture，检查非UNSAFE旧入口。 */
    class Component extends React.Component {
      /** 初始化state以避免无关警告。 */
      state = {};
      /** 返回null的新派生API，禁用旧componentWillMount。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** 若旧钩子执行就抛unexpected，因此SSR成功说明被跳过。 */
      componentWillMount() {
        throw Error('unexpected');
      }
      /** 返回null，仅验证新旧生命周期选择。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n' +
        '\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
  });

  /** MyComponent旧componentWillMount为空；第一次SSR重命名警告带组件栈，第二次去重，验证弃用诊断与执行内容无关。 */
  it('should warn about deprecated lifecycle hooks', () => {
    /** 只有弃用挂载钩子的类，验证重命名诊断去重。 */
    class MyComponent extends React.Component {
      /** 空旧挂载钩子仍需弃用提示，不以内部操作决定告警。 */
      componentWillMount() {}
      /** 空输出，第二次SSR只检查不重复警告。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<MyComponent />);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n' +
        '\n' +
        '* Move code from componentWillMount to componentDidMount (preferred in most cases) or the constructor.\n' +
        '\n' +
        'Please update the following components: MyComponent\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    ReactDOMServer.renderToString(<MyComponent />);
  });

  describe('react-lifecycles-compat', () => {
    const {polyfill} = require('react-lifecycles-compat');

    /** polyfill类的gDSFP后放StrictMode做SSR；成功且无未消费诊断，验证兼容库标记避免错误旧生命周期提示；本例不验证客户端生命周期。 */
    it('should not warn for components with polyfilled getDerivedStateFromProps', () => {
      /** react-lifecycles-compat派生状态适配的类，套StrictMode做SSR。 */
      class PolyfilledComponent extends React.Component {
        /** 初始化state对象，兼容库可模拟gDSFP。 */
        state = {};
        /** 返回null，不改变状态，验证polyfill标记不误报。 */
        static getDerivedStateFromProps() {
          return null;
        }
        /** 返回null，服务器不应给兼容旧钩子警告。 */
        render() {
          return null;
        }
      }

      polyfill(PolyfilledComponent);

      const container = document.createElement('div');
      ReactDOMServer.renderToString(
        <React.StrictMode>
          <PolyfilledComponent />
        </React.StrictMode>,
        container,
      );
    });

    /** polyfill类的getSnapshotBeforeUpdate及componentDidUpdate后放StrictMode做SSR；成功且无诊断，验证兼容标记；服务器初次渲染不会执行更新提交钩子。 */
    it('should not warn for components with polyfilled getSnapshotBeforeUpdate', () => {
      /** 兼容库snapshot适配fixture，SSR只运行初次render。 */
      class PolyfilledComponent extends React.Component {
        /** 返回null的snapshot定义供polyfill读取，本例服务器不执行更新提交。 */
        getSnapshotBeforeUpdate() {
          return null;
        }
        /** 空componentDidUpdate满足snapshot配套要求，本例SSR不调用。 */
        componentDidUpdate() {}
        /** 返回null，检查polyfill后的无诊断SSR。 */
        render() {
          return null;
        }
      }

      polyfill(PolyfilledComponent);

      const container = document.createElement('div');
      ReactDOMServer.renderToString(
        <React.StrictMode>
          <PolyfilledComponent />
        </React.StrictMode>,
        container,
      );
    });
  });
});
