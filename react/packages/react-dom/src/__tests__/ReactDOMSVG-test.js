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
let ReactDOMClient;
let ReactDOMServer;
let act;

describe('ReactDOMSVG', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
  });

  /** 字符串 SSR 输出 svg/image 的 xlinkHref URL；markup应含 xlink:href，验证React prop名称映射为带XML前缀的属性。 */
  it('creates initial namespaced markup', () => {
    const markup = ReactDOMServer.renderToString(
      <svg>
        <image xlinkHref="http://i.imgur.com/w7GCRPb.png" />
      </svg>,
    );
    expect(markup).toContain('xlink:href="http://i.imgur.com/w7GCRPb.png"');
  });

  /** 首次创建多层 svg/g/image/foreignObject，foreignObject 内同时嵌套 svg与HTML div，外部另有HTML p/div；断言各节点 namespaceURI、大小写tagName、stroke-width及 xlink命名空间值，验证命名空间沿上下文进入SVG并在foreignObject子级退出。 */
  it('creates elements with SVG namespace inside SVG tag during mount', async () => {
    const node = document.createElement('div');
    let div,
      div2,
      div3,
      foreignObject,
      foreignObject2,
      g,
      image,
      image2,
      image3,
      p,
      svg,
      svg2,
      svg3,
      svg4;
    const root = ReactDOMClient.createRoot(node);
    await act(() => {
      root.render(
        <div>
          <svg ref={el => (svg = el)}>
            <g ref={el => (g = el)} strokeWidth="5">
              <svg ref={el => (svg2 = el)}>
                <foreignObject ref={el => (foreignObject = el)}>
                  <svg ref={el => (svg3 = el)}>
                    <svg ref={el => (svg4 = el)} />
                    <image
                      ref={el => (image = el)}
                      xlinkHref="http://i.imgur.com/w7GCRPb.png"
                    />
                  </svg>
                  <div ref={el => (div = el)} />
                </foreignObject>
              </svg>
              <image
                ref={el => (image2 = el)}
                xlinkHref="http://i.imgur.com/w7GCRPb.png"
              />
              <foreignObject ref={el => (foreignObject2 = el)}>
                <div ref={el => (div2 = el)} />
              </foreignObject>
            </g>
          </svg>
          <p ref={el => (p = el)}>
            <svg>
              <image
                ref={el => (image3 = el)}
                xlinkHref="http://i.imgur.com/w7GCRPb.png"
              />
            </svg>
          </p>
          <div ref={el => (div3 = el)} />
        </div>,
      );
    });
    [svg, svg2, svg3, svg4].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      // 标签名称是大小写敏感的。
      expect(el.tagName).toBe('svg');
    });
    expect(g.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(g.tagName).toBe('g');
    expect(g.getAttribute('stroke-width')).toBe('5');
    expect(p.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    // 浏览器会将标签名大写。
    expect(p.tagName).toBe('P');
    [image, image2, image3].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.tagName).toBe('image');
      expect(el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(
        'http://i.imgur.com/w7GCRPb.png',
      );
    });
    [foreignObject, foreignObject2].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.tagName).toBe('foreignObject');
    });
    [div, div2, div3].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      expect(el.tagName).toBe('DIV');
    });
  });

  /** svg 内 App初始返回null，再setState(step=1)插入SVG/foreignObject与HTML混合子树；与首次挂载相同命名空间/属性断言应成立，验证更新新增节点仍继承现有宿主上下文。 */
  it('creates elements with SVG namespace inside SVG tag during update', async () => {
    let inst,
      div,
      div2,
      foreignObject,
      foreignObject2,
      g,
      image,
      image2,
      svg,
      svg2,
      svg3,
      svg4;

    /** 在既有svg父级下分两轮输出：step=0为空，step=1创建混合命名空间子树，供更新创建路径测量。 */
    class App extends React.Component {
      /** step初始为0，让根先提交空子树，再经setState插入SVG内容。 */
      state = {step: 0};

      /** 暴露当前实例给外部setState；step=0返回null，其后返回含foreignObject与HTMLdiv的g，以检测跨命名空间新增节点。 */
      render() {
        inst = this;
        const {step} = this.state;
        if (step === 0) {
          return null;
        }
        return (
          <g ref={el => (g = el)} strokeWidth="5">
            <svg ref={el => (svg2 = el)}>
              <foreignObject ref={el => (foreignObject = el)}>
                <svg ref={el => (svg3 = el)}>
                  <svg ref={el => (svg4 = el)} />
                  <image
                    ref={el => (image = el)}
                    xlinkHref="http://i.imgur.com/w7GCRPb.png"
                  />
                </svg>
                <div ref={el => (div = el)} />
              </foreignObject>
            </svg>
            <image
              ref={el => (image2 = el)}
              xlinkHref="http://i.imgur.com/w7GCRPb.png"
            />
            <foreignObject ref={el => (foreignObject2 = el)}>
              <div ref={el => (div2 = el)} />
            </foreignObject>
          </g>
        );
      }
    }

    const node = document.createElement('div');
    const root = ReactDOMClient.createRoot(node);
    await act(() => {
      root.render(
        <svg ref={el => (svg = el)}>
          <App />
        </svg>,
      );
    });
    await act(() => {
      inst.setState({step: 1});
    });

    [svg, svg2, svg3, svg4].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      // 标签名称是大小写敏感的。
      expect(el.tagName).toBe('svg');
    });
    expect(g.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(g.tagName).toBe('g');
    expect(g.getAttribute('stroke-width')).toBe('5');
    [image, image2].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.tagName).toBe('image');
      expect(el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(
        'http://i.imgur.com/w7GCRPb.png',
      );
    });
    [foreignObject, foreignObject2].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.tagName).toBe('foreignObject');
    });
    [div, div2].forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      // 浏览器会将标签名大写。
      expect(el.tagName).toBe('DIV');
    });
  });

  /** 手工创建SVG命名空间的svg/g作为根容器，再createRoot渲染image；新image仍为SVG且tagName小写，验证根上下文来自容器而非React祖先。 */
  it('can render SVG into a non-React SVG tree', async () => {
    const outerSVGRoot = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg',
    );
    const container = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g',
    );
    outerSVGRoot.appendChild(container);
    let image;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<image ref={el => (image = el)} />);
    });
    expect(image.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(image.tagName).toBe('image');
  });

  /** 手工创建SVG foreignObject容器，再渲染div；新div应为HTML命名空间且tagName大写，验证foreignObject根容器对子级切换到HTML。 */
  it('can render HTML into a foreignObject in non-React SVG tree', async () => {
    const outerSVGRoot = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg',
    );
    const container = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'foreignObject',
    );
    outerSVGRoot.appendChild(container);
    let div;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div ref={el => (div = el)} />);
    });
    expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(div.tagName).toBe('DIV');
  });
});
