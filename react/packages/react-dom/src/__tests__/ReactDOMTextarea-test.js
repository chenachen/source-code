/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `emptyFunction`：封装当前用例复用的操作、回调或断言步骤。 */
function emptyFunction() {}

describe('ReactDOMTextarea', () => {
  let React;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;
  let assertConsoleErrorDev;

  let renderTextarea;

  const ReactFeatureFlags = require('shared/ReactFeatureFlags');

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    renderTextarea = async function (component, container, root) {
      await act(() => {
        root.render(component);
      });

      const node = container.firstChild;

// 修正 jsdom 的特殊行为：真实解析器会去掉开头的换行，这里需要手动处理。
      node.defaultValue = node.innerHTML.replace(/^\n/, '');
      return node;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should allow setting `defaultValue`」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接表单宿主状态、ReactDOMSharedInternals 与提交后受控值恢复路径。
   */
  it('should allow setting `defaultValue`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue="giraffe" />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    // 改变 `defaultValue` 没有任何效果.
    await renderTextarea(<textarea defaultValue="gorilla" />, container, root);
    expect(node.value).toEqual('giraffe');

    node.value = 'cat';

    await renderTextarea(<textarea defaultValue="monkey" />, container, root);
    expect(node.value).toEqual('cat');
  });

  /** 测试场景：验证「should display `defaultValue` of number 0」描述的渲染、交互或错误处理结果。 */
  it('should display `defaultValue` of number 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue={0} />,
      container,
      root,
    );

    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should display `defaultValue` of bigint 0」描述的渲染、交互或错误处理结果。 */
  it('should display `defaultValue` of bigint 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue={0n} />,
      container,
      root,
    );

    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should display "false" for `defaultValue` of `false`」描述的渲染、交互或错误处理结果。 */
  it('should display "false" for `defaultValue` of `false`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue={false} />,
      container,
      root,
    );

    expect(node.value).toBe('false');
  });

  /** 测试场景：验证「should display "foobar" for `defaultValue` of `objToString`」描述的渲染、交互或错误处理结果。 */
  it('should display "foobar" for `defaultValue` of `objToString`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const objToString = {
      /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
      toString: function () {
        return 'foobar';
      },
    };
    const node = await renderTextarea(
      <textarea defaultValue={objToString} />,
      container,
      root,
    );

    expect(node.value).toBe('foobar');
  });

  /** 测试场景：验证「should set defaultValue」描述的渲染、交互或错误处理结果。 */
  it('should set defaultValue', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="foo" />);
    });
    await act(() => {
      root.render(<textarea defaultValue="bar" />);
    });
    await act(() => {
      root.render(<textarea defaultValue="noise" />);
    });

    expect(container.firstChild.defaultValue).toBe('noise');
  });

  /** 测试场景：验证「should not render value as an attribute」描述的渲染、交互或错误处理结果。 */
  it('should not render value as an attribute', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should display `value` of number 0」描述的渲染、交互或错误处理结果。 */
  it('should display `value` of number 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value={0} onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should update defaultValue to empty string」描述的渲染、交互或错误处理结果。 */
  it('should update defaultValue to empty string', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue={'foo'} />);
    });

    await act(() => {
      root.render(<textarea defaultValue={''} />);
    });

    expect(container.firstChild.defaultValue).toBe('');
  });

  /** 测试场景：验证「should allow setting `value` to `giraffe`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `giraffe`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<textarea value="gorilla" onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('gorilla');
  });

  /** 测试场景：验证「will not initially assign an empty value (covers case where firefox throws a validation error when required attribute is set)」描述的渲染、交互或错误处理结果。 */
  it('will not initially assign an empty value (covers case where firefox throws a validation error when required attribute is set)', async () => {
    const container = document.createElement('div');

    let counter = 0;
    const originalCreateElement = document.createElement;
    spyOnDevAndProd(document, 'createElement').mockImplementation(
      function (type) {
        const el = originalCreateElement.apply(this, arguments);
        let value = '';
        if (type === 'textarea') {
          Object.defineProperty(el, 'value', {
            /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
            get: function () {
              return value;
            },
            /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
            set: function (val) {
              value = String(val);
              counter++;
            },
          });
        }
        return el;
      },
    );

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="" readOnly={true} />);
    });

    expect(counter).toEqual(0);
  });

  /** 测试场景：验证「should render defaultValue for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render defaultValue for SSR', () => {
    const markup = ReactDOMServer.renderToString(<textarea defaultValue="1" />);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.innerHTML).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 测试场景：验证「should render value for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render value for SSR', () => {
    const element = <textarea value="1" onChange={function () {}} />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.innerHTML).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 测试场景：验证「should allow setting `value` to `true`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `true`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<textarea value={true} onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('true');
  });

  /** 测试场景：验证「should allow setting `value` to `false`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `false`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<textarea value={false} onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('false');
  });

  /** 测试场景：验证「should allow setting `value` to `objToString`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `objToString`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    const objToString = {
      /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
      toString: function () {
        return 'foo';
      },
    };

    await act(() => {
      root.render(<textarea value={objToString} onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('foo');
  });

  /** 测试场景：验证「should throw when value is set to a Temporal-like object」描述的渲染、交互或错误处理结果。 */
  it('should throw when value is set to a Temporal-like object', async () => {
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '2020-01-01';
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    /** `test`：封装当前用例复用的操作、回调或断言步骤。 */
    const test = async () => {
      await act(() => {
        root.render(
          <textarea value={new TemporalLike()} onChange={emptyFunction} />,
        );
      });
    };
    await expect(test).rejects.toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in textarea (at **',
    ]);
  });

  /** 测试场景：验证「should take updates to `defaultValue` for uncontrolled textarea」描述的渲染、交互或错误处理结果。 */
  it('should take updates to `defaultValue` for uncontrolled textarea', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');

    await act(() => {
      root.render(<textarea defaultValue="1" />);
    });

    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should take updates to children in lieu of `defaultValue` for uncontrolled textarea」描述的渲染、交互或错误处理结果。 */
  it('should take updates to children in lieu of `defaultValue` for uncontrolled textarea', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');

    await act(() => {
      root.render(<textarea>1</textarea>);
    });

    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should not incur unnecessary DOM mutations」描述的渲染、交互或错误处理结果。 */
  it('should not incur unnecessary DOM mutations', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="a" onChange={emptyFunction} />);
    });

    const node = container.firstChild;
    let nodeValue = 'a';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
      get: function () {
        return nodeValue;
      },
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<textarea value="a" onChange={emptyFunction} />);
    });

    expect(nodeValueSetter).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(<textarea value="b" onChange={emptyFunction} />);
    });

    expect(nodeValueSetter).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should properly control a value of number `0`」描述的渲染、交互或错误处理结果。 */
  it('should properly control a value of number `0`', async () => {
    const setUntrackedValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    ).set;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    document.body.appendChild(container);

    try {
      const node = await renderTextarea(
        <textarea value={0} onChange={emptyFunction} />,
        container,
        root,
      );

      setUntrackedValue.call(node, 'giraffe');
      node.dispatchEvent(
        new Event('input', {bubbles: true, cancelable: false}),
      );
      expect(node.value).toBe('0');
    } finally {
      document.body.removeChild(container);
    }
  });

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should ignore children content」描述的渲染、交互或错误处理结果。 */
    it('should ignore children content', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>giraffe</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');

      await act(() => {
        root.render(<textarea>gorilla</textarea>);
      });

      expect(node.value).toEqual('');
    });
  }

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should receive defaultValue and still ignore children content」描述的渲染、交互或错误处理结果。 */
    it('should receive defaultValue and still ignore children content', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const node = await renderTextarea(
        <textarea defaultValue="dragon">monkey</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('dragon');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should treat children like `defaultValue`」描述的渲染、交互或错误处理结果。 */
    it('should treat children like `defaultValue`', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const node = await renderTextarea(
        <textarea>giraffe</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);

      expect(node.value).toBe('giraffe');

      await act(() => {
        root.render(<textarea>gorilla</textarea>);
      });

      expect(node.value).toEqual('giraffe');
    });
  }

  /** 测试场景：验证「should keep value when switching to uncontrolled element if not changed」描述的渲染、交互或错误处理结果。 */
  it('should keep value when switching to uncontrolled element if not changed', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="kitten" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('kitten');

    await act(() => {
      root.render(<textarea defaultValue="gorilla" />);
    });

    expect(node.value).toEqual('kitten');
  });

  /** 测试场景：验证「should keep value when switching to uncontrolled element if changed」描述的渲染、交互或错误处理结果。 */
  it('should keep value when switching to uncontrolled element if changed', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="kitten" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('kitten');

    await act(() => {
      root.render(<textarea value="puppies" onChange={emptyFunction} />);
    });

    expect(node.value).toBe('puppies');

    await act(() => {
      root.render(<textarea defaultValue="gorilla" />);
    });

    expect(node.value).toEqual('puppies');
  });

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should ignore numbers as children」描述的渲染、交互或错误处理结果。 */
    it('should ignore numbers as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{17}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should allow numbers as children」描述的渲染、交互或错误处理结果。 */
    it('should allow numbers as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{17}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('17');
    });
  }

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should ignore booleans as children」描述的渲染、交互或错误处理结果。 */
    it('should ignore booleans as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{false}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should allow booleans as children」描述的渲染、交互或错误处理结果。 */
    it('should allow booleans as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{false}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('false');
    });
  }

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should ignore objects as children」描述的渲染、交互或错误处理结果。 */
    it('should ignore objects as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const obj = {
        /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
        toString: function () {
          return 'sharkswithlasers';
        },
      };
      const node = await renderTextarea(
        <textarea>{obj}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should allow objects as children」描述的渲染、交互或错误处理结果。 */
    it('should allow objects as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const obj = {
        /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
        toString: function () {
          return 'sharkswithlasers';
        },
      };
      const node = await renderTextarea(
        <textarea>{obj}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('sharkswithlasers');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 测试场景：验证「should throw with multiple or invalid children」描述的渲染、交互或错误处理结果。 */
    it('should throw with multiple or invalid children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(async () => {
        await act(() => {
          root.render(
            <textarea>
              {'hello'}
              {'there'}
            </textarea>,
          );
        });
      }).rejects.toThrow('<textarea> can only have at most one child');
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);

      let node;
      await expect(
        (async () =>
          (node = await renderTextarea(
            <textarea>
              <strong />
            </textarea>,
            container,
            root,
          )))(),
      ).resolves.not.toThrow();
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);

      expect(node.value).toBe('[object Object]');
    });
  }

  /** 测试场景：验证「should unmount」描述的渲染、交互或错误处理结果。 */
  it('should unmount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea />);
    });

    await act(() => {
      root.unmount();
    });
  });

  /** 测试场景：验证「should warn if value is null」描述的渲染、交互或错误处理结果。 */
  it('should warn if value is null', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value={null} />);
    });
    assertConsoleErrorDev([
      '`value` prop on `textarea` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` ' +
        'for uncontrolled components.\n' +
        '    in textarea (at **)',
    ]);

    await act(() => {
      root.render(<textarea value={null} />);
    });
  });

  /** 测试场景：验证「should warn if value and defaultValue are specified」描述的渲染、交互或错误处理结果。 */
  it('should warn if value and defaultValue are specified', async () => {
    /** `InvalidComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    const InvalidComponent = () => (
      <textarea value="foo" defaultValue="bar" readOnly={true} />
    );
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<InvalidComponent />);
    });
    assertConsoleErrorDev([
      'InvalidComponent contains a textarea with both value and defaultValue props. ' +
        'Textarea elements must be either controlled or uncontrolled ' +
        '(specify either the value prop, or the defaultValue prop, but not ' +
        'both). Decide between using a controlled or uncontrolled textarea ' +
        'and remove one of these props. More info: ' +
        'https://react.dev/link/controlled-components\n' +
        '    in textarea (at **)\n' +
        '    in InvalidComponent (at **)',
    ]);

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<InvalidComponent />);
    });
  });

  /** 测试场景：验证「should not warn about missing onChange in uncontrolled textareas」描述的渲染、交互或错误处理结果。 */
  it('should not warn about missing onChange in uncontrolled textareas', async () => {
    const container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<textarea />);
    });

    await act(() => {
      root.unmount();
    });
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<textarea value={undefined} />);
    });
  });

  /** 测试场景：验证「does not set textContent if value is unchanged」描述的渲染、交互或错误处理结果。 */
  it('does not set textContent if value is unchanged', async () => {
    const container = document.createElement('div');
    let node;
    let instance;
    // 设置 textarea 的 defaultValue 等价于设置 textContent，也是当前采用的实现；因此可观察
    // defaultValue 是否被设置，判断 textContent 是否重新创建。
    // https://html.spec.whatwg.org/#the-textarea-element
    let defaultValue;
    const set = jest.fn(value => {
      defaultValue = value;
    });
    const get = jest.fn(value => {
      return defaultValue;
    });
    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.state`：记录测试夹具在当前场景中的状态。 */
      state = {count: 0, text: 'foo'};
      /** `App.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        instance = this;
      }
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <span>{this.state.count}</span>
            <textarea
              ref={n => (node = n)}
              value="foo"
              onChange={emptyFunction}
              data-count={this.state.count}
            />
          </div>
        );
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    defaultValue = node.defaultValue;
    Object.defineProperty(node, 'defaultValue', {get, set});
    instance.setState({count: 1});
    expect(set.mock.calls.length).toBe(0);
  });

  describe('When given a Symbol value', () => {
    /** 测试场景：验证「treats initial Symbol value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial Symbol value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea value={Symbol('foobar')} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats initial Symbol children as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial Symbol children as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea onChange={() => {}}>{Symbol('foo')}</textarea>);
      });
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats updated Symbol value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated Symbol value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea value="foo" onChange={() => {}} />);
      });

      await act(() => {
        root.render(<textarea value={Symbol('foo')} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats initial Symbol defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial Symbol defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea defaultValue={Symbol('foobar')} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats updated Symbol defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated Symbol defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea defaultValue="foo" />);
      });

      await act(() => {
        root.render(<textarea defaultValue={Symbol('foobar')} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('foo');
    });
  });

  describe('When given a function value', () => {
    /** 测试场景：验证「treats initial function value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial function value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea value={() => {}} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats initial function children as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial function children as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea onChange={() => {}}>{() => {}}</textarea>);
      });
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats updated function value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated function value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea value="foo" onChange={() => {}} />);
      });

      await act(() => {
        root.render(<textarea value={() => {}} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats initial function defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial function defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea defaultValue={() => {}} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('');
    });

    /** 测试场景：验证「treats updated function defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated function defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea defaultValue="foo" />);
      });

      await act(() => {
        root.render(<textarea defaultValue={() => {}} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('foo');
    });
  });

  /** 测试场景：验证「should remove previous `defaultValue`」描述的渲染、交互或错误处理结果。 */
  it('should remove previous `defaultValue`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');

    await act(() => {
      root.render(<textarea />);
    });

    expect(node.defaultValue).toBe('');
  });

  /** 测试场景：验证「should treat `defaultValue={null}` as missing」描述的渲染、交互或错误处理结果。 */
  it('should treat `defaultValue={null}` as missing', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');

    await act(() => {
      root.render(<textarea defaultValue={null} />);
    });

    expect(node.defaultValue).toBe('');
  });

  /** 测试场景：验证「should not warn about missing onChange if value is undefined」描述的渲染、交互或错误处理结果。 */
  it('should not warn about missing onChange if value is undefined', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value={undefined} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 测试场景：验证「should not warn about missing onChange if onChange is set」描述的渲染、交互或错误处理结果。 */
  it('should not warn about missing onChange if onChange is set', async () => {
    const change = jest.fn();
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value="something" onChange={change} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 测试场景：验证「should not warn about missing onChange if disabled is true」描述的渲染、交互或错误处理结果。 */
  it('should not warn about missing onChange if disabled is true', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value="something" disabled={true} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 测试场景：验证「should not warn about missing onChange if value is not set」描述的渲染、交互或错误处理结果。 */
  it('should not warn about missing onChange if value is not set', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value="something" readOnly={true} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 测试场景：验证「should warn about missing onChange if value is false」描述的渲染、交互或错误处理结果。 */
  it('should warn about missing onChange if value is false', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value={false} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about missing onChange if value is 0」描述的渲染、交互或错误处理结果。 */
  it('should warn about missing onChange if value is 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value={0} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about missing onChange if value is "0"」描述的渲染、交互或错误处理结果。 */
  it('should warn about missing onChange if value is "0"', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="0" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about missing onChange if value is ""」描述的渲染、交互或错误处理结果。 */
  it('should warn about missing onChange if value is ""', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });
});
