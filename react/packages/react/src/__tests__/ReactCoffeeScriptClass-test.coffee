###
Copyright (c) Meta Platforms, Inc. and affiliates.

This source code is licensed under the MIT license found in the
LICENSE file in the root directory of this source tree.
###

# 每个用例重新加载的旧版上下文校验器。
PropTypes = null
# 当前用例使用的 React 公共入口。
React = null
# 旧版 ReactDOM 测试入口。
ReactDOM = null
# 并发根客户端入口。
ReactDOMClient = null
# 开发态错误输出断言助手。
assertConsoleErrorDev = null
# 开发态警告输出断言助手。
assertConsoleWarnDev = null

# 控制旧版上下文等测试分支的特性标志。
featureFlags = require 'shared/ReactFeatureFlags'

describe 'ReactCoffeeScriptClass', ->
  # 当前用例挂载根的 DOM 容器。
  container = null
  # 当前用例创建的客户端根。
  root = null
  # 记录 props 与监听器的共享叶子组件类。
  InnerComponent = null
  # 叶子组件最近收到的点击监听器。
  attachedListener = null;
  # 叶子组件最近收到的名称。
  renderedName = null;

  # 为每个用例重新建立隔离根、断言助手与共享叶子组件。
  beforeEach ->
    React = require 'react'
    ReactDOM = require 'react-dom'
    ReactDOMClient = require 'react-dom/client'
    PropTypes = require 'prop-types'
    container = document.createElement 'div'
    root = ReactDOMClient.createRoot container
    attachedListener = null
    renderedName = null
    TestUtils = require 'internal-test-utils'
    assertConsoleErrorDev = TestUtils.assertConsoleErrorDev
    assertConsoleWarnDev = TestUtils.assertConsoleWarnDev
    # 测试叶子类：暴露名称，并把收到的 props 写入外部探针。
    InnerComponent = class extends React.Component
      # 返回当前名称属性，供实例相关断言读取。
      getName: -> this.props.name
      # 捕获监听器与名称，并生成对应 className 的宿主 div。
      render: ->
        attachedListener = this.props.onClick
        renderedName = this.props.name
        return React.createElement('div', className: this.props.name)

  # Given 待测元素与期望形状；When 同步提交；Then 验证首个宿主节点。
  test = (element, expectedTag, expectedClassName) ->
    ReactDOM.flushSync ->
      root.render(element)
    expect(container.firstChild).not.toBeNull()
    expect(container.firstChild.tagName).toBe(expectedTag)
    expect(container.firstChild.className).toBe(expectedClassName)

  it 'preserves the name of the class for use in error messages', ->
    # Given：在用例中声明名为 Foo 的 CoffeeScript 类组件。
    # When：读取 CoffeeScript 编译后保留的构造器名称。
    # Then：名称仍为 Foo，React 的错误消息即可准确指出组件。
    # 验证 CoffeeScript 类名会保留给 React 错误消息。
    class Foo extends React.Component
    expect(Foo.name).toBe 'Foo'

  it 'throws if no render function is defined', ->
    # 故意缺少 render 的类，用于验证错误路径。
    class Foo extends React.Component
    caughtErrors = []
    # 阻止浏览器默认错误传播，并收集 renderer 抛出的错误。
    errorHandler = (event) ->
      event.preventDefault()
      caughtErrors.push(event.error)
    window.addEventListener 'error', errorHandler;
    ReactDOM.flushSync ->
      root.render React.createElement(Foo)
    assertConsoleErrorDev [
# 并发开发模式会把失败组件尝试两次，因此期望两条诊断。
      'No `render` method found on the Foo instance: you may have forgotten to define `render`.\n' +
        '     in Foo (at **)',
      'No `render` method found on the Foo instance: you may have forgotten to define `render`.\n' +
        '     in Foo (at **)',
    ]
    window.removeEventListener 'error', errorHandler;
    expect(caughtErrors).toEqual([
      expect.objectContaining(
        message: expect.stringContaining('is not a function')
      )
    ])

  it 'renders a simple stateless component with prop', ->
    # 仅根据 props 渲染的无状态类组件。
    class Foo extends React.Component
      # 把 bar 属性映射为共享叶子的名称。
      render: ->
        React.createElement(InnerComponent,
          name: @props.bar
        )

    test React.createElement(Foo, bar: 'foo'), 'DIV', 'foo'
    test React.createElement(Foo, bar: 'bar'), 'DIV', 'bar'

  it 'renders based on state using initial values in this.props', ->
    # 在构造器中从实例 props 建立初始 state。
    class Foo extends React.Component
      # 调用基类后捕获初始属性。
      constructor: (props) ->
        super props
        @state = bar: @props.initialValue

      # 以当前状态渲染 span。
      render: ->
        React.createElement('span',
          className: @state.bar
        )

    test React.createElement(Foo, initialValue: 'foo'), 'SPAN', 'foo'

  it 'renders based on state using props in the constructor', ->
    # 通过 props 初始化并用 setState 切换宿主输出的组件。
    class Foo extends React.Component
      # 捕获构造参数中的初始值。
      constructor: (props) ->
        @state = bar: props.initialValue

      # 把状态更新为 bar。
      changeState: ->
        @setState bar: 'bar'

      # 初始 foo 渲染 div，更新后渲染 span。
      render: ->
        if @state.bar is 'foo'
          return React.createElement('div',
            className: 'foo'
          )
        React.createElement('span',
          className: @state.bar
        )

    ref = React.createRef()
    test React.createElement(Foo, initialValue: 'foo', ref: ref), 'DIV', 'foo'
    ReactDOM.flushSync ->
      ref.current.changeState()
    test React.createElement(Foo), 'SPAN', 'bar'

  it 'sets initial state with value returned by static getDerivedStateFromProps', ->
    # 验证静态派生状态在首次渲染前合并到初始形状。
    class Foo extends React.Component
      # 初始化 foo 字段，给派生钩子提供稳定状态。
      constructor: (props) ->
        super props
        @state = foo: null
      # 输出派生后的 foo 与 bar。
      render: ->
        React.createElement('div',
          className: "#{@state.foo} #{@state.bar}"
        )
    # 从新属性生成首次状态补丁。
    Foo.getDerivedStateFromProps = (nextProps, prevState) ->
      {
        foo: nextProps.foo
        bar: 'bar'
      }
    test React.createElement(Foo, foo: 'foo'), 'DIV', 'foo bar'

  it 'warns if getDerivedStateFromProps is not static', ->
    # 故意把派生状态 API 定义为实例方法。
    class Foo extends React.Component
      # 输出稳定宿主节点。
      render: ->
        React.createElement('div')
      # 应被忽略并触发静态方法建议。
      getDerivedStateFromProps: ->
        {}
    ReactDOM.flushSync ->
     root.render React.createElement(Foo, foo: 'foo')
    assertConsoleErrorDev [
      'Foo: getDerivedStateFromProps() is defined as an instance method and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)']

  it 'warns if getDerivedStateFromError is not static', ->
    # 故意把派生错误状态 API 定义为实例方法。
    class Foo extends React.Component
      # 输出稳定宿主节点。
      render: ->
        React.createElement('div')
      # 应被忽略并触发静态方法建议。
      getDerivedStateFromError: ->
        {}
    ReactDOM.flushSync ->
      root.render React.createElement(Foo, foo: 'foo')

    assertConsoleErrorDev [
      'Foo: getDerivedStateFromError() is defined as an instance method and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)'
    ]

  it 'warns if getSnapshotBeforeUpdate is static', ->
    # 用静态快照 API 构造错误形状。
    class Foo extends React.Component
      # 输出稳定宿主节点。
      render: ->
        React.createElement('div')
    # 应被忽略并触发实例方法建议。
    Foo.getSnapshotBeforeUpdate = () ->
      {}
    ReactDOM.flushSync ->
      root.render React.createElement(Foo, foo: 'foo')

    assertConsoleErrorDev [
      'Foo: getSnapshotBeforeUpdate() is defined as a static method and will be ignored. Instead, declare it as an instance method.\n' +
        '    in Foo (at **)'
    ]

  it 'warns if state not initialized before static getDerivedStateFromProps', ->
    # 缺少初始 state 却声明派生状态钩子的错误形状。
    class Foo extends React.Component
      # 读取派生后的字段，迫使 React 执行派生流程。
      render: ->
        React.createElement('div',
          className: "#{@state.foo} #{@state.bar}"
        )
    # 返回对象补丁，但旧状态没有稳定初始形状。
    Foo.getDerivedStateFromProps = (nextProps, prevState) ->
      {
        foo: nextProps.foo
        bar: 'bar'
      }
    ReactDOM.flushSync ->
      root.render React.createElement(Foo, foo: 'foo')

    assertConsoleErrorDev [
      '`Foo` uses `getDerivedStateFromProps` but its initial state is
       undefined. This is not recommended. Instead, define the initial state by
       assigning an object to `this.state` in the constructor of `Foo`.
       This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '     in Foo (at **)'
    ]

  it 'updates initial state with values returned by static getDerivedStateFromProps', ->
    # 验证派生状态覆盖 foo 且保留未返回的 bar。
    class Foo extends React.Component
      # 建立完整初始状态。
      constructor: (props, context) ->
        super props, context
        @state =
          foo: 'foo'
          bar: 'bar'
      # 输出合并后的状态字段。
      render: ->
        React.createElement('div',
          className: "#{@state.foo} #{@state.bar}"
        )
    # 根据旧 foo 生成新值，故意省略 bar。
    Foo.getDerivedStateFromProps = (nextProps, prevState) ->
      {
        foo: "not-#{prevState.foo}"
      }
    test React.createElement(Foo), 'DIV', 'not-foo bar'

  it 'renders updated state with values returned by static getDerivedStateFromProps', ->
    # 验证更新期派生状态可按 props 返回补丁或 null。
    class Foo extends React.Component
      # 建立初始 value。
      constructor: (props, context) ->
        super props, context
        @state =
          value: 'initial'
      # 输出当前派生值。
      render: ->
        React.createElement('div',
          className: @state.value
        )
    # update 为真时切换值，否则保持原状态。
    Foo.getDerivedStateFromProps = (nextProps, prevState) ->
      if nextProps.update
        return {
          value: 'updated'
        }
      return null
    test React.createElement(Foo, update: false), 'DIV', 'initial'
    test React.createElement(Foo, update: true), 'DIV', 'updated'

  if !featureFlags.disableLegacyContext
    it 'renders based on context in the constructor', ->
      # 在构造器中读取旧版 context 并保存进 state 的消费者。
      class Foo extends React.Component
        # 声明需要的旧版上下文字段。
        @contextTypes:
          tag: PropTypes.string
          className: PropTypes.string

        # 从 context 参数和实例 context 捕获初始状态。
        constructor: (props, context) ->
          super props, context
          @state =
            tag: context.tag
            className: @context.className

        # 以 context 派生出的动态标签和类名渲染。
        render: ->
          Tag = @state.tag
          React.createElement Tag,
            className: @state.className

      # 为消费者提供固定旧版子上下文的父组件。
      class Outer extends React.Component
        # 声明向后代提供的上下文字段。
        @childContextTypes:
          tag: PropTypes.string
          className: PropTypes.string

        # 返回稳定上下文值。
        getChildContext: ->
          tag: 'span'
          className: 'foo'

        # 渲染旧版上下文消费者。
        render: ->
          React.createElement Foo

      test React.createElement(Outer), 'SPAN', 'foo'
      
      assertConsoleErrorDev([
        'Outer uses the legacy childContextTypes API which will soon be removed.
         Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in Outer (at **)',
        'Foo uses the legacy contextTypes API which will soon be removed.
         Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in Outer (at **)',
      ]);

  it 'renders only once when setting state in componentWillMount', ->
    renderCount = 0
    # 挂载前 setState 应合并进首次渲染而不额外提交。
    class Foo extends React.Component
      # 从 props 建立初始状态。
      constructor: (props) ->
        @state = bar: props.initialValue

      # 挂载前把状态更新为 bar。
      UNSAFE_componentWillMount: ->
        @setState bar: 'bar'

      # 累加渲染次数并输出当前状态。
      render: ->
        renderCount++
        React.createElement('span', className: @state.bar)

    test React.createElement(Foo, initialValue: 'foo'), 'SPAN', 'bar'
    expect(renderCount).toBe(1)

  it 'should warn with non-object in the initial state property', ->
    [['an array'], 'a string', 1234].forEach (state) ->
      # 为每种非法非对象状态构造独立组件。
      class Foo extends React.Component
        # 故意安装当前非法测试值。
        constructor: ->
          @state = state

        # 提供最小渲染实现，使失败聚焦于 state 校验。
        render: ->
          React.createElement('span')

      test React.createElement(Foo), 'SPAN', ''
      assertConsoleErrorDev [
        'Foo.state: must be set to an object or null\n' +
          '    in Foo (at **)'
      ]

  it 'should render with null in the initial state property', ->
    # null 是 React 允许的空状态边界。
    class Foo extends React.Component
      # 显式安装合法 null 状态。
      constructor: ->
        @state = null

      # 渲染最小宿主节点以证明挂载成功。
      render: ->
        React.createElement('span')

    test React.createElement(Foo), 'SPAN', ''

  it 'setState through an event handler', ->
    # 使用双箭头自动绑定实例，并在事件中 setState。
    class Foo extends React.Component
      # 从 props 建立名称状态。
      constructor: (props) ->
        @state = bar: props.initialValue

      # 已绑定的点击处理器，把状态更新为 bar。
      handleClick: =>
        @setState bar: 'bar'

      # 把状态与监听器传给共享叶子。
      render: ->
        React.createElement(InnerComponent,
          name: @state.bar
          onClick: @handleClick
        )

    test React.createElement(Foo, initialValue: 'foo'), 'DIV', 'foo'
    ReactDOM.flushSync ->
      attachedListener()
    expect(renderedName).toBe 'bar'

  it 'should not implicitly bind event handlers', ->
    # 使用普通箭头验证 React 不会隐式绑定 CoffeeScript 方法。
    class Foo extends React.Component
      # 从 props 建立名称状态。
      constructor: (props) ->
        @state = bar: props.initialValue

      # 普通箭头不会绑定实例；要绑定必须使用双箭头。
      handleClick: ->
        @setState bar: 'bar'

      # 把未绑定方法原样传给共享叶子。
      render: ->
        React.createElement(InnerComponent,
          name: @state.bar
          onClick: @handleClick
        )

    test React.createElement(Foo, initialValue: 'foo'), 'DIV', 'foo'
    expect(attachedListener).toThrow()

  it 'renders using forceUpdate even when there is no state', ->
    # 通过可变字段和 forceUpdate 驱动重新渲染，不使用 state。
    class Foo extends React.Component
      # 捕获初始可变值。
      constructor: (props) ->
        @mutativeValue = props.initialValue

      # 修改字段并强制安排更新。
      handleClick: =>
        @mutativeValue = 'bar'
        @forceUpdate()

      # 输出可变值与绑定监听器。
      render: ->
        React.createElement(InnerComponent,
          name: @mutativeValue
          onClick: @handleClick
        )

    test React.createElement(Foo, initialValue: 'foo'), 'DIV', 'foo'
    ReactDOM.flushSync ->
      attachedListener()
    expect(renderedName).toBe 'bar'

  it 'will call all the normal life cycle methods', ->
    lifeCycles = []
    # 覆盖完整旧式正常生命周期的探针组件。
    class Foo extends React.Component
      # 建立空对象状态，给生命周期参数稳定形状。
      constructor: ->
        @state = {}

      # 记录挂载前阶段。
      UNSAFE_componentWillMount: ->
        lifeCycles.push 'will-mount'

      # 记录挂载提交完成。
      componentDidMount: ->
        lifeCycles.push 'did-mount'

      # 记录收到的新属性。
      UNSAFE_componentWillReceiveProps: (nextProps) ->
        lifeCycles.push 'receive-props', nextProps

      # 记录更新判定参数并允许继续。
      shouldComponentUpdate: (nextProps, nextState) ->
        lifeCycles.push 'should-update', nextProps, nextState
        true

      # 记录更新前的新属性与状态。
      UNSAFE_componentWillUpdate: (nextProps, nextState) ->
        lifeCycles.push 'will-update', nextProps, nextState

      # 记录提交后的旧属性与状态。
      componentDidUpdate: (prevProps, prevState) ->
        lifeCycles.push 'did-update', prevProps, prevState

      # 记录卸载阶段。
      componentWillUnmount: ->
        lifeCycles.push 'will-unmount'

      # 以属性值渲染 span。
      render: ->
        React.createElement('span',
          className: @props.value
        )

    test React.createElement(Foo, value: 'foo'), 'SPAN', 'foo'
    expect(lifeCycles).toEqual [
      'will-mount'
      'did-mount'
    ]
    lifeCycles = [] # 清空挂载记录，单独观察更新阶段。
    test React.createElement(Foo, value: 'bar'), 'SPAN', 'bar'
    expect(lifeCycles).toEqual [
      'receive-props', { value: 'bar' }
      'should-update', { value: 'bar' }, {}
      'will-update',   { value: 'bar' }, {}
      'did-update',    { value: 'foo' }, {}
    ]
    lifeCycles = [] # 清空更新记录，单独观察卸载阶段。
    ReactDOM.flushSync ->
      root.unmount()
    expect(lifeCycles).toEqual ['will-unmount']

  if !featureFlags.disableLegacyContext
    it 'warns when classic properties are defined on the instance,
        but does not invoke them.', ->
      getInitialStateWasCalled = false
      getDefaultPropsWasCalled = false
      # 把 createClass 专用属性错误地定义到普通 ES 类实例。
      class Foo extends React.Component
        # 安装错误的实例版 contextTypes/contextType。
        constructor: ->
          @contextTypes = {}
          @contextType = {}

        # 若 React 错误调用则翻转探针。
        getInitialState: ->
          getInitialStateWasCalled = true
          {}

        # 若 React 错误调用则翻转探针。
        getDefaultProps: ->
          getDefaultPropsWasCalled = true
          {}

        # 输出稳定宿主节点，让断言聚焦于告警。
        render: ->
          React.createElement('span',
            className: 'foo'
          )

      test React.createElement(Foo), 'SPAN', 'foo'
      assertConsoleErrorDev [
        'getInitialState was defined on Foo, a plain JavaScript class.
         This is only supported for classes created using React.createClass.
         Did you mean to define a state property instead?\n' +
          '     in Foo (at **)',
        'getDefaultProps was defined on Foo, a plain JavaScript class.
         This is only supported for classes created using React.createClass.
         Use a static property to define defaultProps instead.\n' +
          '    in Foo (at **)',
        'contextType was defined as an instance property on Foo. Use a static property to define contextType instead.\n' +
          '    in Foo (at **)',
        'contextTypes was defined as an instance property on Foo. Use a static property to define contextTypes instead.\n' +
          '    in Foo (at **)',
      ]
      expect(getInitialStateWasCalled).toBe false
      expect(getDefaultPropsWasCalled).toBe false

  it 'does not warn about getInitialState() on class components
      if state is also defined.', ->
    # 同时定义显式 state 与旧 getInitialState，验证前者消除迁移告警。
    class Foo extends React.Component
      # 建立显式 state。
      constructor: (props) ->
        super props
        @state = bar: @props.initialValue

      # 旧 createClass 风格方法；不应被调用或告警。
      getInitialState: ->
        {}

      # 输出稳定宿主节点。
      render: ->
        React.createElement('span',
          className: 'foo'
        )

    test React.createElement(Foo), 'SPAN', 'foo'

  it 'should warn when misspelling shouldComponentUpdate', ->
    # 故意把 shouldComponentUpdate 拼成陈述式名称。
    class NamedComponent extends React.Component
      # 错拼的方法，React 应识别并给出建议。
      componentShouldUpdate: ->
        false

      # 输出稳定宿主节点。
      render: ->
        React.createElement('span',
          className: 'foo'
        )

    test React.createElement(NamedComponent), 'SPAN', 'foo'
    assertConsoleErrorDev [
      'NamedComponent has a method called componentShouldUpdate().
       Did you mean shouldComponentUpdate()? The name is phrased as a
       question because the function is expected to return a value.\n' +
        '    in NamedComponent (at **)'
    ]

  it 'should warn when misspelling componentWillReceiveProps', ->
    # 故意把 Receive 拼成 Recieve。
    class NamedComponent extends React.Component
      # 错拼的旧生命周期，React 应识别并给出建议。
      componentWillRecieveProps: ->
        false

      # 输出稳定宿主节点。
      render: ->
        React.createElement('span',
          className: 'foo'
        )

    test React.createElement(NamedComponent), 'SPAN', 'foo'
    assertConsoleErrorDev [
      'NamedComponent has a method called componentWillRecieveProps().
       Did you mean componentWillReceiveProps()?\n' +
        '    in NamedComponent (at **)'
    ]

  it 'should warn when misspelling UNSAFE_componentWillReceiveProps', ->
    # 故意错拼 UNSAFE 接收属性生命周期。
    class NamedComponent extends React.Component
      # 错拼的 UNSAFE 生命周期，React 应识别并给出建议。
      UNSAFE_componentWillRecieveProps: ->
        false

      # 输出稳定宿主节点。
      render: ->
        React.createElement('span',
          className: 'foo'
        )

    test React.createElement(NamedComponent), 'SPAN', 'foo'
    assertConsoleErrorDev [
      'NamedComponent has a method called UNSAFE_componentWillRecieveProps().
       Did you mean UNSAFE_componentWillReceiveProps()?\n' +
        '    in NamedComponent (at **)'
    ]

  it 'should throw AND warn when trying to access classic APIs', ->
    ref = React.createRef()
    test React.createElement(InnerComponent, name: 'foo', ref: ref), 'DIV', 'foo'

    expect(-> ref.current.replaceState {}).toThrow()
    assertConsoleWarnDev([
      'replaceState(...) is deprecated in plain JavaScript React classes. Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236).'])

    expect(-> ref.current.isMounted()).toThrow()
    assertConsoleWarnDev([
      'isMounted(...) is deprecated in plain JavaScript React classes. Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks.'])

  if !featureFlags.disableLegacyContext
    it 'supports this.context passed via getChildContext', ->
      # 从旧版 this.context 读取值的消费者。
      class Bar extends React.Component
        # 声明需要的旧版上下文字段。
        @contextTypes:
          bar: PropTypes.string
        # 把上下文值映射为宿主 className。
        render: ->
          React.createElement('div', className: @context.bar)

      # 通过 getChildContext 提供旧版上下文的父组件。
      class Foo extends React.Component
        # 声明向后代提供的旧版上下文字段。
        @childContextTypes:
          bar: PropTypes.string
        # 返回稳定上下文值。
        getChildContext: ->
          bar: 'bar-through-context'
        # 渲染旧版上下文消费者。
        render: ->
          React.createElement Bar

      test React.createElement(Foo), 'DIV', 'bar-through-context'
      assertConsoleErrorDev [
        'Foo uses the legacy childContextTypes API which will soon be removed. Use React.createContext() instead.
         (https://react.dev/link/legacy-context)\n' +
          '    in Foo (at **)',
        'Bar uses the legacy contextTypes API which will soon be removed. Use React.createContext() with static contextType instead.
         (https://react.dev/link/legacy-context)\n' +
          '    in Foo (at **)'
      ]

  undefined
