/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

let JSDOM;
let React;
let startTransition;
let ReactDOMClient;
let Scheduler;
let clientAct;
let ReactDOMFizzServer;
let Stream;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let textCache;
let assertLog;

describe('ReactDOMFizzShellHydration', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    clientAct = require('internal-test-utils').act;
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    startTransition = React.startTransition;

    textCache = new Map();

    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    document = jsdom.window.document;
    container = document.getElementById('container');

    buffer = '';
    hasErrored = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** `serverAct`：封装当前用例复用的操作、回调或断言步骤。 */
  async function serverAct(callback) {
    await callback();
    // 等待一次事件循环的轮询。 这假设我们已经将所有东西都冲刷了。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // 由于 JSDOM 不支持流解析器，我们需要给它一个适当的片段。 我们还想执行嵌入式的任何脚本. 我们假
    // 设现在已经接收到一个适当的片段的 HTML。
    const bufferedContent = buffer;
    buffer = '';
    const fakeBody = document.createElement('body');
    fakeBody.innerHTML = bufferedContent;
    while (fakeBody.firstChild) {
      const node = fakeBody.firstChild;
      if (node.nodeName === 'SCRIPT') {
        const script = document.createElement('script');
        script.textContent = node.textContent;
        fakeBody.removeChild(node);
        container.appendChild(script);
      } else {
        container.appendChild(node);
      }
    }
  }

  /** `hydrateRootAndCollectErrors`：封装当前用例复用的操作、回调或断言步骤。 */
  async function hydrateRootAndCollectErrors(reactNode) {
    const errors = [];
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, reactNode, {
        /** `hydrateRootAndCollectErrors.onCaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
          errors.push('caught: ' + error.message);
        },
        /** `hydrateRootAndCollectErrors.onUncaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
          errors.push('uncaught: ' + error.message);
        },
        /** `hydrateRootAndCollectErrors.onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          errors.push('recoverable: ' + error.message);
        },
      });
    });
    return errors;
  }

  /** `createErrorBoundaryAndBomb`：封装当前用例复用的操作、回调或断言步骤。 */
  function createErrorBoundaryAndBomb() {
    /** `createErrorBoundaryAndBomb.ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
      }

      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }

      /** `ErrorBoundary.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch() {}

      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return 'Something went wrong: ' + this.state.error.message;
        }

        return this.props.children;
      }
    }

    /** `createErrorBoundaryAndBomb.Bomb`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bomb() {
      throw new Error('boom');
    }

    return {ErrorBoundary, Bomb};
  }

  /** `resolveText`：封装当前用例复用的操作、回调或断言步骤。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /** `readText`：封装当前用例复用的操作、回调或断言步骤。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);

      const thenable = {
        pings: [],
        /** `readText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /** `resetTextCache`：封装当前用例复用的操作、回调或断言步骤。 */
  function resetTextCache() {
    textCache = new Map();
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「suspending in the shell during hydration」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
   */
  it('suspending in the shell during hydration', async () => {
    const div = React.createRef(null);

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div ref={div}>
          <AsyncText text="Shell" />
        </div>
      );
    }

    // 服务器端渲染
    await resolveText('Shell');
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    assertLog(['Shell']);
    const dehydratedDiv = container.getElementsByTagName('div')[0];

    // 清除缓存并开始在客户端渲染
    resetTextCache();

    // shell 的数据尚未加载，因此 hydration 会挂起
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    assertLog(['Suspend! [Shell]']);
    expect(div.current).toBe(null);
    expect(container.textContent).toBe('Shell');

    // shell 加载完成，hydration 随之结束
    await clientAct(async () => {
      await resolveText('Shell');
    });
    assertLog(['Shell']);
    expect(div.current).toBe(dehydratedDiv);
    expect(container.textContent).toBe('Shell');
  });

  /** 测试场景：验证「suspending in the shell during a normal client render」描述的渲染、交互或错误处理结果。 */
  it('suspending in the shell during a normal client render', async () => {
    // 与前一个测试相同，但发生在不含 hydration 的常规客户端渲染期间。
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return <AsyncText text="Shell" />;
    }

    const root = ReactDOMClient.createRoot(container);
    await clientAct(async () => {
      root.render(<App />);
    });
    assertLog(['Suspend! [Shell]']);

    await clientAct(async () => {
      await resolveText('Shell');
    });
    assertLog(['Shell']);
    expect(container.textContent).toBe('Shell');
  });

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'updating the root at lower priority than initial hydration does not ' +
      'force a client render',
    async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return <Text text="Initial" />;
      }

      // 服务器端渲染
      await resolveText('Initial');
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Initial']);

      await clientAct(async () => {
        const root = ReactDOMClient.hydrateRoot(container, <App />);
        // 此更新的优先级低于初始 hydration，因此要等 hydration 完成后才会处理。
        startTransition(() => {
          root.render(<Text text="Updated" />);
        });
      });
      assertLog(['Initial', 'Updated']);
      expect(container.textContent).toBe('Updated');
    },
  );

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'updating the root at same priority as initial hydration does not ' +
      'force a client render',
    async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return <Text text="Initial" />;
      }

      // 服务器端渲染
      await resolveText('Initial');
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Initial']);

      await clientAct(async () => {
        let root;
        startTransition(() => {
          root = ReactDOMClient.hydrateRoot(container, <App />);
        });
        // 此更新的优先级低于初始 hydration，因此要等 hydration 完成后才会处理。
        startTransition(() => {
          root.render(<Text text="Updated" />);
        });
      });
      assertLog(['Initial', 'Updated']);
      expect(container.textContent).toBe('Updated');
    },
  );

  /** 测试场景：验证「updating the root while the shell is suspended forces a client render」描述的渲染、交互或错误处理结果。 */
  it('updating the root while the shell is suspended forces a client render', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return <AsyncText text="Shell" />;
    }

    // 服务器端渲染
    await resolveText('Shell');
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    assertLog(['Shell']);

    // 清除缓存并开始在客户端渲染
    resetTextCache();

    // shell 的数据尚未加载，因此 hydration 会挂起
    const root = await clientAct(async () => {
      return ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log(error.message);
        },
      });
    });
    assertLog(['Suspend! [Shell]']);
    expect(container.textContent).toBe('Shell');

    await clientAct(async () => {
      root.render(<Text text="New screen" />);
    });
    assertLog([
      'New screen',
      'This root received an early update, before anything was able ' +
        'hydrate. Switched the entire root to client rendering.',
    ]);
    expect(container.textContent).toBe('New screen');
  });

  /** 测试场景：验证「recovers from a large component stack during SSR」描述的渲染、交互或错误处理结果。 */
  it('recovers from a large component stack during SSR', async () => {
    spyOnDevAndProd(console, 'error').mockImplementation(() => {});

    /** 递归构造很深的组件栈，验证服务端错误恢复不会栈溢出。 */
    function NestedComponent({depth}: {/** 剩余递归层数。 */ depth: number}) {
      if (depth <= 0) {
        return <AsyncText text="Shell" />;
      }
      return <NestedComponent depth={depth - 1} />;
    }

    await resolveText('Shell');
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <NestedComponent depth={3000} />,
      );
      pipe(writable);
    });
    expect(console.error).not.toHaveBeenCalled();
    assertLog(['Shell']);
    expect(container.textContent).toBe('Shell');
  });

  /** 测试场景：验证「client renders when an error is thrown in an error boundary」描述的渲染、交互或错误处理结果。 */
  it('client renders when an error is thrown in an error boundary', async () => {
    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
    function Throws() {
      throw new Error('plain error');
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <div>Caught an error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>
      );
    }

    // 服务器端渲染
    let shellError;
    try {
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            Scheduler.log('onError: ' + error.message);
          },
        });
        pipe(writable);
      });
    } catch (x) {
      shellError = x;
    }
    expect(shellError).toEqual(
      expect.objectContaining({message: 'plain error'}),
    );
    assertLog(['onError: plain error']);

    /** `ErroredApp`：封装当前用例复用的操作、回调或断言步骤。 */
    function ErroredApp() {
      return <span>loading</span>;
    }

    // 重置测试环境
    buffer = '';
    hasErrored = false;
    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });

    // 服务器在 shell 处出错。建议渲染 fallback 加载状态，随后可通过 mismatch 对其进行 hydration。
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<ErroredApp />);
      pipe(writable);
    });

    expect(container.innerHTML).toBe('<span>loading</span>');

    // shell 的数据尚未加载，因此 hydration 会挂起
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onCaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
        },
        /** `onUncaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
        },
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + error.cause.message);
          }
        },
      });
    });

    assertLog(['onCaughtError: plain error']);
    expect(container.textContent).toBe('Caught an error: plain error');
  });

  /** 测试场景：验证「client renders when a client error is thrown in an error boundary」描述的渲染、交互或错误处理结果。 */
  it('client renders when a client error is thrown in an error boundary', async () => {
    let isClient = false;

    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
    function Throws() {
      if (isClient) {
        throw new Error('plain error');
      }
      return <div>Hello world</div>;
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <div>Caught an error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>
      );
    }

    // 服务器端渲染
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          Scheduler.log('onError: ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog([]);

    expect(container.innerHTML).toBe('<div>Hello world</div>');

    isClient = true;

    // shell 的数据尚未加载，因此 hydration 会挂起
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onCaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
        },
        /** `onUncaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
        },
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + error.cause.message);
          }
        },
      });
    });

    assertLog(['onCaughtError: plain error']);
    expect(container.textContent).toBe('Caught an error: plain error');
  });

  /** 测试场景：验证「client renders when a hydration pass error is thrown in an error boundary」描述的渲染、交互或错误处理结果。 */
  it('client renders when a hydration pass error is thrown in an error boundary', async () => {
    let isClient = false;
    let isFirst = true;

    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
    function Throws() {
      if (isClient && isFirst) {
        isFirst = false; // 模拟 hydration 或并发错误
        throw new Error('plain error');
      }
      return <div>Hello world</div>;
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <div>Caught an error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>
      );
    }

    // 服务器端渲染
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          Scheduler.log('onError: ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog([]);

    expect(container.innerHTML).toBe('<div>Hello world</div>');

    isClient = true;

    // shell 的数据尚未加载，因此 hydration 会挂起
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onCaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
        },
        /** `onUncaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
        },
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + error.cause.message);
          }
        },
      });
    });

    assertLog([
      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering the entire root.',
      'Cause: plain error',
    ]);
    expect(container.textContent).toBe('Hello world');
  });

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'handles suspending while recovering from a hydration error (in the ' +
      'shell, no Suspense boundary)',
    async () => {
      const useSyncExternalStore = React.useSyncExternalStore;

      let isClient = false;

      let resolve;
      const clientPromise = new Promise(res => {
        resolve = res;
      });

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        const state = useSyncExternalStore(
          function subscribe() {
            return () => {};
          },
          function getSnapshot() {
            return 'Client';
          },
          function getServerSnapshot() {
            const isHydrating = isClient;
            if (isHydrating) {
              // 这会在 hydration 期间触发错误。
              throw new Error('Oops!');
            }
            return 'Server';
          },
        );

        if (state === 'Client') {
          return React.use(clientPromise);
        }

        return state;
      }

      // 服务器端渲染
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog([]);

      expect(container.innerHTML).toBe('Server');

      // hydration 期间会抛出错误；React 会尝试切换到客户端渲染以恢复。
      isClient = true;
      await clientAct(async () => {
        ReactDOMClient.hydrateRoot(container, <App />, {
          /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onRecoverableError(error) {
            Scheduler.log('onRecoverableError: ' + error.message);
            if (error.cause) {
              Scheduler.log('Cause: ' + error.cause.message);
            }
          },
        });
      });
      expect(container.innerHTML).toBe('Server'); // 仍然挂起
      assertLog([]);

      await clientAct(async () => {
        resolve('Client');
      });
      assertLog([
        'onRecoverableError: There was an error while hydrating but React was ' +
          'able to recover by instead client rendering the entire root.',
        'Cause: Oops!',
      ]);
      expect(container.innerHTML).toBe('Client');
    },
  );

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'does not corrupt hooks during hydration when conditional use suspends ' +
      'after a cascading update (#33580)',
    async () => {
      const {ErrorBoundary, Bomb} = createErrorBoundaryAndBomb();

      /** `Updater`：封装当前用例复用的操作、回调或断言步骤。 */
      function Updater({setPromise}) {
        const [state, setState] = React.useState(false);

        React.useEffect(() => {
          setState(true);
          startTransition(() => {
            setPromise(Promise.resolve('resolved'));
          });
        }, [state]);

        return null;
      }

      /** `Page`：封装当前用例复用的操作、回调或断言步骤。 */
      function Page() {
        const [promise, setPromise] = React.useState(null);
        const value = promise ? React.use(promise) : promise;

        React.useMemo(() => {}, []);

        return (
          <>
            <Updater setPromise={setPromise} />
            <React.Suspense fallback="Loading...">
              <ErrorBoundary>
                <Bomb />
              </ErrorBoundary>
            </React.Suspense>
            {value !== null ? value : 'hello world'}
          </>
        );
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return <Page />;
      }

      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            Scheduler.log('onError: ' + error.message);
          },
        });
        pipe(writable);
      });
      assertLog(['onError: boom']);

      const errors = await hydrateRootAndCollectErrors(<App />);
      assertLog(['onCaughtError: boom']);

      expect(
        errors.find(error => error.includes('Rendered more hooks')),
      ).toBeUndefined();
      expect(container.textContent).toBe('Something went wrong: boomresolved');
    },
  );

  /** 测试场景：验证「preserves hooks when suspension happens before the first tracked hook」描述的渲染、交互或错误处理结果。 */
  it('preserves hooks when suspension happens before the first tracked hook', async () => {
    const {ErrorBoundary, Bomb} = createErrorBoundaryAndBomb();
    let setReady;

    /** `Updater`：封装当前用例复用的操作、回调或断言步骤。 */
    function Updater({setPromise}) {
      React.useEffect(() => {
        setReady(true);
        startTransition(() => {
          setPromise(Promise.resolve('resolved'));
        });
      }, []);

      return null;
    }

    /** `Page`：封装当前用例复用的操作、回调或断言步骤。 */
    function Page({promise}) {
      const value = promise ? React.use(promise) : promise;

      const [ready, _setReady] = React.useState(false);
      setReady = _setReady;

      React.useMemo(() => {}, []);

      return (
        <>
          <React.Suspense fallback="Loading...">
            <ErrorBoundary>
              <Bomb />
            </ErrorBoundary>
          </React.Suspense>
          <span>{ready ? 'ready' : 'not-ready'}</span>
          <span>{value !== null ? value : 'hello world'}</span>
        </>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [promise, setPromise] = React.useState(null);

      return (
        <>
          <Updater setPromise={setPromise} />
          <Page promise={promise} />
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          Scheduler.log('onError: ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog(['onError: boom']);

    const errors = await hydrateRootAndCollectErrors(<App />);
    assertLog(['onCaughtError: boom']);

    expect(
      errors.find(error => error.includes('Rendered more hooks')),
    ).toBeUndefined();
    expect(container.textContent).toBe(
      'Something went wrong: boomreadyresolved',
    );
  });
});
