/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMEventListener', () => {
  let React;
  let ReactDOM;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;
  let simulateEventDispatch;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    simulateEventDispatch =
      require('internal-test-utils').simulateEventDispatch;
  });

  describe('Propagation', () => {
    /** 两个独立根提交后把 child 容器插入 parent DOM，再从 child 发送冒泡 mouseout；断言 currentTarget 依次为 child、parent 共两次，验证事件跨嵌套根容器分别分发；finally 移除外层容器。 */
    it('should propagate events one level down', async () => {
      const mouseOut = jest.fn();
      /** 把合成事件的 currentTarget 传给 mouseOut mock，区分嵌套两个根当前执行的宿主节点。 */
      const onMouseOut = event => mouseOut(event.currentTarget);

      const childContainer = document.createElement('div');
      const parentContainer = document.createElement('div');

      const childRoot = ReactDOMClient.createRoot(childContainer);
      const parentRoot = ReactDOMClient.createRoot(parentContainer);

      await act(() => {
        childRoot.render(<div onMouseOut={onMouseOut}>Child</div>);
        parentRoot.render(<div onMouseOut={onMouseOut}>Parent</div>);
      });
      const parentNode = parentContainer.firstChild;
      const childNode = childContainer.firstChild;

      parentNode.appendChild(childContainer);
      document.body.appendChild(parentContainer);

      try {
        const nativeEvent = document.createEvent('Event');
        nativeEvent.initEvent('mouseout', true, true);
        childNode.dispatchEvent(nativeEvent);

        expect(mouseOut).toHaveBeenCalledTimes(2);
        expect(mouseOut).toHaveBeenNthCalledWith(1, childNode);
        expect(mouseOut).toHaveBeenNthCalledWith(2, parentNode);
      } finally {
        document.body.removeChild(parentContainer);
      }
    });

    /** 三个根按 DOM 嵌套，child 发送冒泡 mouseout；断言 currentTarget 为 child→parent→grandparent 共三次，验证根边界间的原生传播与合成处理顺序。 */
    it('should propagate events two levels down', async () => {
      const mouseOut = jest.fn();
      /** 记录 currentTarget 到共享 mock，供三个嵌套根的分发顺序断言。 */
      const onMouseOut = event => mouseOut(event.currentTarget);

      const childContainer = document.createElement('div');
      const parentContainer = document.createElement('div');
      const grandParentContainer = document.createElement('div');

      const childRoot = ReactDOMClient.createRoot(childContainer);
      const parentRoot = ReactDOMClient.createRoot(parentContainer);
      const grandParentRoot = ReactDOMClient.createRoot(grandParentContainer);

      await act(() => {
        childRoot.render(<div onMouseOut={onMouseOut}>Child</div>);
        parentRoot.render(<div onMouseOut={onMouseOut}>Parent</div>);
        grandParentRoot.render(<div onMouseOut={onMouseOut}>Grandparent</div>);
      });
      const childNode = childContainer.firstChild;
      const parentNode = parentContainer.firstChild;
      const grandParentNode = grandParentContainer.firstChild;

      parentNode.appendChild(childContainer);
      grandParentNode.appendChild(parentContainer);

      document.body.appendChild(grandParentContainer);

      try {
        const nativeEvent = document.createEvent('Event');
        nativeEvent.initEvent('mouseout', true, true);
        childNode.dispatchEvent(nativeEvent);

        expect(mouseOut).toHaveBeenCalledTimes(3);
        expect(mouseOut).toHaveBeenNthCalledWith(1, childNode);
        expect(mouseOut).toHaveBeenNthCalledWith(2, parentNode);
        expect(mouseOut).toHaveBeenNthCalledWith(3, grandParentNode);
      } finally {
        document.body.removeChild(grandParentContainer);
      }
    });

    // 针对 https://github.com/facebook/react/issues/1105 的回归测试。
    /** MyComponent 初始输出可点击 button，click 更新 clicked 后替换为 span；mount/update 回调均断言 findDOMNode 为容器当前首节点，最终文本 clicked，验证事件使原目标删除后宿主实例查找仍对应提交树。 */
    it('should not get confused by disappearing elements', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      try {
        /** clicked 初始false输出button，click后输出span，并在两个提交回调检查 findDOMNode，构造事件目标被删除场景。 */
        class MyComponent extends React.Component {
          /** clicked=false 保留初始 button；handleClick 将它变true以替换根宿主类型。 */
          state = {clicked: false};
          /** click 时 setState(clicked=true)，让下一次提交删除原按钮并创建 span。 */
          handleClick = () => {
            this.setState({clicked: true});
          };
          /** 挂载完成后断言类实例对应 container.firstChild，建立宿主查找基线。 */
          componentDidMount() {
            expect(
              ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
                this,
              ),
            ).toBe(container.firstChild);
          }
          /** 更新完成后再次断言 findDOMNode 对应新的首节点，验证按钮替换后的关联。 */
          componentDidUpdate() {
            expect(
              ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
                this,
              ),
            ).toBe(container.firstChild);
          }
          /** 依据 clicked 返回 span 或带 handleClick 的 button，不复用相同宿主类型。 */
          render() {
            if (this.state.clicked) {
              return <span>clicked!</span>;
            } else {
              return (
                <button onClick={this.handleClick}>not yet clicked</button>
              );
            }
          }
        }
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<MyComponent />);
        });
        await act(() => {
          container.firstChild.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
            }),
          );
        });
        expect(container.firstChild.textContent).toBe('clicked!');
      } finally {
        document.body.removeChild(container);
      }
    });

    /** 嵌套两个根的 Child/Parent click 分别给 Child 设1/2并立即读取 DOM；simulateEventDispatch 后两回调分别看到 Child、1，最终2，验证本离散事件中两个根监听边界间的冲刷时序。 */
    it('should batch between handlers from different roots (discrete)', async () => {
      const mock = jest.fn();

      const childContainer = document.createElement('div');
      const parentContainer = document.createElement('main');

      const childRoot = ReactDOMClient.createRoot(childContainer);
      const parentRoot = ReactDOMClient.createRoot(parentContainer);
      let childSetState;

      /** 外根输出 Parent section，并在 click 时更新内根 Child；state仅维持固定父文本，供两个根监听边界观测。 */
      function Parent() {
        // eslint-disable-next-line no-unused-vars
        const [state, _] = React.useState('Parent');
        /** 给内根 Child 提交值2，随后立即读取其 textContent 传给 mock，观察前一个根的离散更新何时可见。 */
        const handleClick = () => {
          childSetState(2);
          mock(childContainer.firstChild.textContent);
        };
        return <section onClick={handleClick}>{state}</section>;
      }

      /** 内根输出 state span，暴露 setter 给 Parent；本地 click 先安排值1再读取当前DOM。 */
      function Child() {
        const [state, setState] = React.useState('Child');
        childSetState = setState;
        /** 提交 Child 值1并立即记录旧 DOM textContent，供离散事件批处理起点断言。 */
        const handleClick = () => {
          setState(1);
          mock(childContainer.firstChild.textContent);
        };
        return <span onClick={handleClick}>{state}</span>;
      }

      await act(() => {
        childRoot.render(<Child />);
        parentRoot.render(<Parent />);
      });

      const childNode = childContainer.firstChild;
      const parentNode = parentContainer.firstChild;

      parentNode.appendChild(childContainer);
      document.body.appendChild(parentContainer);

      try {
        await act(async () => {
          await simulateEventDispatch(childNode, 'click');
        });

        // 子组件和父组件都应该通过事件处理器调用。
        expect(mock).toHaveBeenCalledTimes(2);
        // 第一次调用安排 Child 渲染为 '1'；但当前处于批处理阶段，尚未冲刷。
        expect(mock.mock.calls[0][0]).toBe('Child');
        // 两个 root 各有一个事件监听器，因此会两次进入事件批处理阶段，并把 Child 冲刷为 '1'。

        // 无法预知是否还会有另一个事件，因为后续处理器可能调用 stopPropagation()。
        // 内部讨论后的当前取舍是允许过度冲刷：新事件系统本来就是破坏性变更；
        // 后续可在细化 scheduler 时重新评估，例如利用 isInputPending()。
        // 这是离散事件，所以前一次更新此时已经完成。
        expect(mock.mock.calls[1][0]).toBe('1');

        // 离开处理器时，第二次更新也已冲刷。
        expect(childNode.textContent).toBe('2');
      } finally {
        document.body.removeChild(parentContainer);
      }
    });

    /** 同样嵌套两根，但以 mouseout 连续事件设 Child=1/2；两个处理器均读取旧 Child，act 结束后为2，验证连续事件更新在该分发完成后合并提交。 */
    it('should batch between handlers from different roots (continuous)', async () => {
      const mock = jest.fn();

      const childContainer = document.createElement('div');
      const parentContainer = document.createElement('main');

      const childRoot = ReactDOMClient.createRoot(childContainer);
      const parentRoot = ReactDOMClient.createRoot(parentContainer);
      let childSetState;

      /** 外根 Parent section 通过 mouseout 更新内根；使用固定 Parent 文本构造连续事件的跨根分发。 */
      function Parent() {
        // eslint-disable-next-line no-unused-vars
        const [state, _] = React.useState('Parent');
        /** 连续事件回调提交 Child 值2，再同步读取内根 DOM，供更新尚未提交的断言。 */
        const handleMouseOut = () => {
          childSetState(2);
          mock(childContainer.firstChild.textContent);
        };
        return <section onMouseOut={handleMouseOut}>{state}</section>;
      }

      /** 内根 Child span 暴露 setter，本地 mouseout 提交值1并观察同步DOM，与外根处理器对照。 */
      function Child() {
        const [state, setState] = React.useState('Child');
        childSetState = setState;
        /** 提交 Child=1后立即记录 textContent；连续事件用例此时仍读取 Child。 */
        const handleMouseOut = () => {
          setState(1);
          mock(childContainer.firstChild.textContent);
        };
        return <span onMouseOut={handleMouseOut}>{state}</span>;
      }

      await act(() => {
        childRoot.render(<Child />);
        parentRoot.render(<Parent />);
      });

      const childNode = childContainer.firstChild;
      const parentNode = parentContainer.firstChild;

      parentNode.appendChild(childContainer);
      document.body.appendChild(parentContainer);

      try {
        await act(async () => {
          await simulateEventDispatch(childNode, 'mouseout');
        });

        // 子组件和父组件都应该通过事件处理器调用。
        expect(mock).toHaveBeenCalledTimes(2);
        // 第一次调用安排 Child 渲染为 '1'；但当前处于批处理阶段，尚未冲刷。
        expect(mock.mock.calls[0][0]).toBe('Child');
        // 两个 root 各有一个事件监听器，因此会两次进入事件批处理阶段；
        // 但这是连续事件，所以此时仍未冲刷。
        expect(mock.mock.calls[1][0]).toBe('Child');

        // 批量更新在事件之后应用。
        expect(childNode.textContent).toBe('2');
      } finally {
        document.body.removeChild(parentContainer);
      }
    });
  });

  /** 同一 React 树 outer 监听 mouseout、内层无监听器；内层分发冒泡事件后 mock 收到真实 target=innerRef，验证祖先回调保持原事件目标；该断言没有检查调用次数。 */
  it('should not fire duplicate events for a React DOM tree', async () => {
    const mouseOut = jest.fn();
    /** 把原生目标对应的合成 event.target 交给 mock，验证祖先回调不把target改为currentTarget。 */
    const onMouseOut = event => mouseOut(event.target);

    const innerRef = React.createRef();
    /** 输出带 outer mouseout handler 与 innerRef 的三层 div，构造单根祖先事件回调 fixture。 */
    class Wrapper extends React.Component {
      /** 返回固定 outer/inner DOM，内层只有ref、没有自己的mouseout handler。 */
      render() {
        return (
          <div>
            <div onMouseOut={onMouseOut} id="outer">
              <div ref={innerRef}>Inner</div>
            </div>
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Wrapper />);
    });

    document.body.appendChild(container);

    try {
      const nativeEvent = document.createEvent('Event');
      nativeEvent.initEvent('mouseout', true, true);
      await act(() => {
        innerRef.current.dispatchEvent(nativeEvent);
      });

      expect(mouseOut).toBeCalledWith(innerRef.current);
    } finally {
      document.body.removeChild(container);
    }
  });

  // 针对 https://github.com/facebook/react/pull/12877 的回归测试。
  /** form/input 分别监听 reset/submit/invalid；手动分发非冒泡 invalid 与冒泡 reset/submit，各首次一次，再次 submit 后累计两次，验证表单事件不因监听路径重复分发。 */
  it('should not fire form events twice', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const formRef = React.createRef();
    const inputRef = React.createRef();

    const handleInvalid = jest.fn();
    const handleReset = jest.fn();
    const handleSubmit = jest.fn();

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <form ref={formRef} onReset={handleReset} onSubmit={handleSubmit}>
          <input ref={inputRef} onInvalid={handleInvalid} />
        </form>,
      );
    });

    await act(() => {
      inputRef.current.dispatchEvent(
        new Event('invalid', {
          // https://developer.mozilla.org/en-US/docs/Web/Events/invalid
          bubbles: false,
        }),
      );
    });
    expect(handleInvalid).toHaveBeenCalledTimes(1);

    await act(() => {
      formRef.current.dispatchEvent(
        new Event('reset', {
          // https://developer.mozilla.org/en-US/docs/Web/Events/reset
          bubbles: true,
        }),
      );
    });
    expect(handleReset).toHaveBeenCalledTimes(1);

    await act(() => {
      formRef.current.dispatchEvent(
        new Event('submit', {
          // https://developer.mozilla.org/en-US/docs/Web/Events/submit
          bubbles: true,
        }),
      );
    });
    expect(handleSubmit).toHaveBeenCalledTimes(1);

    await act(() => {
      formRef.current.dispatchEvent(
        new Event('submit', {
          // 可能发生在较旧的浏览器上。
          bubbles: true,
        }),
      );
    });
    expect(handleSubmit).toHaveBeenCalledTimes(2); // 在这个测试中,它已经触发了.

    document.body.removeChild(container);
  });

  // submit/reset 的冒泡阶段由根容器监听；中间 DOM 节点停止原生冒泡后，React 的 onSubmit/onReset 不应触发。
  /** form 的中间 div 通过原生 onsubmit/onreset stopPropagation；分发表单冒泡事件后 React mock 均不调用，验证未到达根冒泡监听器时不会合成 submit/reset。 */
  it('should not receive submit events if native, interim DOM handler prevents it', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    try {
      const formRef = React.createRef();
      const interimRef = React.createRef();

      const handleSubmit = jest.fn();
      const handleReset = jest.fn();
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div ref={interimRef}>
            <form ref={formRef} onSubmit={handleSubmit} onReset={handleReset} />
          </div>,
        );
      });

      /** 中间DOM的原生submit回调 stopPropagation，阻断事件到达React根的冒泡监听器。 */
      interimRef.current.onsubmit = nativeEvent =>
        nativeEvent.stopPropagation();
      /** 中间DOM的原生reset回调 stopPropagation，让React根无法接收该原生冒泡事件。 */
      interimRef.current.onreset = nativeEvent => nativeEvent.stopPropagation();

      await act(() => {
        formRef.current.dispatchEvent(
          new Event('submit', {
            // https://developer.mozilla.org/en-US/docs/Web/Events/submit
            bubbles: true,
          }),
        );

        formRef.current.dispatchEvent(
          new Event('reset', {
            // https://developer.mozilla.org/en-US/docs/Web/Events/reset
            bubbles: true,
          }),
        );
      });

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(handleReset).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(container);
    }
  });

  /** img/video 均传 onLoadStart，分别手动分发非冒泡 ProgressEvent；img零次、video一次，验证媒体专用目标监听，而非真实图片或视频加载过程。 */
  it('should dispatch loadstart only for media elements', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    try {
      const imgRef = React.createRef();
      const videoRef = React.createRef();

      const handleImgLoadStart = jest.fn();
      const handleVideoLoadStart = jest.fn();
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <img ref={imgRef} onLoadStart={handleImgLoadStart} />
            <video ref={videoRef} onLoadStart={handleVideoLoadStart} />
          </div>,
        );
      });

      await act(() => {
        // 历史 Chrome loadstart 问题见下方链接；本例以手动 ProgressEvent 检查 React 监听路径。
        // https://bugs.chromium.org/p/chromium/issues/detail?id=458851
        imgRef.current.dispatchEvent(
          new ProgressEvent('loadstart', {
            bubbles: false,
          }),
        );
      });
      expect(handleImgLoadStart).toHaveBeenCalledTimes(0);

      await act(() => {
        videoRef.current.dispatchEvent(
          new ProgressEvent('loadstart', {
            bubbles: false,
          }),
        );
      });
      expect(handleVideoLoadStart).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 以 addEventListener 替身禁止 document 除 selectionchange 外注册、禁止根的媒体冒泡注册但允许捕获；挂载 video/audio/source 后非冒泡 play 使 video 与父 onPlay 各一次，验证目标监听与 Fiber 合成冒泡；finally 恢复替身。 */
  it('should not attempt to listen to unnecessary events on the top level', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const videoRef = React.createRef();
    // 我们将单独测试这个事件。
    const handleVideoPlay = jest.fn();
    const handleVideoPlayDelegated = jest.fn();
    const mediaEvents = {
      /** onAbort 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onAbort() {},
      /** onCanPlay 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onCanPlay() {},
      /** onCanPlayThrough 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onCanPlayThrough() {},
      /** onDurationChange 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onDurationChange() {},
      /** onEmptied 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onEmptied() {},
      /** onEncrypted 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onEncrypted() {},
      /** onEnded 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onEnded() {},
      /** onError 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onError() {},
      /** onLoadedData 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onLoadedData() {},
      /** onLoadedMetadata 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onLoadedMetadata() {},
      /** onLoadStart 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onLoadStart() {},
      /** onPause 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onPause() {},
      /** onPlay 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onPlay() {},
      /** onPlaying 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onPlaying() {},
      /** onProgress 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onProgress() {},
      /** onRateChange 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onRateChange() {},
      /** onResize 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onResize() {},
      /** onSeeked 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onSeeked() {},
      /** onSeeking 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onSeeking() {},
      /** onStalled 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onStalled() {},
      /** onSuspend 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onSuspend() {},
      /** onTimeUpdate 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onTimeUpdate() {},
      /** onVolumeChange 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onVolumeChange() {},
      /** onWaiting 媒体处理器为空操作，仅为挂载 fixture 提供该事件 prop；此用例只分发并断言 play，不观测该回调行为。 */
      onWaiting() {},
    };

    const originalDocAddEventListener = document.addEventListener;
    const originalRootAddEventListener = container.addEventListener;
    /** document注册替身只允许selectionchange，其他type抛错误；不转发实际注册，finally恢复原方法。 */
    document.addEventListener = function (type) {
      switch (type) {
        case 'selectionchange':
          break;
        default:
          throw new Error(
            `Did not expect to add a document-level listener for the "${type}" event.`,
          );
      }
    };
    /** 根注册替身接收type/fn/options：捕获直接允许，媒体事件冒泡抛错，其余允许；固定验证注册位置而非浏览器传播实现。 */
    container.addEventListener = function (type, fn, options) {
      if (options && (options === true || options.capture)) {
        return;
      }
      switch (type) {
        case 'abort':
        case 'canplay':
        case 'canplaythrough':
        case 'durationchange':
        case 'emptied':
        case 'encrypted':
        case 'ended':
        case 'error':
        case 'loadeddata':
        case 'loadedmetadata':
        case 'loadstart':
        case 'pause':
        case 'play':
        case 'playing':
        case 'progress':
        case 'ratechange':
        case 'resize':
        case 'seeked':
        case 'seeking':
        case 'stalled':
        case 'suspend':
        case 'timeupdate':
        case 'volumechange':
        case 'waiting':
          throw new Error(
            `Did not expect to add a root-level listener for the "${type}" event.`,
          );
        default:
          break;
      }
    };

    try {
      // 允许根容器的捕获监听与普通事件监听；禁止把非冒泡媒体事件的冒泡监听挂到根容器。
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div onPlay={handleVideoPlayDelegated}>
            <video ref={videoRef} {...mediaEvents} onPlay={handleVideoPlay} />
            <audio {...mediaEvents}>
              <source {...mediaEvents} />
            </audio>
          </div>,
        );
      });
      await act(() => {
        // 检查一个工作的发送
        videoRef.current.dispatchEvent(
          new Event('play', {
            bubbles: false,
          }),
        );
      });
      expect(handleVideoPlay).toHaveBeenCalledTimes(1);
      // 媒体事件的冒泡监听挂在目标元素上，React 再沿 Fiber 路径收集祖先处理器，因此原生不冒泡的 play 仍会触发父级 onPlay。
      expect(handleVideoPlayDelegated).toHaveBeenCalledTimes(1);
    } finally {
      document.addEventListener = originalDocAddEventListener;
      container.addEventListener = originalRootAddEventListener;
      document.body.removeChild(container);
    }
  });

  /** embed 传 onLoad，目标分发非冒泡 load ProgressEvent；mock 一次，验证 embed 宿主的目标级 load 监听。 */
  it('should dispatch load for embed elements', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    try {
      const ref = React.createRef();
      const handleLoad = jest.fn();
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <embed ref={ref} onLoad={handleLoad} />
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new ProgressEvent('load', {
            bubbles: false,
          }),
        );
      });

      expect(handleLoad).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  // 媒体事件的冒泡监听挂在目标元素上，React 再沿 Fiber 路径收集祖先处理器，因此原生不冒泡的 play 仍会触发父级 onPlay。
  /** video 不传自己的 onPlay，父 div 有 onPlay；手动非冒泡 play 后父回调一次，验证宿主默认安装媒体监听并按 Fiber 收集父回调。 */
  it('should delegate media events even without a direct listener', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const handleVideoPlayDelegated = jest.fn();
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div onPlay={handleVideoPlayDelegated}>
            {/* 故意没有目标处理器： */}
            <video ref={ref} />
          </div>,
        );
      });

      await act(() => {
        ref.current.dispatchEvent(
          new Event('play', {
            bubbles: false,
          }),
        );
      });
      // 回归测试:确保即使实际的 DOM元素没有处理器,也确保React树委托仍然有效.
      expect(handleVideoPlayDelegated).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** dialog 不传 close/cancel handler、父 div 两者都有；目标非冒泡 close/cancel 后父回调各一次，验证 dialog 目标监听仍支持合成父路径。 */
  it('should delegate dialog events even without a direct listener', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const onCancel = jest.fn();
    const onClose = jest.fn();
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div onCancel={onCancel} onClose={onClose}>
            {/* 故意没有目标处理器： */}
            <dialog ref={ref} />
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('close', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('cancel', {
            bubbles: false,
          }),
        );
      });
      // 回归测试:确保即使实际的 DOM元素没有处理器,也确保React树委托仍然有效.
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** details 与父 div 共享 onToggle，发送非冒泡 toggle；累计两次，验证 React 为 toggle 收集合成冒泡处理器。 */
  it('should bubble non-native bubbling toggle events', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const onToggle = jest.fn();
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div onToggle={onToggle}>
            <details ref={ref} onToggle={onToggle} />
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('toggle', {
            bubbles: false,
          }),
        );
      });
      expect(onToggle).toHaveBeenCalledTimes(2);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** dialog 与父共享 onCancel/onClose，分别发送非冒泡事件；两类 mock 各两次，验证目标与父均进入合成冒泡队列。 */
  it('should bubble non-native bubbling cancel/close events', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const onCancel = jest.fn();
    const onClose = jest.fn();
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div onCancel={onCancel} onClose={onClose}>
            <dialog ref={ref} onCancel={onCancel} onClose={onClose} />
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('cancel', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('close', {
            bubbles: false,
          }),
        );
      });
      expect(onCancel).toHaveBeenCalledTimes(2);
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** video 与父 div 共享 onPlay，发送非冒泡 play 后两次，验证媒体目标监听提取事件后沿 React 祖先执行。 */
  it('should bubble non-native bubbling media events events', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const onPlay = jest.fn();
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div onPlay={onPlay}>
            <video ref={ref} onPlay={onPlay} />
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('play', {
            bubbles: false,
          }),
        );
      });
      expect(onPlay).toHaveBeenCalledTimes(2);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** input/form 共享 onInvalid，目标分发非冒泡 invalid 后两次，验证校验事件仍由 React 合成冒泡。 */
  it('should bubble non-native bubbling invalid events', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const onInvalid = jest.fn();
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <form onInvalid={onInvalid}>
            <input ref={ref} onInvalid={onInvalid} />
          </form>,
        );
      });

      await act(() => {
        ref.current.dispatchEvent(
          new Event('invalid', {
            bubbles: false,
          }),
        );
      });
      expect(onInvalid).toHaveBeenCalledTimes(2);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 三层 div 均有 onPlayCapture；内层分发非冒泡 play 得外→中→内三次，再向外层分发只追加外一次，验证捕获路径由真实目标决定。 */
  it('should handle non-bubbling capture events correctly', async () => {
    const container = document.createElement('div');
    const innerRef = React.createRef();
    const outerRef = React.createRef();
    const onPlayCapture = jest.fn(e => log.push(e.currentTarget));
    const log = [];
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div ref={outerRef} onPlayCapture={onPlayCapture}>
            <div onPlayCapture={onPlayCapture}>
              <div ref={innerRef} onPlayCapture={onPlayCapture} />
            </div>
          </div>,
        );
      });
      await act(() => {
        innerRef.current.dispatchEvent(
          new Event('play', {
            bubbles: false,
          }),
        );
      });
      expect(onPlayCapture).toHaveBeenCalledTimes(3);
      expect(log).toEqual([
        outerRef.current,
        outerRef.current.firstChild,
        innerRef.current,
      ]);
      await act(() => {
        outerRef.current.dispatchEvent(
          new Event('play', {
            bubbles: false,
          }),
        );
      });
      expect(onPlayCapture).toHaveBeenCalledTimes(4);
      expect(log).toEqual([
        outerRef.current,
        outerRef.current.firstChild,
        innerRef.current,
        outerRef.current,
      ]);
    } finally {
      document.body.removeChild(container);
    }
  });

  // scroll/scrollend 的合成冒泡阶段只收集目标自身的监听器；捕获阶段仍经过祖先。
  /** 三层各有 scroll/scrollend 两阶段处理器，最内目标发送非冒泡事件；每类日志为grand→parent→child捕获及仅child冒泡，验证不模拟祖先 scroll 冒泡。 */
  it('should not emulate bubbling of scroll events', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const log = [];
    const onScroll = jest.fn(e =>
      log.push(['onScroll', 'bubble', e.currentTarget.className]),
    );
    const onScrollCapture = jest.fn(e =>
      log.push(['onScroll', 'capture', e.currentTarget.className]),
    );
    const onScrollEnd = jest.fn(e =>
      log.push(['onScrollEnd', 'bubble', e.currentTarget.className]),
    );
    const onScrollEndCapture = jest.fn(e =>
      log.push(['onScrollEnd', 'capture', e.currentTarget.className]),
    );
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div
            className="grand"
            onScroll={onScroll}
            onScrollCapture={onScrollCapture}
            onScrollEnd={onScrollEnd}
            onScrollEndCapture={onScrollEndCapture}>
            <div
              className="parent"
              onScroll={onScroll}
              onScrollCapture={onScrollCapture}
              onScrollEnd={onScrollEnd}
              onScrollEndCapture={onScrollEndCapture}>
              <div
                className="child"
                onScroll={onScroll}
                onScrollCapture={onScrollCapture}
                onScrollEnd={onScrollEnd}
                onScrollEndCapture={onScrollEndCapture}
                ref={ref}
              />
            </div>
          </div>,
        );
      });

      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([
        ['onScroll', 'capture', 'grand'],
        ['onScroll', 'capture', 'parent'],
        ['onScroll', 'capture', 'child'],
        ['onScroll', 'bubble', 'child'],
        ['onScrollEnd', 'capture', 'grand'],
        ['onScrollEnd', 'capture', 'parent'],
        ['onScrollEnd', 'capture', 'child'],
        ['onScrollEnd', 'bubble', 'child'],
      ]);
    } finally {
      document.body.removeChild(container);
    }
  });

  // scroll/scrollend 的合成冒泡阶段只收集目标自身的监听器；捕获阶段仍经过祖先。
  /** 最内 div 无 scroll/scrollend handler，祖先仍有两阶段监听；发送后只有grand/parent捕获日志、无冒泡日志，验证 scroll 不从祖先补取目标 handler。 */
  it('should not emulate bubbling of scroll events (no own handler)', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const log = [];
    const onScroll = jest.fn(e =>
      log.push(['onScroll', 'bubble', e.currentTarget.className]),
    );
    const onScrollCapture = jest.fn(e =>
      log.push(['onScroll', 'capture', e.currentTarget.className]),
    );
    const onScrollEnd = jest.fn(e =>
      log.push(['onScrollEnd', 'bubble', e.currentTarget.className]),
    );
    const onScrollEndCapture = jest.fn(e =>
      log.push(['onScrollEnd', 'capture', e.currentTarget.className]),
    );
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div
            className="grand"
            onScroll={onScroll}
            onScrollCapture={onScrollCapture}
            onScrollEnd={onScrollEnd}
            onScrollEndCapture={onScrollEndCapture}>
            <div
              className="parent"
              onScroll={onScroll}
              onScrollCapture={onScrollCapture}
              onScrollEnd={onScrollEnd}
              onScrollEndCapture={onScrollEndCapture}>
              {/* 故意没有在子组件上设置处理器： */}
              <div className="child" ref={ref} />
            </div>
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([
        ['onScroll', 'capture', 'grand'],
        ['onScroll', 'capture', 'parent'],
        ['onScrollEnd', 'capture', 'grand'],
        ['onScrollEnd', 'capture', 'parent'],
      ]);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 初始三层无监听，更新加入 scroll/scrollend 两阶段回调，再换新内联回调、最后移除全部；两次事件输出同样一次路径、移除后空日志，验证更新安装及去重和最新 props 查询；不直接断言原生监听器移除。 */
  it('should subscribe to scroll during updates', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const log = [];
    const onScroll = jest.fn(e =>
      log.push(['onScroll', 'bubble', e.currentTarget.className]),
    );
    const onScrollCapture = jest.fn(e =>
      log.push(['onScroll', 'capture', e.currentTarget.className]),
    );
    const onScrollEnd = jest.fn(e =>
      log.push(['onScrollEnd', 'bubble', e.currentTarget.className]),
    );
    const onScrollEndCapture = jest.fn(e =>
      log.push(['onScrollEnd', 'capture', e.currentTarget.className]),
    );
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <div>
              <div />
            </div>
          </div>,
        );
      });

      await act(() => {
        // 更新以附加。
        root.render(
          <div
            className="grand"
            onScroll={e => onScroll(e)}
            onScrollCapture={e => onScrollCapture(e)}
            onScrollEnd={e => onScrollEnd(e)}
            onScrollEndCapture={e => onScrollEndCapture(e)}>
            <div
              className="parent"
              onScroll={e => onScroll(e)}
              onScrollCapture={e => onScrollCapture(e)}
              onScrollEnd={e => onScrollEnd(e)}
              onScrollEndCapture={e => onScrollEndCapture(e)}>
              <div
                className="child"
                onScroll={e => onScroll(e)}
                onScrollCapture={e => onScrollCapture(e)}
                onScrollEnd={e => onScrollEnd(e)}
                onScrollEndCapture={e => onScrollEndCapture(e)}
                ref={ref}
              />
            </div>
          </div>,
        );
      });

      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([
        ['onScroll', 'capture', 'grand'],
        ['onScroll', 'capture', 'parent'],
        ['onScroll', 'capture', 'child'],
        ['onScroll', 'bubble', 'child'],
        ['onScrollEnd', 'capture', 'grand'],
        ['onScrollEnd', 'capture', 'parent'],
        ['onScrollEnd', 'capture', 'child'],
        ['onScrollEnd', 'bubble', 'child'],
      ]);

      // 更新以验证去重。
      log.length = 0;
      await act(() => {
        root.render(
          <div
            className="grand"
            // 注意：这些是故意的内联函数，以便我们触发重连代码路径，而不是立即退出。
            onScroll={e => onScroll(e)}
            onScrollCapture={e => onScrollCapture(e)}
            onScrollEnd={e => onScrollEnd(e)}
            onScrollEndCapture={e => onScrollEndCapture(e)}>
            <div
              className="parent"
              onScroll={e => onScroll(e)}
              onScrollCapture={e => onScrollCapture(e)}
              onScrollEnd={e => onScrollEnd(e)}
              onScrollEndCapture={e => onScrollEndCapture(e)}>
              <div
                className="child"
                onScroll={e => onScroll(e)}
                onScrollCapture={e => onScrollCapture(e)}
                onScrollEnd={e => onScrollEnd(e)}
                onScrollEndCapture={e => onScrollEndCapture(e)}
                ref={ref}
              />
            </div>
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([
        ['onScroll', 'capture', 'grand'],
        ['onScroll', 'capture', 'parent'],
        ['onScroll', 'capture', 'child'],
        ['onScroll', 'bubble', 'child'],
        ['onScrollEnd', 'capture', 'grand'],
        ['onScrollEnd', 'capture', 'parent'],
        ['onScrollEnd', 'capture', 'child'],
        ['onScrollEnd', 'bubble', 'child'],
      ]);

      // 更新移除React处理器；后续分发不应找到回调。
      log.length = 0;
      await act(() => {
        root.render(
          <div>
            <div>
              <div ref={ref} />
            </div>
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([]);
    } finally {
      document.body.removeChild(container);
    }
  });

  // 回归测试。
  /** 服务端序列化三层 scroll tree 后 hydrateRoot；事件捕获经过三层、冒泡只目标，移除 React handler 后再次分发无日志，验证 hydration 安装目标监听及后续 props 更新。 */
  it('should subscribe to scroll during hydration', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();
    const log = [];
    const onScroll = jest.fn(e =>
      log.push(['onScroll', 'bubble', e.currentTarget.className]),
    );
    const onScrollCapture = jest.fn(e =>
      log.push(['onScroll', 'capture', e.currentTarget.className]),
    );
    const onScrollEnd = jest.fn(e =>
      log.push(['onScrollEnd', 'bubble', e.currentTarget.className]),
    );
    const onScrollEndCapture = jest.fn(e =>
      log.push(['onScrollEnd', 'capture', e.currentTarget.className]),
    );

    const tree = (
      <div
        className="grand"
        onScroll={onScroll}
        onScrollCapture={onScrollCapture}
        onScrollEnd={onScrollEnd}
        onScrollEndCapture={onScrollEndCapture}>
        <div
          className="parent"
          onScroll={onScroll}
          onScrollCapture={onScrollCapture}
          onScrollEnd={onScrollEnd}
          onScrollEndCapture={onScrollEndCapture}>
          <div
            className="child"
            onScroll={onScroll}
            onScrollCapture={onScrollCapture}
            onScrollEnd={onScrollEnd}
            onScrollEndCapture={onScrollEndCapture}
            ref={ref}
          />
        </div>
      </div>
    );
    document.body.appendChild(container);
    try {
      container.innerHTML = ReactDOMServer.renderToString(tree);
      let root;
      await act(() => {
        root = ReactDOMClient.hydrateRoot(container, tree);
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([
        ['onScroll', 'capture', 'grand'],
        ['onScroll', 'capture', 'parent'],
        ['onScroll', 'capture', 'child'],
        ['onScroll', 'bubble', 'child'],
        ['onScrollEnd', 'capture', 'grand'],
        ['onScrollEnd', 'capture', 'parent'],
        ['onScrollEnd', 'capture', 'child'],
        ['onScrollEnd', 'bubble', 'child'],
      ]);

      log.length = 0;
      await act(() => {
        root.render(
          <div>
            <div>
              <div ref={ref} />
            </div>
          </div>,
        );
      });
      await act(() => {
        ref.current.dispatchEvent(
          new Event('scroll', {
            bubbles: false,
          }),
        );
        ref.current.dispatchEvent(
          new Event('scrollend', {
            bubbles: false,
          }),
        );
      });
      expect(log).toEqual([]);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 用 document.addEventListener 替身记录 selectionchange 的 options 并拒绝其他事件，创建两个根并提交 input；最终仅[false]，验证同一 document 的非捕获监听去重；finally 恢复原方法。 */
  it('should not subscribe to selectionchange twice', async () => {
    const log = [];

    const originalDocAddEventListener = document.addEventListener;
    /** document监听替身只记录selectionchange options，其他type抛错；两根共用document验证去重，finally恢复原方法。 */
    document.addEventListener = function (type, fn, options) {
      switch (type) {
        case 'selectionchange':
          log.push(options);
          break;
        default:
          throw new Error(
            `Did not expect to add a document-level listener for the "${type}" event.`,
          );
      }
    };
    try {
      const rootOne = ReactDOMClient.createRoot(document.createElement('div'));
      const rootTwo = ReactDOMClient.createRoot(document.createElement('div'));

      await act(() => {
        rootOne.render(<input />);
        rootTwo.render(<input />);
      });
    } finally {
      document.addEventListener = originalDocAddEventListener;
    }

    expect(log).toEqual([false]);
  });
});
