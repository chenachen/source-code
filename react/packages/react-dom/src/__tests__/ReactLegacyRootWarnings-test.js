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
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「deprecation warning for ReactDOM.render」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
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
