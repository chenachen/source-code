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
let ReactDOM;
let findDOMNode;
let ReactDOMClient;
let TogglingComponent;
let act;
let Scheduler;
let assertLog;
let assertConsoleErrorDev;

let container;

describe('ReactEmptyComponent', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    container = document.createElement('div');

    /** 按firstComponent初始渲染，挂载生命周期立即切到secondComponent，日志通过findDOMNode暴露空/宿主转换。 */
    TogglingComponent = class extends React.Component {
      /** 保存初始component类型，null/undefined表示无宿主。 */
      state = {component: this.props.firstComponent};

      /** 记录mount的宿主名称或undefined，再setState切到secondComponent，构造同次flush后的更新。 */
      componentDidMount() {
        Scheduler.log('mount ' + findDOMNode(this)?.nodeName);
        this.setState({component: this.props.secondComponent});
      }

      /** 记录更新后的宿主名称，空值时可选链得到undefined。 */
      componentDidUpdate() {
        Scheduler.log('update ' + findDOMNode(this)?.nodeName);
      }

      /** component真值时按类型生成元素，否则返回null，不给空输出插入占位DOM。 */
      render() {
        const Component = this.state.component;
        return Component ? <Component /> : null;
      }
    };
  });

  describe.each([null, undefined])('when %s', nullORUndefined => {
    /** describe.each分别null和undefined，EmptyComponent返回当前值；flushSync无异常，验证函数组件空输出合法。 */
    it('should not throw when rendering', () => {
      /** 返回describe.each当前null或undefined，检查函数空输出。 */
      function EmptyComponent() {
        return nullORUndefined;
      }

      const root = ReactDOMClient.createRoot(container);

      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<EmptyComponent />);
        });
      }).not.toThrowError();
    });

    /** 每个null/undefined分支与另一个返回false组件分别挂两个根；两容器元素children均0，验证空值/布尔都不产生宿主元素。 */
    it('should not produce child DOM nodes for nullish and false', async () => {
      /** 返回当前null/undefined，与false另根比较。 */
      function Component1() {
        return nullORUndefined;
      }

      /** 固定返回false，作为另一种不生成元素的child值。 */
      function Component2() {
        return false;
      }

      const container1 = document.createElement('div');
      const root1 = ReactDOMClient.createRoot(container1);
      await act(() => {
        root1.render(<Component1 />);
      });
      expect(container1.children.length).toBe(0);

      const container2 = document.createElement('div');
      const root2 = ReactDOMClient.createRoot(container2);
      await act(() => {
        root2.render(<Component2 />);
      });
      expect(container2.children.length).toBe(0);
    });

    /** 每个空值分别先空后div、先div后空，在componentDidMount更新；日志undefined→DIV与DIV→undefined，验证findDOMNode随空输出切换。 */
    it('should be able to switch between rendering nullish and a normal tag', async () => {
      const instance1 = (
        <TogglingComponent
          firstComponent={nullORUndefined}
          secondComponent={'div'}
        />
      );
      const instance2 = (
        <TogglingComponent
          firstComponent={'div'}
          secondComponent={nullORUndefined}
        />
      );

      const container2 = document.createElement('div');
      const root1 = ReactDOMClient.createRoot(container);
      await act(() => {
        root1.render(instance1);
      });

      assertLog(['mount undefined', 'update DIV']);

      const root2 = ReactDOMClient.createRoot(container2);
      await act(() => {
        root2.render(instance2);
      });

      assertLog(['mount DIV', 'update undefined']);
    });

    /** 每个空值输入在同父div下复制三份TogglingComponent；三次mount undefined后更新DIV，验证列表多个空子树能独立插入宿主。 */
    it('should be able to switch in a list of children', async () => {
      const instance1 = (
        <TogglingComponent
          firstComponent={nullORUndefined}
          secondComponent={'div'}
        />
      );

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            {instance1}
            {instance1}
            {instance1}
          </div>,
        );
      });

      assertLog([
        'mount undefined',
        'mount undefined',
        'mount undefined',
        'update DIV',
        'update DIV',
        'update DIV',
      ]);
    });

    /** 每个空值分别切到真实script及从script切回空；首容器<script>、次为空且日志对应，集成开启首次脚本诊断，验证空输出不被混同为script占位。 */
    it('should distinguish between a script placeholder and an actual script tag', () => {
      const instance1 = (
        <TogglingComponent
          firstComponent={nullORUndefined}
          secondComponent={'script'}
        />
      );
      const instance2 = (
        <TogglingComponent
          firstComponent={'script'}
          secondComponent={nullORUndefined}
        />
      );

      const root1 = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root1.render(instance1);
        });
      }).not.toThrow();

      expect(container.innerHTML).toBe('<script></script>');
      if (gate('enableTrustedTypesIntegration')) {
        assertConsoleErrorDev([
          'Encountered a script tag while rendering React component. ' +
            'Scripts inside React components are never executed when rendering on the client. ' +
            'Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).\n' +
            '     in script (at **)\n' +
            '     in TogglingComponent (at **)',
        ]);
      }

      const container2 = document.createElement('div');
      const root2 = ReactDOMClient.createRoot(container2);
      expect(() => {
        ReactDOM.flushSync(() => {
          root2.render(instance2);
        });
      }).not.toThrow();

      assertLog([
        'mount undefined',
        'update SCRIPT',
        'mount SCRIPT',
        'update undefined',
      ]);
      expect(container2.innerHTML).toBe('');
    });

    /** 每个空值通过Child→GrandChild两复合层返回，分别与div双向切换；日志DIV/undefined互换且不抛错，验证findDOMNode可穿过多层到空子树。 */
    it(
      'should have findDOMNode return null when multiple layers of composite ' +
        'components render to the same nullish placeholder',
      () => {
        /** 最深函数返回当前空值，让findDOMNode跨复合层到空。 */
        function GrandChild() {
          return nullORUndefined;
        }

        /** 中间Child仅返回GrandChild，不添加DOM。 */
        function Child() {
          return <GrandChild />;
        }

        const instance1 = (
          <TogglingComponent firstComponent={'div'} secondComponent={Child} />
        );
        const instance2 = (
          <TogglingComponent firstComponent={Child} secondComponent={'div'} />
        );

        const root1 = ReactDOMClient.createRoot(container);
        expect(() => {
          ReactDOM.flushSync(() => {
            root1.render(instance1);
          });
        }).not.toThrow();

        const container2 = document.createElement('div');
        const root2 = ReactDOMClient.createRoot(container2);
        expect(() => {
          ReactDOM.flushSync(() => {
            root2.render(instance2);
          });
        }).not.toThrow();

        assertLog([
          'mount DIV',
          'update undefined',
          'mount undefined',
          'update DIV',
        ]);
      },
    );

    /** 每个空值下Wrapper先显示Inner span、再空、再显示；Inner挂载和卸载前findDOMNode仍存在，ref有→null→有且6断言，验证卸载清理时序与重新挂载。 */
    it('works when switching components', async () => {
      let innerRef;

      /** 输出span的Inner，用生命周期检查卸载前宿主仍可查找。 */
      class Inner extends React.Component {
        /** 返回span，让findDOMNode有具体目标。 */
        render() {
          return <span />;
        }

        /** 挂载提交时断言宿主非null，包含从空切回时的新实例。 */
        componentDidMount() {
          // 确保 DOM 节点即使在我们替换 `null` 组件时也能正确解析。
          expect(findDOMNode(this)).not.toBe(null);
        }

        /** 卸载生命周期检查宿主仍存在，此时删除及ref最终清空尚未完成。 */
        componentWillUnmount() {
          // 虽然当前组件将被 `null` 替换，但此刻替换尚未发生。
          expect(findDOMNode(this)).not.toBe(null);
        }
      }

      /** 每次render创建新ref并按showInner选Inner或当前空值，测试外部看到的ref提交状态。 */
      function Wrapper({showInner}) {
        innerRef = React.createRef(null);
        return showInner ? <Inner ref={innerRef} /> : nullORUndefined;
      }

      const el = document.createElement('div');

      // 渲染 <Inner /> 组件...
      const root = ReactDOMClient.createRoot(el);
      await act(() => {
        root.render(<Wrapper showInner={true} />);
      });
      expect(innerRef.current).not.toBe(null);

      // 切换到 null...
      await act(() => {
        root.render(<Wrapper showInner={false} />);
      });
      expect(innerRef.current).toBe(null);

      // ……然后再切换回来。
      await act(() => {
        root.render(<Wrapper showInner={true} />);
      });
      expect(innerRef.current).not.toBe(null);

      expect.assertions(6);
    });

    /** 根直接render当前null/undefined；容器innerHTML空，验证顶层空值合法。 */
    it('can render nullish at the top level', async () => {
      const div = document.createElement('div');
      const root = ReactDOMClient.createRoot(div);

      await act(() => {
        root.render(nullORUndefined);
      });
      expect(div.innerHTML).toBe('');
    });

    /** 每个空值下Parent两空Child夹可见Child，可见Child.componentDidMount触发父forceUpdate；flushSync不抛错，验证挂载期更新与相邻空Fiber共存。 */
    it('does not break when updating during mount', () => {
      /** 可见时输出hello div、不可见时当前空值，挂载可触发父更新。 */
      class Child extends React.Component {
        /** 若有onMount就调用，用中间可见Child启动父forceUpdate。 */
        componentDidMount() {
          if (this.props.onMount) {
            this.props.onMount();
          }
        }

        /** 依据visible决定宿主/空值，两个空兄弟与可见子级位置固定。 */
        render() {
          if (!this.props.visible) {
            return nullORUndefined;
          }

          return <div>hello world</div>;
        }
      }

      /** 两空Child夹可见Child的父类，接收子挂载期更新。 */
      class Parent extends React.Component {
        /** 强制父重渲染而不改props，验证挂载队列与空兄弟共存。 */
        update = () => {
          this.forceUpdate();
        };

        /** 按稳定key1/0/2输出三Child，仅可见中间项带onMount。 */
        render() {
          return (
            <div>
              <Child key="1" visible={false} />
              <Child key="0" visible={true} onMount={this.update} />
              <Child key="2" visible={false} />
            </div>
          );
        }
      }

      const root = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<Parent />);
        });
      }).not.toThrow();
    });

    /** Empty连续两次返回当前null/undefined；两轮firstChild均null，验证更新不凭空创建DOM；旧标题preserves node实际没有节点身份。 */
    it('preserves the dom node during updates', async () => {
      /** 连续更新均返回当前空值，断言容器始终无firstChild。 */
      function Empty() {
        return nullORUndefined;
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Empty />);
      });
      const noscript1 = container.firstChild;
      expect(noscript1).toBe(null);

      // 这次更新不应创建 DOM 节点。
      await act(() => {
        root.render(<Empty />);
      });
      const noscript2 = container.firstChild;
      expect(noscript2).toBe(null);
    });

    /** forwardRef包装返回当前null/undefined的Empty；flushSync不抛错且无未消费诊断，验证包装器允许空输出。 */
    it('should not warn about React.forwardRef that returns nullish', () => {
      /** forwardRef包装的函数render，返回当前空值而不使用ref。 */
      const Empty = () => {
        return nullORUndefined;
      };
      const EmptyForwardRef = React.forwardRef(Empty);

      const root = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<EmptyForwardRef />);
        });
      }).not.toThrowError();
    });

    /** memo包装返回当前null/undefined的Empty；flushSync不抛错且无未消费诊断，验证memo空输出合法。 */
    it('should not warn about React.memo that returns nullish', () => {
      /** memo包装的函数render，返回当前空值且无宿主节点。 */
      const Empty = () => {
        return nullORUndefined;
      };
      const EmptyMemo = React.memo(Empty);

      const root = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<EmptyMemo />);
        });
      }).not.toThrowError();
    });
  });
});
