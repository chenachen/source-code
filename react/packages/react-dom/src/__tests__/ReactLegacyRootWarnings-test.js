let ReactDOM = require('react-dom');

describe('ReactDOMRoot', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    container = document.createElement('div');
    ReactDOM = require('react-dom');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // @gate !disableLegacyMode

  /** 在 legacy 模式可用的构建中，对空容器调用 ReactDOM.render("Hi")；内容应实际提交为 Hi，DEV 只报告一次 React 18 起不支持该入口的弃用消息，验证兼容行为与诊断同时保留。 */
  it('deprecation warning for ReactDOM.render', () => {
    spyOnDev(console, 'error');

    ReactDOM.render('Hi', container);
    expect(container.textContent).toEqual('Hi');
    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error.mock.calls[0][0]).toContain(
        'ReactDOM.render has not been supported since React 18',
      );
    }
  });
});
