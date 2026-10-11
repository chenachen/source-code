/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */
'use strict';

let React;
let ReactNoop;
let waitForAll;
let assertConsoleErrorDev;

/** 覆盖 Fragment、数组、可迭代对象与组件边界之间的子 Fiber 展开、身份匹配及状态保留规则。 */
describe('ReactFragment', () => {
  /** 重置模块注册表并重新绑定 ReactNoop 与断言工具，隔离每个协调场景的根、日志及告警去重状态。 */
  beforeEach(function () {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** Given Fragment 只包裹一个宿主子节点；When 交给 ReactNoop 渲染并清空调度队列；Then Fragment 本身不生成宿主节点，只留下 span。通过最终宿主输出验证 Fragment 子 Fiber 的透明展开。 */
  it('should render a single child via noop renderer', async () => {
    const element = (
      <>
        <span>foo</span>
      </>
    );

    ReactNoop.render(element);
    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(<span>foo</span>);
  });

  /** Given 空 Fragment；When 渲染并清空调度队列；Then 宿主输出为 null。通过 ReactNoop 的最终树验证空子节点不会产生占位宿主实例。 */
  it('should render zero children via noop renderer', async () => {
    const element = <React.Fragment />;

    ReactNoop.render(element);
    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** Given Fragment 同时包含文本与宿主元素；When 渲染并提交；Then 两个子节点保持顺序出现在输出中。通过 ReactNoop 的最终树验证 Fragment 展开后的兄弟链。 */
  it('should render multiple children via noop renderer', async () => {
    const element = (
      <>
        hello <span>world</span>
      </>
    );

    ReactNoop.render(element);
    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        hello <span>world</span>
      </>,
    );
  });

  /** Given Fragment 的 children 是带稳定 key 的 Set；When 协调器消费迭代器并提交；Then 两个元素按迭代顺序渲染。通过 ReactNoop 输出验证 ReactChildFiber 的 iterable 子节点路径。 */
  it('should render an iterable via noop renderer', async () => {
    const element = (
      <>{new Set([<span key="a">hi</span>, <span key="b">bye</span>])}</>
    );

    ReactNoop.render(element);
    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>hi</span>
        <span>bye</span>
      </>,
    );
  });

  /** Given Stateful 在单节点与一层 Fragment 包装的同 key 位置间切换；When Foo 正反向更新；Then实例被复用并各触发一次更新。通过 componentDidUpdate 日志与宿主输出验证一层未加 key Fragment 的透明协调规则。 */
  it('should preserve state of children with 1 level nesting', async function () {
    const ops = [];

    /** 用更新生命周期辨认 key=a 的子组件是否在一层 Fragment 展开前后仍是同一实例。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 输出固定 Hello；新增 World 兄弟由 Foo 控制，实例延续由 componentDidUpdate 记录验证。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** condition 在裸 Stateful 与无 key Fragment 的 a/b 两个 children 间切换，保持 Stateful 的 key=a。 */
    function Foo({condition}) {
      return condition ? (
        <Stateful key="a" />
      ) : (
        <>
          <Stateful key="a" />
          <div key="b">World</div>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Hello</div>
        <div>World</div>
      </>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 条件两侧都是顶层未加 key Fragment，且包含同位置 Stateful；When 条件往返切换；Then Stateful 保留身份并持续更新。通过更新日志验证顶层 Fragment 不引入额外身份边界。 */
  it('should preserve state between top-level fragments', async function () {
    const ops = [];

    /** 作为顶层无 key Fragment 两种返回形态之间的实例复用探针，不依赖宿主内容变化。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 两次分支都输出相同 Hello，令测试以更新生命周期而非文本差异判断复用。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 两侧都返回一个顶层无 key Fragment，保持内部 Stateful 的相同位置。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <Stateful />
        </>
      ) : (
        <>
          <Stateful />
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 条件两侧保持相同 Fragment 嵌套层级，只在同层插入兄弟节点；When Foo 往返更新；Then同 key Stateful 仍被复用。通过更新日志和输出顺序验证同层 key 匹配。 */
  it('should preserve state of children nested at same level', async function () {
    const ops = [];

    /** 检测三层 Fragment 内 key=a 的组件在同层插入兄弟后是否保留实例。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 输出用于最终兄弟顺序断言的 Hello 节点；生命周期日志另证实组件未重挂载。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 保持三层 Fragment 路径，在最内层 Stateful 前插入或移除无 key div，依 key=a 找回原组件。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <>
            <>
              <Stateful key="a" />
            </>
          </>
        </>
      ) : (
        <>
          <>
            <>
              <div />
              <Stateful key="a" />
            </>
          </>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div />
        <div>Hello</div>
      </>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Stateful 从双层 Fragment 移到单层 Fragment；When 条件往返切换；Then层级身份路径改变导致组件重挂载。通过零次 componentDidUpdate 验证 ReactChildFiber 不会跨非顶层 Fragment 边界复用。 */
  it('should not preserve state in non-top-level fragment nesting', async function () {
    const ops = [];

    /** 辨认 Stateful 跨非顶层 Fragment 身份边界时被重新挂载，而非已有实例更新。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 新旧实例都返回 Hello，宿主树一致不作为跨层复用证据。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** condition 在双层与单层 Fragment 之间切换，即使 key=a 不变也改变组件的父 Fiber 路径。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <>
            <Stateful key="a" />
          </>
        </>
      ) : (
        <>
          <Stateful key="a" />
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Stateful 在裸节点与双层 Fragment 包装间切换；When 连续反向渲染；Then超过一层的包装变化会重置状态。通过更新日志始终为空验证实例替换。 */
  it('should not preserve state of children if nested 2 levels without siblings', async function () {
    const ops = [];

    /** 为裸节点与双层无 key Fragment 的对照提供更新生命周期计数。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 保持 Hello 输出不变，重挂载与否由 ops 是否新增 Update Stateful 区分。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 把 key=a 的 Stateful 从直接返回值移入双层 Fragment；没有额外宿主兄弟参与此场景。 */
    function Foo({condition}) {
      return condition ? (
        <Stateful key="a" />
      ) : (
        <>
          <>
            <Stateful key="a" />
          </>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Stateful 从裸节点进入带兄弟节点的双层 Fragment；When 条件往返切换；Then层级和兄弟结构变化使旧 Fiber 无法匹配。通过无更新日志及最终宿主树验证重挂载。 */
  it('should not preserve state of children if nested 2 levels with siblings', async function () {
    const ops = [];

    /** 观察直接组件移入双层 Fragment 且出现外层兄弟时的身份变化。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 提供双层包装分支中第一个 Hello 宿主节点；外层空 div 由 Foo 添加。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 在直接 Stateful 与双层 Fragment 加空 div 兄弟之间切换，保留子组件 key=a 作为对照。 */
    function Foo({condition}) {
      return condition ? (
        <Stateful key="a" />
      ) : (
        <>
          <>
            <Stateful key="a" />
          </>
          <div />
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Hello</div>
        <div />
      </>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 同 key Stateful 在 Fragment 直接子节点与 Fragment 内单元素数组间切换；When 往返更新；Then实例被保留。通过更新日志验证单层数组与 Fragment 的透明子节点匹配。 */
  it('should preserve state between array nested in fragment and fragment', async function () {
    const ops = [];

    /** 验证顶层 Fragment 内的单元素数组不会让 key=a 的子组件重新挂载。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 数组和直接子节点两种路径均输出 Hello，使生命周期日志成为复用信号。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 顶层无 key Fragment 保持不变，children 在直接 Stateful 与单元素数组之间切换。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <Stateful key="a" />
        </>
      ) : (
        <>{[<Stateful key="a" />]}</>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 顶层单元素数组与顶层 Fragment 都承载同 key Stateful；When 两种返回形态往返切换；Then组件身份保持。通过 componentDidUpdate 次数验证顶层容器形态可等价协调。 */
  it('should preserve state between top level fragment and array', async function () {
    const ops = [];

    /** 检查顶层单元素数组与顶层无 key Fragment 之间的组件实例延续。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 保留相同 Hello 内容；两次更新是否命中同一实例由生命周期日志反映。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** condition 在顶层数组与 Fragment 两种返回值中保留同一个 key=a 的 Stateful 类型。 */
    function Foo({condition}) {
      return condition ? (
        [<Stateful key="a" />]
      ) : (
        <>
          <Stateful key="a" />
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Stateful 从 Fragment 内数组切换到双层 Fragment；When 条件往返更新；Then额外嵌套层级改变身份路径并触发重挂载。通过更新日志为空验证边界。 */
  it('should not preserve state between array nested in fragment and double nested fragment', async function () {
    const ops = [];

    /** 为数组展开路径与双层 Fragment 边界的对照记录已有实例更新次数。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 相同 Hello 输出覆盖两条结构路径，防止仅凭最终宿主树误判状态保留。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 从顶层 Fragment 的数组 children 切换成双层 Fragment，新增一个实际的内部身份边界。 */
    function Foo({condition}) {
      return condition ? (
        <>{[<Stateful key="a" />]}</>
      ) : (
        <>
          <>
            <Stateful key="a" />
          </>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Stateful 从顶层 Fragment 内数组切换到双层数组；When 条件往返更新；Then顶层无 key Fragment 展开后直接协调 Stateful，而双层数组仍留下嵌套 Fragment Fiber。身份边界变化使更新日志始终为空。 */
  it('should not preserve state between array nested in fragment and double nested array', async function () {
    const ops = [];

    /** 检测顶层 Fragment 内数组改成双层数组时的组件重挂载。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 固定返回 Hello；此场景没有文本变化，零更新日志才是实例被替换的证据。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 两侧分别为 Fragment 包裹单层数组与双层数组，后者保留一层嵌套 Fragment Fiber。 */
    function Foo({condition}) {
      return condition ? (
        <>{[<Stateful key="a" />]}</>
      ) : (
        [[<Stateful key="a" />]]
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 条件两侧分别是双层 Fragment 与双层数组，Stateful 位于相同深度；When 往返切换；Then协调器保留组件身份。通过两次 componentDidUpdate 验证等深子节点路径可匹配。 */
  it('should preserve state between double nested fragment and double nested array', async function () {
    const ops = [];

    /** 验证双层 Fragment 与双层数组在等深路径下可复用 key=a 的组件。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 两种等深容器都输出 Hello，生命周期日志应累计两次更新。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 在双层 Fragment 和双层数组之间切换，保留嵌套深度与 key=a 的位置。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <>
            <Stateful key="a" />
          </>
        </>
      ) : (
        [[<Stateful key="a" />]]
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 两个显式 Fragment 使用不同 key；When 条件切换 Fragment；Then即使内部组件类型相同也会重挂载。通过更新日志为空验证 key 是 Fragment 身份边界。 */
  it('should not preserve state of children when the keys are different', async function () {
    const ops = [];

    /** 验证父 Fragment key 改变时内部 Stateful 即使同类型也不会复用。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 提供新旧 keyed Fragment 都具有的 Hello 内容，避免内容变化干扰身份判断。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** condition 将父 Fragment 的 key 从 a 改为 b，并在 b 分支添加 World 兄弟。 */
    function Foo({condition}) {
      return condition ? (
        <React.Fragment key="a">
          <Stateful />
        </React.Fragment>
      ) : (
        <React.Fragment key="b">
          <Stateful />
          <span>World</span>
        </React.Fragment>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Hello</div>
        <span>World</span>
      </>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Stateful 在有 key 与无 key Fragment 之间切换；When 条件往返更新；Then Fragment 身份不相等并重置子树状态。通过零次更新日志验证 keyed/unkeyed 边界。 */
  it('should not preserve state between unkeyed and keyed fragment', async function () {
    const ops = [];

    /** 区分 keyed Fragment 保留的边界与顶层 unkeyed Fragment 展开后的直接子组件。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 两条路径都渲染 Hello，预期无 Update Stateful 来证明父级身份边界改变。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 在 key=a 的 Fragment 与无 key Fragment 间切换，内部 Stateful 本身不带 key。 */
    function Foo({condition}) {
      return condition ? (
        <React.Fragment key="a">
          <Stateful />
        </React.Fragment>
      ) : (
        <>
          <Stateful />
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 带稳定 key 的 Fragment、宿主容器和 Stateful 在多层兄弟中重排；When Foo 正反向更新；Then协调器按 key 找回原 Fiber 并保留状态。通过更新日志与精确输出顺序验证多层 reconcileChildrenArray。 */
  it('should preserve state with reordering in multiple levels', async function () {
    const ops = [];

    /** 作为多层 keyed 重排中深层 key=a 组件的身份探针。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 渲染被 key=b 容器包裹的 Hello；父级 Fragment 和容器移动均不改变该输出。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 同时重排 key=c Fragment 与其中 key=b 容器，Stateful 的 key=a 保持；无 key span 仅改变邻接内容。 */
    function Foo({condition}) {
      return condition ? (
        <div>
          <React.Fragment key="c">
            <span>foo</span>
            <div key="b">
              <Stateful key="a" />
            </div>
          </React.Fragment>
          <span>boop</span>
        </div>
      ) : (
        <div>
          <span>beep</span>
          <React.Fragment key="c">
            <div key="b">
              <Stateful key="a" />
            </div>
            <span>bar</span>
          </React.Fragment>
        </div>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>beep</span>
        <div>
          <div>Hello</div>
        </div>
        <span>bar</span>
      </div>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>foo</span>
        <div>
          <div>Hello</div>
        </div>
        <span>boop</span>
      </div>,
    );
  });

  /** Given 同一槽位从带 key Fragment 切换为无 key 数组；When 更新并捕获列表 key 警告；Then Stateful 重挂载且警告符合预期。通过零次更新日志、控制台断言和宿主输出联合验证。 */
  it('should not preserve state when switching to a keyed fragment to an array', async () => {
    const ops = [];

    /** 检测宿主 div 内 key=foo Fragment 切为无 key 数组时子组件被重挂载。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 始终输出 Hello，与另一个空 span 一起构成相同宿主结构；身份结果由更新日志区分。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 在相同 div 槽位切换 keyed Fragment 与无 key 数组，数组中的 Stateful 故意缺 key 以验证警告。 */
    function Foo({condition}) {
      return condition ? (
        <div>
          {
            <React.Fragment key="foo">
              <Stateful />
            </React.Fragment>
          }
          <span />
        </div>
      ) : (
        <div>
          {[<Stateful />]}
          <span />
        </div>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n' +
        '\n' +
        'Check the render method of `div`. ' +
        'It was passed a child from Foo. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in Foo (at **)',
    ]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <div>Hello</div>
        <span />
      </div>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <div>Hello</div>
        <span />
      </div>,
    );
  });

  /** Given 嵌套未加 key Fragment 被普通 Passthrough 组件边界替换；When 条件往返切换；Then组件边界改变使 Stateful 重挂载。通过更新日志为空验证 Fragment 与函数组件不可互换。 */
  it('should not preserve state when switching a nested unkeyed fragment to a passthrough component', async function () {
    const ops = [];

    /** 原样返回 children，但刻意引入函数组件 Fiber 边界，用于和透明 Fragment/数组边界对照。 */
    function Passthrough({children}) {
      return children;
    }

    /** 用于证明嵌套 unkeyed Fragment 与 Passthrough 函数组件不是同一身份边界。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 两种父级都转发为 Hello 输出，只有更新日志能够辨认组件是否重挂载。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 保持顶层 Fragment，在内部 Fragment 与 Passthrough 之间替换 Stateful 的父节点类型。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <>
            <Stateful />
          </>
        </>
      ) : (
        <>
          <Passthrough>
            <Stateful />
          </Passthrough>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 嵌套带 key Fragment 被 Passthrough 组件替换；When 条件往返切换；Then即使子内容相同也不会跨组件类型复用。通过零次更新日志验证边界身份。 */
  it('should not preserve state when switching a nested keyed fragment to a passthrough component', async function () {
    const ops = [];

    /** 原样返回 children，但刻意引入函数组件 Fiber 边界，用于和透明 Fragment/数组边界对照。 */
    function Passthrough({children}) {
      return children;
    }

    /** 检查 keyed Fragment 被 Passthrough 替换时内部 Stateful 的实例重置。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 让 keyed Fragment 与函数父边界产生同样的 Hello 宿主内容作为对照。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 在顶层 Fragment 内，将 key=a 的 Fragment 替换为无 key Passthrough，子内容类型不变。 */
    function Foo({condition}) {
      return condition ? (
        <>
          <React.Fragment key="a">
            <Stateful />
          </React.Fragment>
        </>
      ) : (
        <>
          <Passthrough>
            <Stateful />
          </Passthrough>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given Fragment 内带 key 数组被 Passthrough 组件替换；When 条件往返切换；Then容器类型变化重置 Stateful。通过更新日志为空验证数组展开与函数组件边界不同。 */
  it('should not preserve state when switching a nested keyed array to a passthrough component', async function () {
    const ops = [];

    /** 原样返回 children，但刻意引入函数组件 Fiber 边界，用于和透明 Fragment/数组边界对照。 */
    function Passthrough({children}) {
      return children;
    }

    /** 比较 key=a 的数组子元素与 Passthrough 内无 key 子元素的实例延续。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 返回固定 Hello，以零次 componentDidUpdate 辨认容器形态替换后的新实例。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 在 Fragment 的 keyed 单元素数组与 Passthrough 子树间切换；后一分支也移除 Stateful 的 key。 */
    function Foo({condition}) {
      return condition ? (
        <>{[<Stateful key="a" />]}</>
      ) : (
        <>
          <Passthrough>
            <Stateful />
          </Passthrough>
        </>
      );
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });

  /** Given 两个无 key 顶层数组保持相同槽位和 Fragment 结构；When 条件往返更新；Then Stateful 保留身份，而缺失 key 的警告在首次渲染后被组件级去重。通过更新日志、控制台断言与宿主输出验证位置匹配。 */
  it('should preserve state when it does not change positions', async function () {
    const ops = [];

    /** 验证无 key 顶层数组中第二槽位的 Fragment 不变时 Stateful 仍能更新。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 提供 span 之后的 Hello 宿主节点，配合输出顺序与生命周期次数验证位置匹配。 */
      render() {
        return <div>Hello</div>;
      }
    }

    /** 两侧均返回无 key 数组 [span, Fragment(Stateful)]，保留槽位并故意触发一次列表 key 警告。 */
    function Foo({condition}) {
      return condition
        ? [
            <span />,
            <>
              <Stateful />
            </>,
          ]
        : [
            <span />,
            <>
              <Stateful />
            </>,
          ];
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n' +
        '\n' +
        'Check the top-level render call using <Foo>. ' +
        'It was passed a child from Foo. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Foo (at **)',
    ]);

    ReactNoop.render(<Foo condition={false} />);
    // 同一组件内的 key 警告会去重，因此这里不会再次记录。
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span />
        <div>Hello</div>
      </>,
    );

    ReactNoop.render(<Foo condition={true} />);
    // 同一组件内的 key 警告会去重，因此这里不会再次记录。
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span />
        <div>Hello</div>
      </>,
    );
  });

  /** Given Stateful 从直接子节点切换到 Lazy 解析出的同 key Fragment 子树；When Lazy 完成并往返更新；Then协调器复用 Stateful 且添加额外兄弟节点。通过更新日志和最终输出验证 Lazy 解包后的 Fragment 协调。 */
  it('should preserve state of children when adding a fragment wrapped in Lazy', async function () {
    const ops = [];

    /** 验证 Lazy child 解包得到 Fragment 后可继续复用直接返回的 key=a 子组件。 */
    class Stateful extends React.Component {
      /** 记录既有实例完成更新；若组件被重挂载，此生命周期不会留下记录。 */
      componentDidUpdate() {
        ops.push('Update Stateful');
      }

      /** 产生稳定 Hello 节点；Lazy 解包后的新增 World 节点由已加载 Fragment 提供。 */
      render() {
        return <div>Hello</div>;
      }
    }

    const lazyChild = React.lazy(async () => ({
      default: (
        <>
          <Stateful key="a" />
          <div key="b">World</div>
        </>
      ),
    }));

    /** condition 在直接 key=a Stateful 与解析为 Fragment 描述值的 lazyChild 之间切换。 */
    function Foo({condition}) {
      return condition ? <Stateful key="a" /> : lazyChild;
    }

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    ReactNoop.render(<Foo condition={false} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>Hello</div>
        <div>World</div>
      </>,
    );

    ReactNoop.render(<Foo condition={true} />);
    await waitForAll([]);

    expect(ops).toEqual(['Update Stateful', 'Update Stateful']);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);
  });
});
