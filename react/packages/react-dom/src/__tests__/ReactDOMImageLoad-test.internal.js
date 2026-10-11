/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let Scheduler;
// let ReactCache;
let ReactDOM;
let ReactDOMClient;
// let Suspense;
let originalCreateElement;
// let TextResource;
// let textResourceShouldFail;
let originalHTMLImageElementSrcDescriptor;

let images = [];
let onLoadSpy = null;
let actualLoadSpy = null;

let waitForAll;
let waitFor;
let assertLog;

/** 渲染记start，父layout/passive分别记last，作为后代效应之后的阶段标记，不自动派load。 */
function PhaseMarkers({children}) {
  Scheduler.log('render start');
  React.useLayoutEffect(() => {
    Scheduler.log('last layout');
  });
  React.useEffect(() => {
    Scheduler.log('last passive');
  });
  return children;
}

/** 返回数组最后项或空数组undefined；非数组抛错，images收集顺序代表各次宿主创建。 */
function last(arr) {
  if (Array.isArray(arr)) {
    if (arr.length) {
      return arr[arr.length - 1];
    }
    return undefined;
  }
  throw new Error('last was passed something that was not an array');
}

/** 记录并返回props.text，供Yield后的渲染进度定位。 */
function Text(props) {
  Scheduler.log(props.text);
  return props.text;
}

// function AsyncText(props) {
//   const text = props.text;
//   try {
//     TextResource.read([props.text, props.ms]);
//     Scheduler.log(text);
//     return text;
//   } catch (promise) {
//     if (typeof promise.then === 'function') {
//       Scheduler.log(`Suspend! [${text}]`);
//     } else {
//       Scheduler.log(`Error! [${text}]`);
//     }
//     throw promise;
//   }
// }

/** 默认src为default，记录后只把src/onLoad传img；useImageLoader/ref参数在此fixture未使用，不实现网络加载器。 */
function Img({src: maybeSrc, onLoad, useImageLoader, ref}) {
  const src = maybeSrc || 'default';
  Scheduler.log('Img ' + src);
  return <img src={src} onLoad={onLoad} />;
}

/** 记Yield并向mock Scheduler请求paint，允许过渡工作在此暂停，返回null无宿主。 */
function Yield() {
  Scheduler.log('Yield');
  Scheduler.unstable_requestPaint();
  return null;
}

/** 手动创建不冒泡load，先清测试标记__needsDispatch再dispatch；不是触发真正网络读取或React队列重放。 */
function loadImage(element) {
  const event = new Event('load');
  element.__needsDispatch = false;
  element.dispatchEvent(event);
}

describe('ReactDOMImageLoad', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler');
    // ReactCache = require('react-cache');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    // Suspense = React.Suspense;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;

    /** 合成onLoad记录提交后target的当前src attribute，与原生spy日志对照。 */
    onLoadSpy = jest.fn(reactEvent => {
      const src = reactEvent.target.getAttribute('src');
      Scheduler.log('onLoadSpy [' + src + ']');
    });

    /** 每个img直接原生load监听，记录当前src；即使尚未提交/已经卸载也可能记录，不能等同合成派发。 */
    actualLoadSpy = jest.fn(nativeEvent => {
      const src = nativeEvent.target.getAttribute('src');
      Scheduler.log('actualLoadSpy [' + src + ']');
      nativeEvent.__originalDispatch = false;
    });

    // TextResource = ReactCache.unstable_createResource(
    //   ([text, ms = 0]) => {
    //     let listeners = null;
    //     let status = 'pending';
    //     let value = null;
    //     return {
    //       then(resolve, reject) {
    //         switch (status) {
    //           case 'pending': {
    //             if (listeners === null) {
    //               listeners = [{resolve, reject}];
    //               setTimeout(() => {
    //                 if (textResourceShouldFail) {
    //                   Scheduler.log(
    //                     `Promise rejected [${text}]`,
    //                   );
    //                   status = 'rejected';
    //                   value = new Error('Failed to load: ' + text);
    //                   listeners.forEach(listener => listener.reject(value));
    //                 } else {
    //                   Scheduler.log(
    //                     `Promise resolved [${text}]`,
    //                   );
    //                   status = 'resolved';
    //                   value = text;
    //                   listeners.forEach(listener => listener.resolve(value));
    //                 }
    //               }, ms);
    //             } else {
    //               listeners.push({resolve, reject});
    //             }
    //             break;
    //           }
    //           case 'resolved': {
    //             resolve(value);
    //             break;
    //           }
    //           case 'rejected': {
    //             reject(value);
    //             break;
    //           }
    //         }
    //       },
    //     };
    //   },
    //   ([text, ms]) => text,
    // );
    // textResourceShouldFail = false;

    images = [];

    originalCreateElement = document.createElement;
    /** 代理document.createElement；img创建时加原生load spy并入images，其它标签直接透传；afterEach恢复方法。 */
    document.createElement = function createElement(tagName, options) {
      const element = originalCreateElement.call(document, tagName, options);
      if (tagName === 'img') {
        element.addEventListener('load', actualLoadSpy);
        images.push(element);
      }
      return element;
    };

    originalHTMLImageElementSrcDescriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src',
    );

    Object.defineProperty(HTMLImageElement.prototype, 'src', {

      /** patched src getter直接读attribute，故此多数case没有原生绝对URL规范化。 */
      get() {
        return this.getAttribute('src');
      },

      /** patched setter记录load triggered、设__needsDispatch并setAttribute；标记潜在新加载，必须由case手动loadImage才产生事件。 */
      set(value) {
        Scheduler.log('load triggered');
        this.__needsDispatch = true;
        this.setAttribute('src', value);
      },
    });
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    Object.defineProperty(
      HTMLImageElement.prototype,
      'src',
      originalHTMLImageElementSrcDescriptor,
    );
  });

  /** 过渡render到Img/Yield暂停时手动load：仅原生spy。commitMount重写src后__needsDispatch=true，layout/passive已完成再手动第二次load才onLoad；验证重新触发原生加载，不证明首事件被保存在React replay队列或自动在effect间派发。 */
  it('captures the load event if it happens before commit phase and replays it between layout and passive effects', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img onLoad={onLoadSpy} />
          <Yield />
          <Text text={'a'} />
        </PhaseMarkers>,
      ),
    );

    await waitFor(['render start', 'Img default', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog([
      'actualLoadSpy [default]',
      // 由于尚未完成渲染，onLoadSpy 尚未被调用。
    ]);
    await waitForAll(['a', 'load triggered', 'last layout', 'last passive']);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    assertLog([
      'actualLoadSpy [default]', // 浏览器重新加载图像会使这里再次 yield。
      'onLoadSpy [default]',
    ]);
    expect(onLoadSpy).toHaveBeenCalled();
  });

  /** 过渡挂载完成layout但passive尚未执行时手动load；原生与合成spy立即各一次，再passive日志且needsDispatch=false，验证已提交目标可在effect间正常分发。 */
  it('captures the load event if it happens after commit phase and replays it', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img onLoad={onLoadSpy} />
        </PhaseMarkers>,
      ),
    );

    await waitFor([
      'render start',
      'Img default',
      'load triggered',
      'last layout',
    ]);
    Scheduler.unstable_requestPaint();
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]', 'onLoadSpy [default]']);
    await waitForAll(['last passive']);
    expect(img.__needsDispatch).toBe(false);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });

  /** Img初a预commit load仅原生，layout setSrc b触发级联同步提交；DOM图片对象仍一个，两个layout/passive轮后手动load得到b合成一次，验证原事件没有导致旧a合成派发且最新src被读取。 */
  it('replays the last load event when more than one fire before the end of the layout phase completes', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** 持有src初a，布局子UpdateSrc改b；宿主类型/位置不变用于检查同img复用。 */
    function Base() {
      const [src, setSrc] = React.useState('a');
      return (
        <PhaseMarkers>
          <Img src={src} onLoad={onLoadSpy} />
          <Yield />
          <UpdateSrc setSrc={setSrc} />
        </PhaseMarkers>
      );
    }

    /** 首次layout设src b，触发同步级联更新，不直接派load。 */
    function UpdateSrc({setSrc}) {
      React.useLayoutEffect(() => {
        setSrc('b');
      }, [setSrc]);
      return null;
    }

    React.startTransition(() => root.render(<Base />));

    await waitFor(['render start', 'Img a', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [a]']);

    await waitFor([
      'load triggered',
      'last layout',
      // layout 阶段的更新会在同步渲染前触发 passive effect 冲刷。
      'last passive',
      'render start',
      'Img b',
      'Yield',
      // 当前是同步渲染，因此忽略该 yield。
      'last layout',
      'last passive',
    ]);
    expect(images.length).toBe(1);
    loadImage(img);
    assertLog(['actualLoadSpy [b]', 'onLoadSpy [b]']);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });

  /** 初挂所有layout/passive完成后才手动load；原生/合成各一次，验证已完成提交后的普通派发；旧标题passive phase实际不是在effect内部派事件。 */
  it('replays load events that happen in passive phase after the passive phase.', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    root.render(
      <PhaseMarkers>
        <Img onLoad={onLoadSpy} />
      </PhaseMarkers>,
    );

    await waitForAll([
      'render start',
      'Img default',
      'load triggered',
      'last layout',
      'last passive',
    ]);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]', 'onLoadSpy [default]']);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });

  /** 预commit load仅原生，ChildSuppressing.layout把子树删除；随后旧img再手动load仍仅原生、React spy零次，验证已脱离挂载树的目标不再合成派发。 */
  it('captures and suppresses the load event if it happens before passive effects and a cascading update causes the img to be removed', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** 初显示children，首次layout设false删除它们，测试旧img事件不再归有效树。 */
    function ChildSuppressing({children}) {
      const [showChildren, update] = React.useState(true);
      React.useLayoutEffect(() => {
        if (showChildren) {
          update(false);
        }
      }, [showChildren]);
      return showChildren ? children : null;
    }

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <ChildSuppressing>
            <Img onLoad={onLoadSpy} />
            <Yield />
            <Text text={'a'} />
          </ChildSuppressing>
        </PhaseMarkers>,
      ),
    );

    await waitFor(['render start', 'Img default', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]']);
    await waitForAll(['a', 'load triggered', 'last layout', 'last passive']);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    // 我们期望浏览器再次加载图像，但由于我们不再渲染 img 元素，因此 onLoad 事件将不会被调用。
    assertLog(['actualLoadSpy [default]']);
    await waitForAll([]);
    expect(onLoadSpy).not.toHaveBeenCalled();
  });

  /** 同删除场景改用Switch render prop与兄弟UpdateSwitchInLayout；两提交日志后旧img手动load仅原生、合成零，验证级联删除与包装层不同仍正确。 */
  it('captures and suppresses the load event if it happens before passive effects and a cascading update causes the img to be removed, alternate', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** 状态render-prop包装，暴露当前shouldShow与setter给内部兄弟布局更新。 */
    function Switch({children}) {
      const [shouldShow, updateShow] = React.useState(true);
      return children(shouldShow, updateShow);
    }

    /** 首次layout设show=false，删除兄弟img而保留PhaseMarkers观察第二提交。 */
    function UpdateSwitchInLayout({updateShow}) {
      React.useLayoutEffect(() => {
        updateShow(false);
      }, []);
      return null;
    }

    React.startTransition(() =>
      root.render(
        <Switch>
          {(shouldShow, updateShow) => (
            <PhaseMarkers>
              <>
                {shouldShow === true ? (
                  <>
                    <Img onLoad={onLoadSpy} />
                    <Yield />
                    <Text text={'a'} />
                  </>
                ) : null}
                ,
                <UpdateSwitchInLayout updateShow={updateShow} />
              </>
            </PhaseMarkers>
          )}
        </Switch>,
      ),
    );

    await waitFor([
      // 初始渲染
      'render start',
      'Img default',
      'Yield',
    ]);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]']);
    await waitForAll([
      'a',
      'load triggered',
      // img 元素在挂载时存在。
      'last layout',
      'last passive',
      // 同步重渲染，其中图片被抑制
      'render start',
      'last layout',
      'last passive',
    ]);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    // 我们期望浏览器再次加载图像，但由于我们不再渲染 img 元素，因此 onLoad 事件将不会被调用。
    assertLog(['actualLoadSpy [default]']);
    await waitForAll([]);
    expect(onLoadSpy).not.toHaveBeenCalled();
  });

  /** 以下Suspense/AsyncText场景整体以行注释保存，没有注册it、当前不执行；原草稿欲验证恢复后新img加载及effect时序，不能算本轮运行证据。 */
  // eslint-disable-next-line jest/no-commented-out-tests
  // it('captures the load event if it happens in a suspended subtree and replays it between layout and passive effects on resumption', async function() {
  //   function SuspendingWithImage() {
  //     Scheduler.log('SuspendingWithImage');
  //     return (
  //       <Suspense fallback={<Text text="Loading..." />}>
  //         <AsyncText text="A" ms={100} />
  //         <PhaseMarkers>
  //           <Img onLoad={onLoadSpy} />
  //         </PhaseMarkers>
  //       </Suspense>
  //     );
  //   }

  //   const container = document.createElement('div');
  //   const root = ReactDOMClient.createRoot(container);

  //   React.startTransition(() => root.render(<SuspendingWithImage />));

  //   expect(Scheduler).toFlushAndYield([
  //     'SuspendingWithImage',
  //     'Suspend! [A]',
  //     'render start',
  //     'Img default',
  //     'Loading...',
  //   ]);
  //   let img = last(images);
  //   loadImage(img);
  //   expect(Scheduler).toHaveYielded(['actualLoadSpy [default]']);
  //   expect(onLoadSpy).not.toHaveBeenCalled();

  //   // 该已注释场景先推进部分定时器时间。
  //   jest.advanceTimersByTime(50);
  //   // 此时挂起内容仍未完成。
  //   expect(Scheduler).toFlushWithoutYielding();

  //   // 再推进定时器到Promise完成。
  //   jest.advanceTimersByTime(50);
  //   // 完成后应该记录成功结果。
  //   expect(Scheduler).toHaveYielded(['Promise resolved [A]']);

  //   expect(Scheduler).toFlushAndYieldThrough([
  //     'A',
  //     // 恢复后重新创建img，需再次派原生load。
  //     'render start',
  //     'Img default',
  //     'last layout',
  //   ]);

  //   expect(images.length).toBe(2);
  //   img = last(images);
  //   expect(img.__needsDispatch).toBe(true);
  //   loadImage(img);
  //   expect(Scheduler).toHaveYielded([
  //     'actualLoadSpy [default]',
  //     'onLoadSpy [default]',
  //   ]);

  //   expect(Scheduler).toFlushAndYield(['last passive']);

  //   expect(onLoadSpy).toHaveBeenCalledTimes(1);
  // });

  /** 过渡src a在Yield暂停且load仅原生，flushSync srcAlt b丢弃旧未提交宿主并新建第二img；新b手动load有合成，随后原过渡队列重基继续渲染b，验证抢占后只已提交新目标有效。 */
  it('correctly replays the last img load even when a yield + update causes the host element to change', async function () {
    let externalSetSrc = null;
    let externalSetSrcAlt = null;

    /** 分别持有过渡src与同步srcAlt，后者优先；外部setter用于抢占未提交img。 */
    function Base() {
      const [src, setSrc] = React.useState(null);
      const [srcAlt, setSrcAlt] = React.useState(null);
      externalSetSrc = setSrc;
      externalSetSrcAlt = setSrcAlt;
      return srcAlt || src ? <YieldingWithImage src={srcAlt || src} /> : null;
    }

    /** 输出Img/Yield/Text并在passive记Committed，识别旧过渡被同步b抢占后的新宿主。 */
    function YieldingWithImage({src}) {
      Scheduler.log('YieldingWithImage');
      React.useEffect(() => {
        Scheduler.log('Committed');
      });
      return (
        <>
          <Img src={src} onLoad={onLoadSpy} />
          <Yield />
          <Text text={src} />
        </>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    root.render(<Base />);

    await waitForAll([]);

    React.startTransition(() => externalSetSrc('a'));

    await waitFor(['YieldingWithImage', 'Img a', 'Yield']);
    let img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [a]']);

    ReactDOM.flushSync(() => externalSetSrcAlt('b'));

    assertLog([
      'YieldingWithImage',
      'Img b',
      'Yield',
      'b',
      'load triggered',
      'Committed',
    ]);
    expect(images.length).toBe(2);
    img = last(images);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);

    assertLog(['actualLoadSpy [b]', 'onLoadSpy [b]']);
    // 同步b抢占之后，先前过渡队列仍要重基完成；srcAlt优先，追加一轮仍输出b。
    await waitForAll(['YieldingWithImage', 'Img b', 'Yield', 'b', 'Committed']);
  });

  /** 恢复原生src descriptor，预commit记录property绝对URL/attribute相对值，提交后分别同各自旧值，验证commitMount重触发加载不把attribute改成已规范化property；未断言property等于attribute。 */
  it('preserves the src property / attribute when triggering a potential new load event', async () => {
    // 该测试覆盖 https://github.com/mui/material-ui/pull/31263 发现的回归：重置 src 属性曾导致其值
    // 从相对地址变为完整地址。

    // 确保我们没有使用 patched src setter
    Object.defineProperty(
      HTMLImageElement.prototype,
      'src',
      originalHTMLImageElementSrcDescriptor,
    );

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img onLoad={onLoadSpy} />
          <Yield />
          <Text text={'a'} />
        </PhaseMarkers>,
      ),
    );

    // 渲染并 yield，以在提交前捕获 img 的 src attribute 与 property 状态。
    await waitFor(['render start', 'Img default', 'Yield']);
    const img = last(images);
    const renderSrcProperty = img.src;
    const renderSrcAttr = img.getAttribute('src');

    // 完成渲染并提交，导致 `src` 属性被重写
    await waitForAll(['a', 'last layout', 'last passive']);
    const commitSrcProperty = img.src;
    const commitSrcAttr = img.getAttribute('src');

    // 分别比较提交前后property和attribute；相对attribute可与绝对property不同。
    expect(renderSrcProperty).toBe(commitSrcProperty);
    expect(renderSrcAttr).toBe(commitSrcAttr);
  });

  /** Blob作为Img.src，在patched setter下文本为[object Blob]；预commit手动load仅原生，提交重写src后再手动load才合成，验证该输入形状的挂载时序，不测data URL/Blob读取。 */
  it('captures the load event for Blob sources if it happens before commit phase', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const blob = new Blob();

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img src={blob} onLoad={onLoadSpy} />
          <Yield />
          <Text text={'a'} />
        </PhaseMarkers>,
      ),
    );

    await waitFor(['render start', 'Img [object Blob]', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog([
      'actualLoadSpy [[object Blob]]',
      // 由于尚未完成渲染，onLoadSpy 尚未被调用。
    ]);
    await waitForAll(['a', 'load triggered', 'last layout', 'last passive']);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    assertLog([
      'actualLoadSpy [[object Blob]]', // 浏览器重新加载图像会使这里再次 yield。
      'onLoadSpy [[object Blob]]',
    ]);
    expect(onLoadSpy).toHaveBeenCalled();
  });

  /** Blob输入同patch环境，layout后passive前手动load；原生与合成一次、passive后needsDispatch=false，验证已提交Blob输入目标派发。 */
  it('captures the load event for Blob sources if it happens after commit phase and replays it', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const blob = new Blob();

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img src={blob} onLoad={onLoadSpy} />
        </PhaseMarkers>,
      ),
    );

    await waitFor([
      'render start',
      'Img [object Blob]',
      'load triggered',
      'last layout',
    ]);
    Scheduler.unstable_requestPaint();
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [[object Blob]]', 'onLoadSpy [[object Blob]]']);
    await waitForAll(['last passive']);
    expect(img.__needsDispatch).toBe(false);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });
});
