/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let act;
let React;
let ReactDOMClient;
let assertConsoleErrorDev;

describe('ReactElementClone', () => {
  let ComponentClass;

  beforeEach(() => {
    jest.resetModules();

    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');

// 注意：这里有意不使用 JSX，以直接验证经典 JavaScript 元素 API，避免转换产物影响结果。
    ComponentClass = class extends React.Component {
      /** 渲染“ReactElementClone”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('div');
      }
    };
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should clone a DOM component with new props”场景的唯一关键操作。
   * Then：断言 cloneElement 的属性合并、key、ref 与 owner 契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should clone a DOM component with new props', async () => {
    let div;
    /** 作为“should clone a DOM component with new props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Grandparent extends React.Component {
      /** 渲染“should clone a DOM component with new props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <Parent
            child={<div ref={node => (div = node)} className="child" />}
          />
        );
      }
    }
    /** 作为“should clone a DOM component with new props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“should clone a DOM component with new props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <div className="parent">
            {React.cloneElement(this.props.child, {className: 'xyz'})}
          </div>
        );
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Grandparent />);
    });
    expect(div.className).toBe('xyz');
  });

  /**
   * 场景：“should clone a composite component with new props”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should clone a composite component with new props', async () => {
    let div;
    /** 作为“should clone a composite component with new props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should clone a composite component with new props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <div ref={node => (div = node)} className={this.props.className} />
        );
      }
    }
    /** 作为“should clone a composite component with new props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Grandparent extends React.Component {
      /** 渲染“should clone a composite component with new props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Parent child={<Child className="child" />} />;
      }
    }
    /** 作为“should clone a composite component with new props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“should clone a composite component with new props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <div className="parent">
            {React.cloneElement(this.props.child, {className: 'xyz'})}
          </div>
        );
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Grandparent />);
    });
    expect(div.className).toBe('xyz');
  });

  /**
   * 场景：“does not fail if config has no prototype”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('does not fail if config has no prototype', () => {
    const config = Object.create(null, {foo: {value: 1, enumerable: true}});
    React.cloneElement(<div />, config);
  });

  /**
   * 场景：“should keep the original ref if it is not overridden”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should keep the original ref if it is not overridden', async () => {
    let component;
    /** 作为“should keep the original ref if it is not overridden”场景的组件夹具，隔离待验证的 React 行为。 */
    class Grandparent extends React.Component {
      /** 保存“should keep the original ref if it is not overridden”场景需要跨生命周期读取的实例或宿主节点引用。 */
      yoloRef = React.createRef();

      /** 记录“should keep the original ref if it is not overridden”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        component = this;
      }

      /** 渲染“should keep the original ref if it is not overridden”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Parent child={<div ref={this.yoloRef} />} />;
      }
    }

    /** 作为“should keep the original ref if it is not overridden”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“should keep the original ref if it is not overridden”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <div>{React.cloneElement(this.props.child, {className: 'xyz'})}</div>
        );
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Grandparent />);
    });

    expect(component.yoloRef.current.tagName).toBe('DIV');
  });

  /**
   * 场景：“should transfer the key property”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should transfer the key property', () => {
    /** 作为“should transfer the key property”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should transfer the key property”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }
    const clone = React.cloneElement(<Component />, {key: 'xyz'});
    expect(clone.key).toBe('xyz');
  });

  /**
   * 场景：“should transfer children”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should transfer children', async () => {
    /** 作为“should transfer children”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should transfer children”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        expect(this.props.children).toBe('xyz');
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.cloneElement(<Component />, {children: 'xyz'}));
    });
  });

  /**
   * 场景：“should shallow clone children”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should shallow clone children', async () => {
    /** 作为“should shallow clone children”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should shallow clone children”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        expect(this.props.children).toBe('xyz');
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.cloneElement(<Component>xyz</Component>, {}));
    });
  });

  /**
   * 场景：“should accept children as rest arguments”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should accept children as rest arguments', () => {
    /** 作为“should accept children as rest arguments”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should accept children as rest arguments”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }

    const clone = React.cloneElement(
      <Component>xyz</Component>,
      {children: <Component />},
      <div />,
      <span />,
    );

    expect(clone.props.children).toEqual([<div />, <span />]);
  });

  /**
   * 场景：“should override children if undefined is provided as an argument”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should override children if undefined is provided as an argument', () => {
    const element = React.createElement(
      ComponentClass,
      {
        children: 'text',
      },
      undefined,
    );
    expect(element.props.children).toBe(undefined);

    const element2 = React.cloneElement(
      React.createElement(ComponentClass, {
        children: 'text',
      }),
      {},
      undefined,
    );
    expect(element2.props.children).toBe(undefined);
  });

  /**
   * 场景：“should support keys and refs”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should support keys and refs', async () => {
    let component;
    /** 作为“should support keys and refs”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 保存“should support keys and refs”场景需要跨生命周期读取的实例或宿主节点引用。 */
      xyzRef = React.createRef();

      /** 渲染“should support keys and refs”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        const clone = React.cloneElement(this.props.children, {
          key: 'xyz',
          ref: this.xyzRef,
        });
        expect(clone.key).toBe('xyz');
        expect(clone.props.ref).toBe(this.xyzRef);
        return <div>{clone}</div>;
      }
    }

    /** 作为“should support keys and refs”场景的组件夹具，隔离待验证的 React 行为。 */
    class Grandparent extends React.Component {
      /** 保存“should support keys and refs”场景需要跨生命周期读取的实例或宿主节点引用。 */
      parentRef = React.createRef();

      /** 记录“should support keys and refs”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        component = this;
      }

      /** 渲染“should support keys and refs”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <Parent ref={this.parentRef}>
            <span key="abc" />
          </Parent>
        );
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(<Grandparent />));
    expect(component.parentRef.current.xyzRef.current.tagName).toBe('SPAN');
  });

  /**
   * 场景：“should steal the ref if a new ref is specified”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should steal the ref if a new ref is specified', async () => {
    let component;
    /** 作为“should steal the ref if a new ref is specified”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 保存“should steal the ref if a new ref is specified”场景需要跨生命周期读取的实例或宿主节点引用。 */
      xyzRef = React.createRef();

      /** 渲染“should steal the ref if a new ref is specified”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        const clone = React.cloneElement(this.props.children, {
          ref: this.xyzRef,
        });
        return <div>{clone}</div>;
      }
    }

    /** 作为“should steal the ref if a new ref is specified”场景的组件夹具，隔离待验证的 React 行为。 */
    class Grandparent extends React.Component {
      /** 保存“should steal the ref if a new ref is specified”场景需要跨生命周期读取的实例或宿主节点引用。 */
      parentRef = React.createRef();
      /** 保存“should steal the ref if a new ref is specified”场景需要跨生命周期读取的实例或宿主节点引用。 */
      childRef = React.createRef();

      /** 记录“should steal the ref if a new ref is specified”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        component = this;
      }

      /** 渲染“should steal the ref if a new ref is specified”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <Parent ref={this.parentRef}>
            <span ref={this.childRef} />
          </Parent>
        );
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(<Grandparent />));
    expect(component.childRef).toEqual({current: null});
    expect(component.parentRef.current.xyzRef.current.tagName).toBe('SPAN');
  });

  /**
   * 场景：“should overwrite props”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should overwrite props', async () => {
    /** 作为“should overwrite props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should overwrite props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        expect(this.props.myprop).toBe('xyz');
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(
        React.cloneElement(<Component myprop="abc" />, {myprop: 'xyz'}),
      ),
    );
  });

  /**
   * 场景：“warns for keys for arrays of elements in rest args”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('warns for keys for arrays of elements in rest args', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.cloneElement(<div />, null, [<div />, <div />]));
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the top-level render call using <div>. See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /**
   * 场景：“does not warns for arrays of elements with keys”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('does not warns for arrays of elements with keys', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(
        React.cloneElement(<div />, null, [<div key="#1" />, <div key="#2" />]),
      );
    });
  });

  /**
   * 场景：“does not warn when the element is directly in rest args”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('does not warn when the element is directly in rest args', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.cloneElement(<div />, null, <div />, <div />));
    });
  });

  /**
   * 场景：“does not warn when the array contains a non-element”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('does not warn when the array contains a non-element', () => {
    React.cloneElement(<div />, null, [{}, {}]);
  });

  /**
   * 场景：“should ignore key and ref warning getters”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should ignore key and ref warning getters', () => {
    const elementA = React.createElement('div');
    const elementB = React.cloneElement(elementA, elementA.props);
    expect(elementB.key).toBe(null);
    expect(elementB.ref).toBe(null);
  });

  /**
   * 场景：“should ignore undefined key and ref”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should ignore undefined key and ref', () => {
    const element = React.createElement(ComponentClass, {
      key: '12',
      ref: '34',
      foo: '56',
    });
    const props = {
      key: undefined,
      ref: undefined,
      foo: 'ef',
    };
    const clone = React.cloneElement(element, props);
    expect(clone.type).toBe(ComponentClass);
    expect(clone.key).toBe('12');
    expect(clone.props.ref).toBe('34');
    expect(clone.ref).toBe('34');
    assertConsoleErrorDev([
      'Accessing element.ref was removed in React 19. ref is now a ' +
        'regular prop. It will be removed from the JSX Element ' +
        'type in a future release.',
    ]);
    expect(clone.props).toEqual({foo: 'ef', ref: '34'});
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
  });

  /**
   * 场景：“should extract null key and ref”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('should extract null key and ref', () => {
    const element = React.createElement(ComponentClass, {
      key: '12',
      ref: '34',
      foo: '56',
    });
    const props = {
      key: null,
      ref: null,
      foo: 'ef',
    };
    const clone = React.cloneElement(element, props);
    expect(clone.type).toBe(ComponentClass);
    expect(clone.key).toBe('null');
    expect(clone.ref).toBe(null);
    expect(clone.props).toEqual({foo: 'ef', ref: null});
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
  });

  /**
   * 场景：“throws an error if passed null”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('throws an error if passed null', () => {
    const element = null;
    expect(() => React.cloneElement(element)).toThrow(
      'The argument must be a React element, but you passed null.',
    );
  });

  /**
   * 场景：“throws an error if passed undefined”。
   * 机制：验证cloneElement 的属性合并、key、ref 与 owner 契约，锁定可观察结果与失败边界。
   */
  it('throws an error if passed undefined', () => {
    let element;
    expect(() => React.cloneElement(element)).toThrow(
      'The argument must be a React element, but you passed undefined.',
    );
  });
});
