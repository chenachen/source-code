/** 对比两类错误边界 API 在 fallback 与失败子树同类型或异类型时的 reconciliation 结果。 */
describe('ErrorBoundaryReconciliation', () => {
  let BrokenRender;
  let DidCatchErrorBoundary;
  let GetDerivedErrorBoundary;
  let React;
  let ReactTestRenderer;
  let span;
  let act;

  /** 每例重建 Test Renderer 与两类边界夹具，确保错误状态和 Fiber 身份不会跨用例复用。 */
  beforeEach(() => {
    jest.resetModules();

    ReactTestRenderer = require('react-test-renderer');
    React = require('react');
    act = require('internal-test-utils').act;
    /** 通过 componentDidCatch 后续 setState 恢复的错误边界，覆盖 commit 后恢复路径。 */
    DidCatchErrorBoundary = class extends React.Component {
      /** null 表示正常渲染 children，非 null 表示改渲染 fallback。 */
      state = {error: null};
      /** 捕获错误后安排边界状态更新，验证旧式恢复 API。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 根据错误状态选择原子树或调用方指定标签的 fallback。 */
      render() {
        return this.state.error
          ? React.createElement(this.props.fallbackTagName, {
              prop: 'ErrorBoundary',
            })
          : this.props.children;
      }
    };

    /** 通过 getDerivedStateFromError 在 render 恢复阶段立即切换 fallback 的错误边界。 */
    GetDerivedErrorBoundary = class extends React.Component {
      /** 保存捕获结果，作为 fallback 分支的唯一状态门槛。 */
      state = {error: null};
      /** 把捕获错误转换为新 state，驱动同一 render 周期的恢复尝试。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 在正常 children 与指定宿主 fallback 标签间切换。 */
      render() {
        return this.state.error
          ? React.createElement(this.props.fallbackTagName, {
              prop: 'ErrorBoundary',
            })
          : this.props.children;
      }
    };

    // undefined 元素类型用于稳定触发 reconciler 的无效类型错误。
    const InvalidType = undefined;
    /** 根据 fail 决定输出正常 span 或无效元素类型，控制错误出现的更新时点。 */
    BrokenRender = ({fail}) =>
      fail ? <InvalidType /> : <span prop="BrokenRender" />;
  });

  /**
   * 先提交正常子树，再更新为失败子树；断言传入边界能恢复为指定 fallbackTagName。
   * 同时覆盖 fallback 与原输出标签相同或不同导致的复用、删除和插入边界。
   */
  async function sharedTest(ErrorBoundary, fallbackTagName) {
    let renderer;

    await act(() => {
      renderer = ReactTestRenderer.create(
        <ErrorBoundary fallbackTagName={fallbackTagName}>
          <BrokenRender fail={false} />
        </ErrorBoundary>,
        {unstable_isConcurrent: true},
      );
    });
    expect(renderer).toMatchRenderedOutput(<span prop="BrokenRender" />);
    await act(() => {
      renderer.update(
        <ErrorBoundary fallbackTagName={fallbackTagName}>
          <BrokenRender fail={true} />
        </ErrorBoundary>,
      );
    });

    const Fallback = fallbackTagName;
    expect(renderer).toMatchRenderedOutput(<Fallback prop="ErrorBoundary" />);
  }

  /**
   * Given componentDidCatch 边界与初始 span；When 同位置子树抛错且 fallback 仍为 span；
   * Then 边界通过 setState 恢复并正确更新同类型宿主节点。验证 ReactFiberThrow 与 ReactChildFiber 的同类型复用路径。
   */
  it('componentDidCatch can recover by rendering an element of the same type', () =>
    sharedTest(DidCatchErrorBoundary, 'span'));

  /**
   * Given componentDidCatch 边界与初始 span；When 失败后改渲染 div fallback；
   * Then 旧宿主节点被替换且边界恢复完成。验证 ReactFiberThrow 与 ReactChildFiber 的异类型替换路径。
   */
  it('componentDidCatch can recover by rendering an element of a different type', () =>
    sharedTest(DidCatchErrorBoundary, 'div'));

  /**
   * Given getDerivedStateFromError 边界；When span 子树失败且 fallback 同为 span；
   * Then render 恢复阶段立即选中 fallback，并复用合法宿主类型。验证 ReactFiberThrow 的派生状态恢复路径。
   */
  it('getDerivedStateFromError can recover by rendering an element of the same type', () =>
    sharedTest(GetDerivedErrorBoundary, 'span'));

  /**
   * Given getDerivedStateFromError 边界；When span 子树失败而 fallback 为 div；
   * Then 恢复 render 删除旧节点并提交新类型。验证错误恢复与 reconciliation 组合边界。
   */
  it('getDerivedStateFromError can recover by rendering an element of a different type', () =>
    sharedTest(GetDerivedErrorBoundary, 'div'));
});
