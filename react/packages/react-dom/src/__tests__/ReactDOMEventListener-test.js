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
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should propagate events one level down」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
     */
    it('should propagate events one level down', async () => {
      const mouseOut = jest.fn();
      /** `onMouseOut`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「should propagate events two levels down」描述的渲染、交互或错误处理结果。 */
    it('should propagate events two levels down', async () => {
      const mouseOut = jest.fn();
      /** `onMouseOut`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** 测试场景：验证「should not get confused by disappearing elements」描述的渲染、交互或错误处理结果。 */
    it('should not get confused by disappearing elements', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      try {
        /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class MyComponent extends React.Component {
          /** `MyComponent.state`：记录测试夹具在当前场景中的状态。 */
          state = {clicked: false};
          /** `MyComponent.handleClick`：封装当前用例复用的操作、回调或断言步骤。 */
          handleClick = () => {
            this.setState({clicked: true});
          };
          /** `MyComponent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentDidMount() {
            expect(
              ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
                this,
              ),
            ).toBe(container.firstChild);
          }
          /** `MyComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentDidUpdate() {
            expect(
              ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
                this,
              ),
            ).toBe(container.firstChild);
          }
          /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「should batch between handlers from different roots (discrete)」描述的渲染、交互或错误处理结果。 */
    it('should batch between handlers from different roots (discrete)', async () => {
      const mock = jest.fn();

      const childContainer = document.createElement('div');
      const parentContainer = document.createElement('main');

      const childRoot = ReactDOMClient.createRoot(childContainer);
      const parentRoot = ReactDOMClient.createRoot(parentContainer);
      let childSetState;

      /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
      function Parent() {
        // eslint-disable-next-line no-unused-vars
        const [state, _] = React.useState('Parent');
        /** `Parent.handleClick`：封装当前用例复用的操作、回调或断言步骤。 */
        const handleClick = () => {
          childSetState(2);
          mock(childContainer.firstChild.textContent);
        };
        return <section onClick={handleClick}>{state}</section>;
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      function Child() {
        const [state, setState] = React.useState('Child');
        childSetState = setState;
        /** `Child.handleClick`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「should batch between handlers from different roots (continuous)」描述的渲染、交互或错误处理结果。 */
    it('should batch between handlers from different roots (continuous)', async () => {
      const mock = jest.fn();

      const childContainer = document.createElement('div');
      const parentContainer = document.createElement('main');

      const childRoot = ReactDOMClient.createRoot(childContainer);
      const parentRoot = ReactDOMClient.createRoot(parentContainer);
      let childSetState;

      /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
      function Parent() {
        // eslint-disable-next-line no-unused-vars
        const [state, _] = React.useState('Parent');
        /** `Parent.handleMouseOut`：封装当前用例复用的操作、回调或断言步骤。 */
        const handleMouseOut = () => {
          childSetState(2);
          mock(childContainer.firstChild.textContent);
        };
        return <section onMouseOut={handleMouseOut}>{state}</section>;
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      function Child() {
        const [state, setState] = React.useState('Child');
        childSetState = setState;
        /** `Child.handleMouseOut`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should not fire duplicate events for a React DOM tree」描述的渲染、交互或错误处理结果。 */
  it('should not fire duplicate events for a React DOM tree', async () => {
    const mouseOut = jest.fn();
    /** `onMouseOut`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseOut = event => mouseOut(event.target);

    const innerRef = React.createRef();
    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
  /** 测试场景：验证「should not fire form events twice」描述的渲染、交互或错误处理结果。 */
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

  // 此测试验证一项实现细节：React 在 document 层监听 submit/reset 事件，这是事件重放正常工作的前提。
  // 这两种事件在所有现代浏览器中都会冒泡。
  /** 测试场景：验证「should not receive submit events if native, interim DOM handler prevents it」描述的渲染、交互或错误处理结果。 */
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

      interimRef.current.onsubmit = nativeEvent =>
        nativeEvent.stopPropagation();
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

  /** 测试场景：验证「should dispatch loadstart only for media elements」描述的渲染、交互或错误处理结果。 */
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
        // 调试提示：Chrome 当前不会触发 loadstart。
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

  /** 测试场景：验证「should not attempt to listen to unnecessary events on the top level」描述的渲染、交互或错误处理结果。 */
  it('should not attempt to listen to unnecessary events on the top level', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const videoRef = React.createRef();
    // 我们将单独测试这个事件。
    const handleVideoPlay = jest.fn();
    const handleVideoPlayDelegated = jest.fn();
    const mediaEvents = {
      /** `onAbort`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onAbort() {},
      /** `onCanPlay`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onCanPlay() {},
      /** `onCanPlayThrough`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onCanPlayThrough() {},
      /** `onDurationChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onDurationChange() {},
      /** `onEmptied`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onEmptied() {},
      /** `onEncrypted`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onEncrypted() {},
      /** `onEnded`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onEnded() {},
      /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onError() {},
      /** `onLoadedData`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onLoadedData() {},
      /** `onLoadedMetadata`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onLoadedMetadata() {},
      /** `onLoadStart`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onLoadStart() {},
      /** `onPause`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onPause() {},
      /** `onPlay`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onPlay() {},
      /** `onPlaying`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onPlaying() {},
      /** `onProgress`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onProgress() {},
      /** `onRateChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRateChange() {},
      /** `onResize`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onResize() {},
      /** `onSeeked`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onSeeked() {},
      /** `onSeeking`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onSeeking() {},
      /** `onStalled`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onStalled() {},
      /** `onSuspend`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onSuspend() {},
      /** `onTimeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onTimeUpdate() {},
      /** `onVolumeChange`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onVolumeChange() {},
      /** `onWaiting`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onWaiting() {},
    };

    const originalDocAddEventListener = document.addEventListener;
    const originalRootAddEventListener = container.addEventListener;
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
      // 我们期望挂载此树时不会为任何顶级事件附加处理器。
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
      // 与浏览器不同，React 会委托媒体事件；虽然这样意义不大，但停止委托会造成破坏性变更。
      expect(handleVideoPlayDelegated).toHaveBeenCalledTimes(1);
    } finally {
      document.addEventListener = originalDocAddEventListener;
      container.addEventListener = originalRootAddEventListener;
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「should dispatch load for embed elements」描述的渲染、交互或错误处理结果。 */
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

  // 与浏览器不同，React 会委托媒体事件；虽然这样意义不大，但停止委托会造成破坏性变更。
  /** 测试场景：验证「should delegate media events even without a direct listener」描述的渲染、交互或错误处理结果。 */
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
      // 退回测试:确保即使实际的 DOM元素没有处理器,也确保React树委托仍然有效.
      expect(handleVideoPlayDelegated).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「should delegate dialog events even without a direct listener」描述的渲染、交互或错误处理结果。 */
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
      // 退回测试:确保即使实际的 DOM元素没有处理器,也确保React树委托仍然有效.
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「should bubble non-native bubbling toggle events」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should bubble non-native bubbling cancel/close events」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should bubble non-native bubbling media events events」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should bubble non-native bubbling invalid events」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should handle non-bubbling capture events correctly」描述的渲染、交互或错误处理结果。 */
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

  // 我们正朝着更接近浏览器的方向靠拢。 目前我们模拟了所有非泡事件,除了卷轴. 我们可能会在未来扩展
  // 这个列表。 完全移除模拟的冒泡。
  /** 测试场景：验证「should not emulate bubbling of scroll events」描述的渲染、交互或错误处理结果。 */
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

  // 我们正朝着更接近浏览器的方向靠拢。 目前我们模拟了所有非泡事件,除了卷轴. 我们可能会在未来扩展
  // 这个列表。 完全移除模拟的冒泡。
  /** 测试场景：验证「should not emulate bubbling of scroll events (no own handler)」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should subscribe to scroll during updates」描述的渲染、交互或错误处理结果。 */
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

      // 更新以解除绑定。
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
  /** 测试场景：验证「should subscribe to scroll during hydration」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not subscribe to selectionchange twice」描述的渲染、交互或错误处理结果。 */
  it('should not subscribe to selectionchange twice', async () => {
    const log = [];

    const originalDocAddEventListener = document.addEventListener;
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
