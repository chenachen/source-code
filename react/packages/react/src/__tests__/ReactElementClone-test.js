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

  // 每例重载React和DOM renderer，隔离开发告警去重；act完成本例提交后再读ref或DOM。
  beforeEach(() => {
    jest.resetModules();

    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');

// 注意：这里有意不使用 JSX，以直接验证经典 JavaScript 元素 API，避免转换产物影响结果。
    /** 共享最小 class 目标，仅用经典 createElement 输出 div，供克隆字段与实例 ref 断言。 */
    ComponentClass = class extends React.Component {
      /** 输出最小div，为不挂载的经典元素克隆测试提供稳定class类型。 */
      render() {
        return React.createElement('div');
      }
    };
  });

  /** Grandparent提供className=child的div与回调ref，Parent克隆时改className=xyz；提交后ref指到的真实DOM应为xyz，验证宿主props覆盖实际进入commit。 */
  it('should clone a DOM component with new props', async () => {
    let div;
    /** 保留原div的回调ref，观察经过父级克隆后实际提交的DOM。 */
    class Grandparent extends React.Component {
      /** 创建className=child的div并传给Parent，回调ref把最终节点写入用例局部变量。 */
      render() {
        return (
          <Parent
            child={<div ref={node => (div = node)} className="child" />}
          />
        );
      }
    }
    /** 将传入宿主element的className覆盖为xyz，构造DOM克隆路径。 */
    class Parent extends React.Component {
      /** 克隆child并包在父div内，使覆盖后的宿主props进入真实挂载。 */
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

  /** Grandparent提供Child element，Parent克隆并改className=xyz，Child透传该prop到div；最终DOM类名为xyz，验证组合组件也收到覆盖后的props。 */
  it('should clone a composite component with new props', async () => {
    let div;
    /** 把组合组件接收的className透传到DOM，连接clone输入与最终宿主断言。 */
    class Child extends React.Component {
      /** 渲染带回调ref的div，供断言直接读取克隆后className。 */
      render() {
        return (
          <div ref={node => (div = node)} className={this.props.className} />
        );
      }
    }
    /** 向Parent提供原className=child的Child element，保留组合组件克隆的输入。 */
    class Grandparent extends React.Component {
      /** 只创建Child描述对象，由Parent负责覆盖props，区分创建与克隆两个入口。 */
      render() {
        return <Parent child={<Child className="child" />} />;
      }
    }
    /** 克隆组合组件element，验证覆盖先到Child props再到宿主div。 */
    class Parent extends React.Component {
      /** 设置child的className=xyz并返回父包装div，保留可观测的最终DOM路径。 */
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

  /** 以含可枚举foo的无原型config克隆div；调用应正常完成，验证属性拷贝不依赖config继承Object.prototype。 */
  it('does not fail if config has no prototype', () => {
    const config = Object.create(null, {foo: {value: 1, enumerable: true}});
    React.cloneElement(<div />, config);
  });

  /** 祖父div持有yoloRef，父级克隆只改className；挂载后原ref.current仍指DIV，验证未覆盖ref时克隆保留原引用。 */
  it('should keep the original ref if it is not overridden', async () => {
    let component;
    /** 持有原对象ref并在挂载后暴露实例，检查不覆盖ref时的引用保留。 */
    class Grandparent extends React.Component {
      /** 原宿主div的对象ref；父级克隆没有提供新ref，它应在提交后获得DIV。 */
      yoloRef = React.createRef();

      /** 暴露ref的拥有者实例，让断言读取yoloRef.current。 */
      componentDidMount() {
        component = this;
      }

      /** 把带原yoloRef的div传给Parent，构造只覆盖普通prop的克隆输入。 */
      render() {
        return <Parent child={<div ref={this.yoloRef} />} />;
      }
    }

    /** 只覆盖className的克隆者，专门检查未传新ref时原引用是否保留。 */
    class Parent extends React.Component {
      /** 克隆child但不写ref字段，再提交到div内。 */
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

  /** 以key=xyz克隆无key的class element，clone.key应为xyz；检查配置中的新key更新协调身份字段。 */
  it('should transfer the key property', () => {
    /** 无宿主输出的class类型，作为key字段覆盖的描述对象输入。 */
    class Component extends React.Component {
      /** 返回null；本例不挂载组件，只读取clone.key。 */
      render() {
        return null;
      }
    }
    const clone = React.cloneElement(<Component />, {key: 'xyz'});
    expect(clone.key).toBe('xyz');
  });

  /** 通过clone配置传children=xyz后挂载class，在render中应读到xyz；验证普通children prop覆盖进入组件输入。 */
  it('should transfer children', async () => {
    /** 在真实render中断言通过clone配置传入的children。 */
    class Component extends React.Component {
      /** 读取children应为xyz后返回div，确保断言位于实际组件执行路径。 */
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

  /** 原class element的children是xyz，空配置克隆后render仍读到xyz；检查无子参数覆盖时保留原children值。 */
  it('should shallow clone children', async () => {
    /** 在真实render中观察空配置clone是否保留原children。 */
    class Component extends React.Component {
      /** 断言原children=xyz仍在props中，返回最小div完成挂载。 */
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

  /** 原children=xyz、配置也给children，再显式传div/span两个子参数；clone.props.children应只含这两个元素，验证位置参数优先覆盖且按序聚合。 */
  it('should accept children as rest arguments', () => {
    /** 充当位置子参数覆盖测试的element类型，不增加与children数组无关的输出。 */
    class Component extends React.Component {
      /** 返回null；该用例只创建和克隆描述对象，不执行组件render。 */
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

  /** createElement和cloneElement分别显式传undefined子参数，二者children都应为undefined；验证参数个数决定是否覆盖，不能用值是否undefined判断省略。 */
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

  /** Parent把span克隆为key=xyz并配置自己的xyzRef；检查clone的key/props.ref以及最终SPAN引用，验证描述字段与提交ref一致。 */
  it('should support keys and refs', async () => {
    let component;
    /** 在克隆时同时替换key和ref，使描述字段与DOM引用能交叉验证。 */
    class Parent extends React.Component {
      /** 克隆后span应挂到此对象ref；它与祖父用于取得Parent实例的ref不同。 */
      xyzRef = React.createRef();

      /** 将children克隆为key=xyz和自有ref，先断言描述字段，再返回克隆节点供commit。 */
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

    /** 持有Parent实例ref，为用例读取父组件的xyzRef建立入口。 */
    class Grandparent extends React.Component {
      /** 指向Parent class实例，间接访问克隆节点的xyzRef。 */
      parentRef = React.createRef();

      /** 暴露祖父实例，使断言可沿parentRef读取最终SPAN引用。 */
      componentDidMount() {
        component = this;
      }

      /** 创建原key=abc的span并给Parent绑定实例ref，构造key/ref同时覆盖场景。 */
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

  /** 原span使用祖父childRef，父级克隆改为xyzRef；提交后childRef仍为null而父ref指SPAN，验证原ref不会同时获得克隆节点。 */
  it('should steal the ref if a new ref is specified', async () => {
    let component;
    /** 提供新ref的克隆者，检查旧ref不会同时绑定同一span。 */
    class Parent extends React.Component {
      /** 替换原childRef的对象ref；最终应接收SPAN。 */
      xyzRef = React.createRef();

      /** 只覆盖child的ref并返回克隆节点，让commit绑定新ref。 */
      render() {
        const clone = React.cloneElement(this.props.children, {
          ref: this.xyzRef,
        });
        return <div>{clone}</div>;
      }
    }

    /** 分别持有Parent实例ref与原span ref，观察ref替换后的两条引用。 */
    class Grandparent extends React.Component {
      /** 取得Parent实例以检查其新xyzRef。 */
      parentRef = React.createRef();
      /** 原span的对象ref；克隆替换后它应保持current=null。 */
      childRef = React.createRef();

      /** 暴露两个ref的拥有者，供提交后同时检查旧ref与新ref。 */
      componentDidMount() {
        component = this;
      }

      /** 将带childRef的span交给Parent，并用parentRef保存克隆者实例。 */
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

  /** 把myprop=abc的class element克隆为xyz并挂载，组件render应看到xyz；检查普通config字段覆盖原props。 */
  it('should overwrite props', async () => {
    /** 在真实挂载时读取被覆盖的myprop，验证普通prop合并结果。 */
    class Component extends React.Component {
      /** 断言myprop从abc变为xyz，再返回div完成渲染。 */
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

  /** 克隆div时用一个包含两个无key元素的数组作子参数并挂载，开发构建应告警；验证动态数组路径执行缺key检查。 */
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

  /** 以含两个不同key的元素数组作clone子参数后挂载，不应产生未预期key告警；与无key数组例对照合法动态列表。 */
  it('does not warns for arrays of elements with keys', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(
        React.cloneElement(<div />, null, [<div key="#1" />, <div key="#2" />]),
      );
    });
  });

  /** 将两个无key的div直接作为独立子参数传入clone并挂载，不应出现动态数组缺key告警；检查静态位置子参数的验证边界。 */
  it('does not warn when the element is directly in rest args', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.cloneElement(<div />, null, <div />, <div />));
    });
  });

  /** 克隆时将两个普通对象组成数组传作子参数，调用本身无key告警；本例只检查clone阶段，不挂载这些对象，也不证明对象可被render。 */
  it('does not warn when the array contains a non-element', () => {
    React.cloneElement(<div />, null, [{}, {}]);
  });

  /** 使用原element.props作为克隆config，key/ref仍为null；验证开发特殊getter不会成为新的有效key/ref。 */
  it('should ignore key and ref warning getters', () => {
    const elementA = React.createElement('div');
    const elementB = React.cloneElement(elementA, elementA.props);
    expect(elementB.key).toBe(null);
    expect(elementB.ref).toBe(null);
  });

  /** 原element有key=12、ref=34，克隆config传undefined key/ref并改foo；身份和ref保留、foo变ef，访问兼容element.ref另报迁移提示。 */
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

  /** 原element有key/ref，克隆显式传null；key变字符串null而ref及props.ref为null，验证null覆盖与undefined忽略的区别。 */
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

  /** 向cloneElement传null，调用应抛出包含null输入的明确错误；检查入口拒绝缺失element而非进入props拷贝。 */
  it('throws an error if passed null', () => {
    const element = null;
    expect(() => React.cloneElement(element)).toThrow(
      'The argument must be a React element, but you passed null.',
    );
  });

  /** 传未赋值的element变量给cloneElement，应抛出包含undefined输入的错误；与null例区分诊断文本。 */
  it('throws an error if passed undefined', () => {
    let element;
    expect(() => React.cloneElement(element)).toThrow(
      'The argument must be a React element, but you passed undefined.',
    );
  });
});
