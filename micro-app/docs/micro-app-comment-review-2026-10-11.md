# micro-app 注释与测试场景复审（2026-10-11）

版本：`@micro-zoe/micro-app@1.0.0-rc.32`。基线是本轮编辑前的共享工作区快照，所在 main 的提交为 `3c0d7e3bb22c02e9d136b1627b119ea857b9bb9d`；不以HEAD替换已有改动。

本轮完整复审42个源码TS、32个测试/辅助TS与56个fixture，共130个src文件。实际仅加深37个源码与32个测试/辅助文件的解释性注释，新增本报告及同名JSON；两个HTML文章及56个fixture保持原字节。主智能体加两名子智能体，最多3个同时工作。

## 声明与场景覆盖

| 项目 | 数量与结果 |
|---|---|
| 主声明清单 | 1037：1011已说明，26 fixture逐项豁免 |
| 补充清单 | 136：125已说明，11 fixture逐项豁免 |
| 合计 | 1173；1136非fixture已说明，37 fixture豁免；未归类和注释缺口均0 |
| 测试定义 | 24文件、162用例，全部紧邻中文场景，含3个skip |
| 测试发现边界 | 默认选择7文件78定义（3个skip，75个非skip）；另17文件84定义未入testMatch |
| 其他形态 | todo/each/循环生成定义均0；历史注释掉的test为1，单列而未算入162 |

声明分类：已有且充分 920；已翻译扩写 155；豁免 37；新补充 61。测试场景：已翻译扩写 132；新补充 30。

[逐文件、逐声明、逐用例清单及校验数据](micro-app-comment-review-2026-10-11.json) 保留每项ID、位置、分类、具体说明/复核依据、fixture消费角色、runner状态及原断言。已有注释逐项复读其实现，再决定保留或扩写；结构存在不作为机制准确的证明。

## 本次加深的机制

- 生命周期：两路准备不等于脚本执行完成；ready/active分离，UMD配对setter可中途收尾；mount/unmount等待、同步抛错、catch范围、DOM转存与事件先后均按当前实现解释。
- 隔离与清理：当前bundle计数/缓存边界、Proxy所有权与描述符、iframe realm、快照记录/恢复、未保存原target/capture时的监听释放边界、worker/EventSource/timer去向。keep-alive不调用stop，不能写成所有副作用已停止。
- 资源：静态与动态资源路径、CSS基址变化与控制状态、原节点/替代节点、URL/属性补丁、重复缓存未记录pending请求、fiber与async/defer/module调度及失败出口。
- 通信与路由：EventCenter待提交数据和重入的旧/新批次、autoTrigger同步回放、浅比较与clearData不取消待提交；宿主返回事件过滤、延迟任务读取当前地址且不自动取消。
- 测试：每例明确初始输入、操作与实际断言目标；共享前序实例、没有断言、未await、旧入口/导出形态及测试标题与真实路径不一致均如实说明。

## 逐文件内容复核

| 文件 | 结果 | 内容结论 |
|---|---|---|
| src/__tests__/common/initial.ts | 已翻译扩写 | 复读server参数与每个setup/清理函数；补端口共享模块、网络未await、mock窗口、宿主CSS/绑定函数观察点、200ms清理不等待异步卸载及Map不清空。 |
| src/__tests__/common/set_ssr_env.ts | 已翻译扩写 | 复核window缺失必须发生在utils导入前，使isBrowser常量为假；不夸大为服务端DOM渲染。 |
| src/__tests__/common/util.ts | 已翻译扩写 | 核对定时器等待与resolve(cb())行为；解释只跨一轮任务，Promise返回值被采纳，而回调同步throw在timer里不自动拒绝外层Promise。 |
| src/__tests__/create_app.test.ts | 已翻译扩写 | 十一例逐正文核对加载中卸载与复用、立即append/remove代次失效、同步与微任务自卸载、旧umd3导出未捕获、七类unmountApp断言和未await的getActiveApps收尾。 |
| src/__tests__/interact/index.test.ts | 已翻译扩写 | 5个场景逐段核对注册/回放/等待/解绑/缓存/DOM数据事件/快照/非法名称；扩写nextFrame只跨已有批次、原AutoTrigger名与参数不同、未等待同值更新只匹配旧记录。默认Jest选中。 |
| src/__tests__/interact/lifecycles_event.test.ts | 已翻译扩写 | 完整1场景及setup/清理，common mounted回调只验证宿主target/currentTarget；默认未选中。 |
| src/__tests__/main.test.ts | 已翻译扩写 | 六例逐正文核对初始共享实例、data、属性切换、HTML错误、UMD与无沙箱重挂载；修活跃状态不是只在mounted之间、setAttribute第三参不执行、mock曾调用不证明恢复次数、插件模块名称与运行应用不对应。 |
| src/__tests__/micro_app.test.ts | 已翻译扩写 | 八例逐正文核对公开API完成边界与跨例单例状态；reload/卸载Promise未await，重复start使非法tagName与插件归一化未执行。 |
| src/__tests__/micro_app_element.test.ts | 已翻译扩写 | 十七例逐正文核对前例运行/隐藏实例、属性合并、相对abc接受规则、日志旧冒号格式、未命名/SSR字段断言范围与keep-alive双通道；Shadow DOM属性大小写按HTML归一化处理。 |
| src/__tests__/prefetch.test.ts | 已翻译扩写 | 四例未入默认testMatch；核对默认3000ms延迟、旧globalLinks/globalScripts导入不存在、二次start提前返回、所有未等待路径，保留测试正文。 |
| src/__tests__/sandbox/customProxyDocumentProps.test.ts | 已翻译扩写 | 完整复审两场景和配置函数。title 空写入器/onclick 写入器在 proxyDocument 创建时合并，正文操作宿主 document、setAppName 不换接收者。旧标题不变/onclick 返回配置函数断言与当前路径不符；两 case 共用容器且无逐例清理。默认 runner 不发现，保持原逻辑。 |
| src/__tests__/sandbox/effect.test.ts | 已翻译扩写 | 完整复审 5 场景与 common/ssr-render/umd1/umd2/umd4 fixture。mounted/实例数只证明等待目标，不证明卸载监听去除。UMD2 library 旧名不捕获，boundFunc 测试正文宿主普通函数，无绑定缓存断言；UMD4 mount 未捕获则 .container 无创建路径。fixture 字节未改。默认 runner 不发现本套件。 |
| src/__tests__/sandbox/effect2.test.ts | 已翻译扩写 | 完整复审唯一场景及 setup。宿主 onclick 锁为不可配置后 common fixture 使用独立 proxy onclick，mounted/size 断言验证挂载可完成；没有 click 次数或重定义失败断言。默认 Jest 不发现；未加执行或断言。 |
| src/__tests__/sandbox/index.test.ts | 已翻译扩写 | 完整复审 17 场景和宿主字段/helper。文件是旧 Sandbox 入口/参数协议，当前入口已不存在且默认 Jest 不发现。各用例共享宿主变更和插件，场景头具体写输入、步骤、断言与边界；scope/descriptor/escape 多组断言分段说明。active 写入屏蔽、location 字段不存在等旧断言不能当作 rc.32 实证。 |
| src/__tests__/source/index.test.ts | 已翻译扩写 | 完整6场景与插件setup，排除、txt入口、缺head/body、静态img-only补址、空响应、HTML插件结果均解释。首例脚本数3旧断言实际应是2；补两个excludeChecker TSDoc。默认未选中。 |
| src/__tests__/source/links.test.ts | 已翻译扩写 | 完整6场景与fetch helper，分别写动态错误/关系移除/静态失败结算/共享缓存/不完整分支/旧五参调用；globalLinks和Map.get已不兼容，未等待事件处明确。默认未选中。 |
| src/__tests__/source/load_event.test.ts | 已翻译扩写 | 完整2场景，区分属性回调/DOM监听与原link目标、Promise在mounted结束未等待资源通知；补onerror函数TSDoc。默认未选中。 |
| src/__tests__/source/patch.test.ts | 已翻译扩写 | 完整3场景与全部复杂断言块，反复作用域/容器/inline切换、查询旁路、资源映射与空容器删除准确。未插入四资源不能证排除；合法$输入与CSS异常回退范围明确；补插件谓词说明。默认未选中。 |
| src/__tests__/source/scoped_css.test.ts | 已翻译扩写 | 完整12场景含3个skip，逐个输入与逐字/摘要预期核对，styled定时断言不纳入等待、Firefox ASCII不证性能、skip旧CSSOM/旧link属性/缺冒号错误边界明确；helper说明完整字节/Promise失败。默认选中。 |
| src/__tests__/source/scripts.test.ts | 已翻译扩写 | 完整14场景与loader插件/setup，区分立即内联执行/下载异常/缓存微任务/native模块/重挂载；旧globalScripts导出、Map.get和旧异常通知预期不兼容，等待边界逐案说明，补四事件函数TSDoc。默认未选中。 |
| src/__tests__/source/scripts2.test.ts | 已翻译扩写 | 完整2场景，support_module只模拟属性检测、DOMParser不会走setter；默认With module当普通包装脚本可mounted，禁用沙箱原生module JSDOM不执行且没load断言。修旧mounted误说。默认未选中。 |
| src/__tests__/source/support_module.ts | 已翻译扩写 | 完整读取两个原生引用与两个赋值函数。补桩仅影响显式createElement/setAttribute、精确noModule字段、静态HTML差异，配对恢复由scripts2 afterAll执行。 |
| src/__tests__/ssr_env.test.ts | 已翻译扩写 | 两例未入默认testMatch；核对导入前window缺失、preFetch门禁和start错误、initGlobalEnv静默跳过。 |
| src/__tests__/unit/additional_util.test.ts | 已翻译扩写 | 完整2案，describe时环境标记未置故没注册监听，第二案从未调用release，按真实初始条件说明旧期望不足。默认未选中。 |
| src/__tests__/unit/event_center.test.ts | 已翻译扩写 | 完整7案，所有合法两参dispatch漏nextStep且同步断言早于通知；首次数据同步可读，content输入实际undefined、autoTrigger不立即回放分别解释。文件级写统一接口差异和后续微任务异常。默认未选中。 |
| src/__tests__/unit/lifecycles_event.test.ts | 已翻译扩写 | 完整4案，旧字符串首参/宿主window、空容器warn、非枚举mount但DOM仍同步派发、旧lifeCycles属性不生效逐场说明。默认未选中。 |
| src/__tests__/unit/mocks/app.ts | 已翻译扩写 | 完整3常量，普通fetch入口/.js特判入口/未引用第二地址的角色明确。 |
| src/__tests__/unit/mocks/event.ts | 已翻译扩写 | 完整2常量，合法事件名与仅data字段对象；非法数据用例读content得到undefined。 |
| src/__tests__/unit/mocks/fetch.ts | 已翻译扩写 | 完整setupMockFetch与fetchStub/text补充声明，固定内容重复提供、不检查真实网络或请求URL、Promise响应但text返回同步原文明确。 |
| src/__tests__/unit/mocks/html.ts | 已翻译扩写 | 完整两个模板字面量，输入四种脚本与格式化职责、旧预期少远程脚本明确；字面量内容逐字不变，只扩写常量前TSDoc。 |
| src/__tests__/unit/source/loader/html.test.ts | 已翻译扩写 | 完整6案与setup，普通输出旧fixture删脚本、空响应vs网络错误、.js入口合成不抓取、旧plugins属性及三参数均逐案说明；waitFor仅下一任务，mock不执行真实CreateApp传播。默认未选中。 |
| src/__tests__/unit/utils.test.ts | 已翻译扩写 | 完整19案及timer断言，日志形态、当前URL相对地址、Promise顺序/索引、特性/随机长度正例限制、idle导入时选择、作用域/UA/守卫输入均说明。默认选中。 |
| src/app_manager.ts | 已翻译扩写 | 核对Map代理而非独立存储、当前bundle单例、getAll浅快照和clear只删索引；加深嵌套异步清理边界。 |
| src/constants.ts | 已翻译扩写 | 核对状态与生命周期调用位置；修准UMD配对setter可早于后续脚本完成、error事件并非所有脚本日志自动转发。字段与模式常量按实际消费者说明。 |
| src/create_app.ts | 已翻译扩写 | 完整复读构造、两路资源屏障、ready、配对UMD捕获、mount/unmount Promise、keep-alive、容器转移与销毁。补原始目标未保存的监听释放边界、同步抛错不清理、catch覆盖收尾异常、缓存与NodeList空数组差异。 |
| src/index.ts | 已有且充分 | 逐项核对入口导出仍对应当前模块；既有说明已准确表达门面、预取、DOM作用域工具与子应用通信入口，保留。 |
| src/interact/event_center.ts | 已翻译扩写 | 逐字段及on/off/dispatch/process/浅比较核对，解释首次同步data与后续tempData、强制通知、活Set遍历、queue/步骤表切换但共享tempData、跨通道重入重复通知及必需nextStep边界；不误称队列持有快照。 |
| src/interact/index.ts | 已翻译扩写 | 复读全局/基座/子应用各方向适配、DOM datachange及监听归属，扩写改名仅迁移eventList、标记写入早于回调校验、快照只持函数引用与同步回放/异常中断、reset不解绑。 |
| src/interact/lifecycles_event.ts | 已有且充分 | 逐声明核对事件字段getter、ShadowRoot host、全局钩子先于DOM事件及其同步异常、With事件名改写与iframe原名、未创建沙箱旁路；既有中文说明充分。 |
| src/libs/global_env.ts | 已翻译扩写 | 逐项核对接口字段用途与当前源码未使用的预留字段；捕获的是此刻原型引用并非保证完全原生，activeSandbox属于当前bundle且keep-alive隐藏不递减。 |
| src/libs/nest_app.ts | 已翻译扩写 | 核对上层unmount监听、当前bundle实例快照、直接调用宿主disconnectedCallback触发隐藏/卸载、随后clear仅删索引且不等待异步钩子；加深父子bundle边界。 |
| src/libs/utils.ts | 已翻译扩写 | 逐个守卫与常量核对类型边界，复读URL/查询编码/作用域/throttle/记录器/idle/fiber/event格式化。修 isUniqueElement 的真实DOM消费者，扩写URL基址与名称清洗次序、defer不可等待、promiseStream回调抛错、idle Promise pending及串行停顿；薄守卫保留简洁说明。 |
| src/micro_app.ts | 已翻译扩写 | 核对公开API的注册/活跃筛选、三类卸载及临时属性恢复、串行快照、reload数据与pending路径、renderApp事件监听及start一次初始化；按实际成功/失败边界扩写。 |
| src/micro_app_element.ts | 已翻译扩写 | 完整复读连接代次、最终属性读取、五类复用/替换、数据通道迁移和SSR旧配置。补连接Map不删除旧条目、reload不续接的pending边界、浅复制含不可枚举字符串而不含Symbol、恢复事件先于DOM移动。 |
| src/polyfill/jsx-custom-event.ts | 已翻译扩写 | 核对浅复制props与ref转发顺序、函数引用绑定、缓存键/小写事件名差异、省略prop保留旧监听、null对象ref边界和实际返回React元素。 |
| src/prefetch.ts | 已翻译扩写 | 核对惰性配置、空闲延时、reduce未返回等待句柄、原地规范化、首次onLoad即放行下一项、包装回调先resolve再调原方法、重复全局资源可多次发请求而缓存写入去重。 |
| src/proxies/worker.ts | 已翻译扩写 | 通读同源识别、Blob 脚本、代理构造与按应用终止。归属取构造时当前作用域；构造失败不登记，普通停止/destroy 终止已登记 worker，业务自行 terminate 不删表；模块未 revoke Blob URL。 |
| src/sandbox/adapter.ts | 已翻译扩写 | 通读共享基类、字段与 DOM 标记路径。ready 只表示初始化；scope/escape 集合按运行期归属清理。后序遍历与单节点标记分开，iframe 实例上的 ownerDocument/baseURI/root/parent 视图使用当前沙箱；React hook 只在当前同步片段临时切换。 |
| src/sandbox/bind_function.ts | 已翻译扩写 | 通读两个启发式识别器和绑定器。构造器/bound/无 bind 的 Safari 对象保持原引用；分类及绑定缓存写在原函数上、按类别而非接收者身份复用，stop 不清缓存。复制属性与 prototype 并不重新构造原函数。 |
| src/sandbox/iframe/document.ts | 已翻译扩写 | 通读 Document 原型、属性桥、结构视图与全部事件钩子。scope 事件依调用文档，其他转宿主；记录仅回调且函数第一次 this 绑定被缓存，独立 Document 后续释放/恢复仍用主 microDocument，原文档绑定可能保留。body 查询取构造时 options.container；onclick 单独快照，其他宿主 on 赋值不恢复。 |
| src/sandbox/iframe/element.ts | 已翻译扩写 | 逐 Node/Element 原型赋值和属性访问器检查。纯节点维持 iframe realm，普通节点交宿主补丁；混合 append/prepend 批次按含纯节点整体选择。cloneNode 仅标返回根，深层静态树由 patchElementTree 处理。资源 setter 白名单四项，srcset 以整段 CompletionPath 处理，不逐候选拆解。 |
| src/sandbox/iframe/index.ts | 已翻译扩写 | 逐字段/方法核对 realm 初始化与生命周期。ready 等文档重建但无 reject/取消，删除 iframe 不终止已排轮询；Jest 跳过身份变化等待。start 不 await ready，需上游约束，active 与共享/类型计数分开。每次启用 base 重新创建、UMD 保留旧 base，仅最新引用更新；普通停止/destroy 删除 iframe 与 worker，UMD 保留原生 timer。options.container 保存构造输入不随应用迁移。 |
| src/sandbox/iframe/router.ts | 已翻译扩写 | 通读 iframe 原始 replaceState 保存与路由补丁合并。真实 location 留在宿主同源，代理 origin 按模式呈现；href 对真实 realm 的视图与内部 microLocation 不能混作宿主路径。历史门面仅覆盖工厂返回的方法。 |
| src/sandbox/iframe/special_key.ts | 已翻译扩写 | 逐常量核对实际引用。构造器排除表、静态/正则宿主桥接、结构唯一元素及 Document 属性/方法各有边界；正则桥接还要求 iframe 有该 own key、parent 有同名成员，不等价任意宿主全局逃逸。 |
| src/sandbox/iframe/window.ts | 已翻译扩写 | 通读静态宿主桥接、instanceof、显式 window Proxy 与监听快照。module/裸全局使用真实 iframe，不必经过 Proxy；自定义键集合只记录 Proxy 新键，删除不清标记。插件 getter nullish 与 Proxy falsy 回退有差异；普通 on 属性写宿主且不还原。事件当前配置动态选目标，记录不存原目标/capture。 |
| src/sandbox/request.ts | 已翻译扩写 | 逐声明核对 fetch、XHR 和 EventSource。字符串/URL 形输入相对入口补全，Request 保持原对象；调用底层前退 DOM scope，无响应缓存或取消协议。EventSource 集合按 appName 管理、close 后才删记录，异常无重试且空 Set 保留。microFetch return 后同行直接 TSDoc 不改变 ASI。 |
| src/sandbox/router/api.ts | 已翻译扩写 | 通读单例闭包、导航、守卫、附加、默认页和基座路由代理。公共导航活动筛选只在 ready.then 前发生，续接不复查；返回 Promise 不等 search 宏任务通知。守卫是提交后的通知，before 同步、after idle 且不取消；默认页旧注销按键删除新值，base router 方法绑定缓存保证稳定引用。 |
| src/sandbox/router/core.ts | 已翻译扩写 | 逐 state、编解码和五类模式判定核对。set 浅合并，remove 会改传入内部 namespace，get 业务 state 的假值归 null。search hash 段优先同名 query 段，非字符串解析值无效；模式初始化兼容内联/全局旧 disable-memory-router。isEffectiveApp 不判断 active/MOUNTED，调用者另筛选。 |
| src/sandbox/router/event.ts | 已翻译扩写 | 逐事件方向与异步过滤重审。宿主 popstate 接收时过滤可见/非预渲染和 onlyForBrowser，宏任务执行时读取当时路径；移除监听不取消任务，更新函数只检查仍有沙箱。子 popstate/hashchange 保留标准名称，with 另手调 on 属性；throw 可阻断尾部 scope 清理。 |
| src/sandbox/router/history.ts | 已翻译扩写 | 逐方法核对子/宿主 History 协作。URL 只取路径，业务 state 按应用命名空间，onlyForBrowser 控制 search 合成 popstate 回流；有效性仅存在且非预加载。宿主补丁同地址合并旧快照，随后修复活动记录；共享计数门禁在沙箱层。恢复宿主函数不使缓存包装引用失效，写入异常不回滚也无 finally 清 scope。 |
| src/sandbox/router/index.ts | 已翻译扩写 | 通读成对路由创建、初始化、清理和 keepalive 路由附加。浏览器已有路径优先默认页，pure 仅内部恢复；keepRouteState 保留内部地址而不保宿主记录。重新显示初始化写入业务 state=null，位置保留并不恢复旧业务 state；current 在所有停止模式删除。 |
| src/sandbox/router/location.ts | 已翻译扩写 | 通读代理全部地址读写、真实目标和守卫快照。with URL 引用稳定，iframe location 每次动态读取；native origin 呈宿主。location 整体/字段赋值按路由模式保持 hash 特例与 reload 语义，不能概括成所有同域跳转纯内存。assign/replace 有效性弱于公共 router API；错误不回滚，守卫 after commit。 |
| src/sandbox/scoped_css.ts | 已翻译扩写 | 逐字段/规则匹配器/生成匹配器/observer/前缀函数核对。明确baseURI持久迁移、全局/精确列表disable差异、每个注释清next-line且列表累加、root先于body/函数逗号限制、嵌套块仅消费、printError耗尽输入边界；完整CSS输入输出均验证。 |
| src/sandbox/with/document.ts | 已翻译扩写 | 通读文档创建、独立 onclick、事件快照、配置写入器和 MicroDocument。原型共享宿主，普通文档属性写宿主；custom Map 创建时合并、同名覆盖 setter 但不改变 getter。监听记录不区分 capture，release 仅 false 捕获；独立 onclick 与宿主 onclick 分离，函数不预绑定。 |
| src/sandbox/with/index.ts | 已翻译扩写 | 通读数据类型、构造、ready/start/stop、插件、请求/路由和 UMD 捕获。with 目标为独立 microAppWindow，代理只是部分访问门面；全局 activeSandbox 控制共享补丁，With.activeCount 只控本类型嵌套环境。active 在路由初始化前置真，同步错误不回滚；UMD 软卸载保留全局/定时器，普通停止销毁定向集合。stop 移监听但不取消已排路由宏任务。 |
| src/sandbox/with/window.ts | 已翻译扩写 | 逐 Proxy trap 与事件/timer 钩子重审。active 不限制 get/set；descriptor 来源缓存决定 defineProperty 目标且不走普通注入登记。监听 Map 仅 type/callback，options 放回调上；移除未匹配 capture 或容器迁移时可留下旧绑定，release 清表不能证明原目标已解绑。恢复选当前容器，timer 只按模式终止，不进事件快照。 |
| src/source/fetch.ts | 已有且充分 | 逐声明核对options.fetch传参、默认fetch.text及应用名；它返回请求Promise，不本地缓存/吞错误，入口与静态动态资源调用分担错误处理。既有说明充分。 |
| src/source/index.ts | 已有且充分 | 逐声明核对HTML层flat递归、排除优先级、静态图片补址、style队列和两资源链onLoad。CSS/JS加载可并行，fiber样式写入等内联队列；已有说明与CreateApp调用链一致。 |
| src/source/links.ts | 已翻译扩写 | 逐提取/缓存/转换/动态通知函数与回调结构字段核对。attrs首份保留、placeholder末份及单次消费、code/appSpace分层、parsedCode只检查非空而不按配置失效、缓存微任务无catch与空文本重抓明确。 |
| src/source/load_event.ts | 已有且充分 | 逐事件字段getter与两种load/error派发核对。属性回调优先于DOM监听且二选一，目标保持原资源元素、属性回调this绑定原节点；已有说明充分。 |
| src/source/loader/html.ts | 已翻译扩写 | 逐单例/契约/run/格式化/插件链核对，扩写ssrUrl优先、JS pathname入口不抓HTML、自定义fetch同步抛错不在链内，保留空HTML onerror与请求/插件异常onLoadError的真实区别。 |
| src/source/patch.ts | 已翻译扩写 | 完整复读资源替代WeakMap、原型转发/实际父节点映射、补址、节点标记/clone/innerHTML、Document查询及释放。新增get标记TSDoc，修释放遗漏insertAdjacentElement，解释srcset整段补址和动态内联代码可先执行再不插入。 |
| src/source/scripts.ts | 已翻译扩写 | 逐模式谓词/提取/插件/cache/appSpace/预取/执行/动态/native模块/作用域包装核对。补execScripts扫描即fetch、同步继续/fiber整批后启动、缓存值可同步结算。native外链load与内联defer计数、error不减模块数、Function缓存可达前提及raw microAppWindow with均保留准确。 |
| src/source/source_center.ts | 已翻译扩写 | 逐接口字段/薄处理器/Map闭包与内联清理核对。远程code与appSpace跨应用共享且无inflight去重；deleteInlineInfo只删缓存nonce、不修改输入Set、不清远程appSpace，生命周期明确。 |

## 保留的历史测试缺口

这些是原测试与本版本的既有差异，本轮只补解释，保留名称、断言和执行逻辑。没有用“分支覆盖”标题或等待mounted替代断言证据。

| 文件 | 既有边界 |
|---|---|
| src/__tests__/micro_app_element.test.ts | 冲突日志保留旧冒号格式，非法名称日志旧预期使用原输入；abc在HTTP宿主下是合法相对地址，相关旧断言不符。 |
| src/__tests__/create_app.test.ts | umd3导出不被当前命名规则捕获，Promise/抛错标题不能证明钩子分支；不存在名称警告旧完整文本也不符。 |
| src/__tests__/micro_app.test.ts | 部分reload/卸载Promise未return或await；重复start先返回，非法tagName与插件归一化并未执行。 |
| src/__tests__/prefetch.test.ts | 旧globalLinks/globalScripts导入不存在；100ms早于默认空闲后3000ms，没有等待或断言预取结果。 |
| src/__tests__/main.test.ts | setAttribute的第三个回调未被当前实现接收；UMD事件“曾调用”mock断言不检查两次挂载间的新通知次数。 |
| src/__tests__/source/index.test.ts | 首例scripts.size=3与当前fixture/插件Set去重后2不符。 |
| src/__tests__/source/links.test.ts | globalLinks/app.source.links.get及fetchLinkSuccess旧五参不兼容。 |
| src/__tests__/source/scripts.test.ts | globalScripts/app.source.scripts.get、执行抛错后load/mounted旧预期不兼容。 |
| src/__tests__/unit/event_center.test.ts | 漏传nextStep且同步回调断言，微任务会抛错；非法content是undefined。 |
| src/__tests__/unit/source/loader/html.test.ts | 旧成功HTML省脚本、旧plugins属性/三参、.js入口预期不符。 |
| src/__tests__/unit/additional_util.test.ts | 初始化早于环境标记，第二案未调用释放。 |
| src/__tests__/unit/lifecycles_event.test.ts | 旧字符串应用参数/console.error/直接lifeCycles属性不符。 |
| src/__tests__/unit/utils.test.ts | formatAppURL旧补尾斜杠/拒绝abc预期不符。 |
| src/__tests__/demos/umd2/index.js | 旧library导出形态与当前窗口配对捕获不符，fixture只读。 |
| src/__tests__/demos/umd3/index.js | 旧library可能未进入各钩子模式，不能将历史标题当运行证据。 |
| src/__tests__/demos/umd4/index.js | 当前mount捕获可能未执行，不能由root ownerDocument自动证明动态container存在。 |
| src/__tests__/sandbox/** | 默认 Jest testMatch 排除全部四个沙箱套件；本轮不执行旧接口用例，也不改 runner/fixture。 |
| src/__tests__/sandbox/** | index.test.ts 导入的 ../../sandbox 当前不存在；部分旧 start/stop 与 active/location 断言不对应 rc.32。 |
| src/__tests__/sandbox/** | umd2/umd4 的旧导出名、宿主 document 自定义写入器断言及跨用例共享容器仍为测试输入缺口，注释明确但逻辑保持不变。 |
| src/__tests__/sandbox/** | 原实现不保存 listener 的完整 target/capture 元组，release 清表不保证旧目标完全解除；按真实实现解释，未改运行语义。 |
| src/__tests__/sandbox/** | microFetch 同行直接 TSDoc 由 supplemental scanner 当作 trailing，报告逐项人工确认；不为工具覆盖改变 return/function 代码或换行语义。 |

## fixture角色与只读审查

54个普通fixture完整读取原文并对照消费者；两个large CSS文件使用完整CSSParser转换、全量规则与特殊语法分类、完整输出逐字对照，不声称每一行均做人工朗读。large和nesting的实际完整输出均与现有预期一致；未改任何响应字节。

| fixture | 消费场景/角色 |
|---|---|
| src/__tests__/demos/common/async.js | 零字节async请求响应，由common/index.html登记；框架将async留在执行阶段，空code仍参与结算。 |
| src/__tests__/demos/common/defer.js | 输出my defer的defer资源，由common/index和onlydefer入口使用，体现执行批次的可观察顺序。 |
| src/__tests__/demos/common/global.js | 打印当前应用名的远程脚本，由common与element-config登记；global属性是旧缓存标记，当前所有远程地址共享缓存。 |
| src/__tests__/demos/common/index.html | 常见静态入口：内联style、重复/global/ignore link、预取关系、普通/defer/async/inline/module/nomodule/ignore/JSON脚本和root节点，供多套挂载、沙箱、资源测试。 |
| src/__tests__/demos/common/large.css | 331,788字节完整Semantic UI与at-rule输入；source/scoped_css的large用例动态插入并全量摘要比较。 |
| src/__tests__/demos/common/large.scoped.css | 421,120字节large输入的完整预期，固定test-app9前缀/9010补址；任何空白或注释改变都影响摘要。 |
| src/__tests__/demos/common/link1.css | 颜色规则与全局:root CSS变量，由common/index、element-config/index.txt及预取配置请求；供样式提取与原生根保留场景。 |
| src/__tests__/demos/common/link2.css | 引用CSS变量的字体规则，common静态及common/ssr脚本动态link共享同地址；验证静态/动态样式复用输入。 |
| src/__tests__/demos/common/module.js | 输出module的外链输入，由common入口与scripts2动态module使用；是否原生module由能力检测和沙箱类型共同决定。 |
| src/__tests__/demos/common/nesting-css.css | 包含空多层规则、注释/字符串花括号、嵌套keyframes的完整输入；source/scoped_css嵌套用例直接抓取。 |
| src/__tests__/demos/common/nesting-css.scoped.css | 嵌套输入完整预期，只给最外层.ui.comments加test-app13前缀，内部作为声明文本保留。 |
| src/__tests__/demos/common/nomodule.js | 输出nomodule的外链输入，由common入口使用，scripts/scripts2比较能力检测与DOMParser桩局限。 |
| src/__tests__/demos/common/script1.js | 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 |
| src/__tests__/demos/common/script2.js | 动态插文本/p元素并创建ignore脚本，脚本内断言raw window注入；由common/script1和动态/关闭沙箱资源测试使用。 |
| src/__tests__/demos/common/script3.js | 静态普通脚本的warn观察点，common/index直接登记。 |
| src/__tests__/demos/dynamic/empty.css | 零字节CSS边界文件，当前测试未找到对此文件的直接引用；服务器可原样提供，不能声称已被用例覆盖。 |
| src/__tests__/demos/dynamic/empty.js | 零字节脚本边界文件，当前测试未找到对此文件的直接引用；保留固定输入，不能声称已被用例覆盖。 |
| src/__tests__/demos/dynamic/errorjs.html | 静态普通脚本指向throw-error，供scripts首次渲染异常的旧mounted预期场景。 |
| src/__tests__/demos/dynamic/index.html | 有head/body但无脚本/样式的最小入口，资源各测试在mounted后手工插动态节点。 |
| src/__tests__/demos/dynamic/link1.css | 零字节动态stylesheet成功响应，由links/load_event动态./link1.css使用，空内容仍可load但不能作为非空缓存命中。 |
| src/__tests__/demos/dynamic/script1.js | 输出dynamic script1的远程代码，scripts重挂载/global动态用例重复请求同地址。 |
| src/__tests__/demos/dynamic/throw-error.js | 同步抛Error的远程代码，动态首次请求的catch/error路径与errorjs静态失败场景共用。 |
| src/__tests__/demos/element-config/index.html | 重复CSS/JS、exclude/global属性、两级插件排除id、相对和根路径地址；index/links/scripts用例消费者。 |
| src/__tests__/demos/element-config/index.txt | 扩展名为txt但结构为HTML的入口，保留一条有效CSS且排除内联style/脚本，source/index验证入口类型不限html。 |
| src/__tests__/demos/element-config/link1.css | 非空普通样式，重复地址只登记一次、共享cache用例的实际内容输入。 |
| src/__tests__/demos/element-config/link2.css | 零字节有效静态CSS响应，element-config入口登记到链接Set；空code不稳定命中非空缓存分支。 |
| src/__tests__/demos/element-config/link3.css | 零字节全局插件排除候选，element-config入口link3后缀使excludeChecker触发而不请求。 |
| src/__tests__/demos/element-config/link4.css | 零字节应用插件排除候选，test-app2的module插件排除；其他未配置应用可登记该地址。 |
| src/__tests__/demos/element-config/script1.js | 零字节exclude脚本候选，静态入口节点移除不登记scripts Set。 |
| src/__tests__/demos/element-config/script2.js | 非空普通外链打印观察点，入口global/重复标记对应同地址Set去重和动态共享代码场景。 |
| src/__tests__/demos/element-config/script3.js | 全局插件按script3后缀排除候选；其他无插件挂载也可求值输出日志。 |
| src/__tests__/demos/element-config/script4.js | test-app2专属插件按script4后缀排除候选，体现静态脚本数与插件配置共同决定。 |
| src/__tests__/demos/special-html/disablesandbox.html | 普通入口只引用common/script2，source/scripts在disableSandbox下查询sandBox=null。 |
| src/__tests__/demos/special-html/empty.html | 真正零字节HTML响应，source/index空加载分支输入；不是空body但有标签的合法HTML。 |
| src/__tests__/demos/special-html/error-deferjs.html | 一个不存在defer地址，source/scripts等待延迟下载失败日志与资源结算。 |
| src/__tests__/demos/special-html/nobody.html | 原文有head而无body；HTMLLoader不会补micro-app-body，extractSourceDom缺容器出口。 |
| src/__tests__/demos/special-html/nohead.html | 原文有body而无head；即使浏览器可补标准head，格式化原文仍无micro-app-head，提取报错。 |
| src/__tests__/demos/special-html/notexist-css.html | 不存在静态CSS，links测试检查错误但仍mounted的单请求失败结算。 |
| src/__tests__/demos/special-html/notexist-js.html | 不存在普通静态JS，scripts测试检查预取失败日志与加载计数出口。 |
| src/__tests__/demos/special-html/notexistdefer.html | 两个不存在defer地址，scripts测试触发延迟批次全部拒绝与errorCount判据。 |
| src/__tests__/demos/special-html/onlydefer.html | 只含一个defer脚本的入口；当前测试正文未找到直接引用，不能将此保留输入算作已验证空同步链的用例。 |
| src/__tests__/demos/special-html/process-html.html | id=app的最小HTML，source/index应用HTML插件改为app-replaced，mounted读取替换结果。 |
| src/__tests__/demos/ssr-render/index.html | root、img/iframe/a资源属性及name/class/id/tag查询标记，index静态补址、patch查询/容器重定向及sandbox效果场景。 |
| src/__tests__/demos/ssr-render/link1.css | 颜色规则/:root变量，ssr入口静态样式；动态脚本另外使用common/link2。 |
| src/__tests__/demos/ssr-render/link2.css | 字体规则保留文件，当前HTML/JS/测试未找到引用，不能称为已被SSR用例消费。 |
| src/__tests__/demos/ssr-render/script1.js | 初始化root、动态common/link2与本目录script2，主动注册/移除document/window事件，给patch和效果测试提供节点/事件输入。 |
| src/__tests__/demos/ssr-render/script2.js | 动态追加文本和p节点，ssr/script1按应用入口补全后请求，支持body插入补丁路径。 |
| src/__tests__/demos/umd1/index.html | 加载index.js与空白script2，main/create_app/effect中当前window.mount/unmount配对捕获的入口。 |
| src/__tests__/demos/umd1/index.js | 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 |
| src/__tests__/demos/umd1/script2.js | 仅一个换行字节的静态脚本；非空空白code与零字节资源不同，入口可继续扫描后续普通执行。 |
| src/__tests__/demos/umd2/index.html | effect旧library场景入口，index.js把钩子写到window[umd-app2]而非当前捕获的window.mount/unmount。 |
| src/__tests__/demos/umd2/index.js | window load登记/移除、passive getter探测与命名对象钩子导出；当前库未读取旧library属性，不能冒称真实UMD钩子被捕获。 |
| src/__tests__/demos/umd3/index.html | create_app旧library/Promise钩子/异常钩子场景入口，脚本按specialUmdMode构建导出对象。 |
| src/__tests__/demos/umd3/index.js | 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 |
| src/__tests__/demos/umd4/index.html | iframe ownerDocument原型检查入口，index.js的命名对象导出与当前捕获契约不一致。 |
| src/__tests__/demos/umd4/index.js | mount通过root.ownerDocument创建容器，unmount清内容，导出window[umd-app4]；effect用例旧library并不能保证mount已执行。 |

37项fixture声明分别记录其职责和对应消费角色；保留原始HTTP输入，解释写在消费测试及本报告。没有以“简单/私有/已有中文”作为框架函数豁免理由。

| 声明ID | 具体职责与豁免依据 |
|---|---|
| src/__tests__/demos/common/script1.js#constant#root | 保存应用容器查询结果，后续初始化或钩子渲染使用。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#constant#dynamicLink | 保存动态stylesheet原节点，配置href并通过head插入进入资源转换。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#constant#dynamicScript | 保存动态远程script原节点，配置src并通过body插入执行。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#function#onClickOfApp1 | 作为document.onclick函数身份，dispatch click后在fixture内部断言该身份。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#function#handleDocClick | 主动注册再按原引用移除document click，形成可清理监听输入。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#function#handleDocClick2 | 保持未主动移除的document click监听，供沙箱释放副作用。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#function#handleWinEvent | 主动注册再移除window scroll，形成监听去重/释放输入。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#function#handleWinEvent2 | 保留window scroll监听并移除不存在keydown，覆盖未主动释放与空删除。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script1.js#constant#newImg | 通过new Image创建并插入节点，fixture内部检查应用归属，随后clone检查根标记。 挂载时初始化root，动态插link/script，测试绑定函数/eval、主动/未主动释放事件与timer、卸载通信/keep-alive、Image和clone；common入口消费者多套共享。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script2.js#constant#pdom | 保存动态创建p节点，与字符串一起append，触发多节点补丁规范化。 动态插文本/p元素并创建ignore脚本，脚本内断言raw window注入；由common/script1和动态/关闭沙箱资源测试使用。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/common/script2.js#constant#dynamicIgnoreScript | 构建ignore内联script，保留浏览器原生执行并检查raw window注入值。 动态插文本/p元素并创建ignore脚本，脚本内断言raw window注入；由common/script1和动态/关闭沙箱资源测试使用。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/ssr-render/script1.js#constant#root | 保存应用容器查询结果，后续初始化或钩子渲染使用。 初始化root、动态common/link2与本目录script2，主动注册/移除document/window事件，给patch和效果测试提供节点/事件输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/ssr-render/script1.js#constant#dynamicLink | 保存动态stylesheet原节点，配置href并通过head插入进入资源转换。 初始化root、动态common/link2与本目录script2，主动注册/移除document/window事件，给patch和效果测试提供节点/事件输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/ssr-render/script1.js#constant#dynamicScript | 保存动态远程script原节点，配置src并通过body插入执行。 初始化root、动态common/link2与本目录script2，主动注册/移除document/window事件，给patch和效果测试提供节点/事件输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/ssr-render/script1.js#function#handleDocClick | 主动注册再按原引用移除document click，形成可清理监听输入。 初始化root、动态common/link2与本目录script2，主动注册/移除document/window事件，给patch和效果测试提供节点/事件输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/ssr-render/script1.js#function#handleWinEvent | 主动注册再移除window scroll，形成监听去重/释放输入。 初始化root、动态common/link2与本目录script2，主动注册/移除document/window事件，给patch和效果测试提供节点/事件输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/ssr-render/script2.js#constant#pdom | 保存动态创建p节点，与字符串一起append，触发多节点补丁规范化。 动态追加文本和p节点，ssr/script1按应用入口补全后请求，支持body插入补丁路径。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#constant#dynamicStyle1 | 先插入空style再填文本，触发MutationObserver延迟隔离输入。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#constant#dynamicStyle2 | 先填文本再插入style，触发同步隔离及DOM克隆后无需重复改写输入。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#constant#dynamicStyle3 | 保持空style，触发无文本等待分支。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#function#handleDocumentLoad | 以同一引用注册/移除document load，形成副作用记录器删除分支。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd2/index.js#function#handleWindowLoad | 以同一引用注册/移除window load，形成窗口记录器删除分支。 window load登记/移除、passive getter探测与命名对象钩子导出；当前库未读取旧library属性，不能冒称真实UMD钩子被捕获。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd2/index.js#function#mount | 渲染对应umd-root；umd2/4的钩子放在命名对象，本版的消费测试不通过当前规则捕获。 window load登记/移除、passive getter探测与命名对象钩子导出；当前库未读取旧library属性，不能冒称真实UMD钩子被捕获。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd2/index.js#function#unmount | 清空对应umd-root；命名对象导出不能视为当前window配对钩子已被消费。 window load登记/移除、passive getter探测与命名对象钩子导出；当前库未读取旧library属性，不能冒称真实UMD钩子被捕获。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd4/index.js#function#mount | 渲染对应umd-root；umd2/4的钩子放在命名对象，本版的消费测试不通过当前规则捕获。 mount通过root.ownerDocument创建容器，unmount清内容，导出window[umd-app4]；effect用例旧library并不能保证mount已执行。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd4/index.js#function#unmount | 清空对应umd-root；命名对象导出不能视为当前window配对钩子已被消费。 mount通过root.ownerDocument创建容器，unmount清内容，导出window[umd-app4]；effect用例旧library并不能保证mount已执行。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#assigned-function#document.onclick | 安装document属性事件，UMD副作用快照/恢复的输入。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#assigned-function#window.mount | 把渲染钩子写到当前可捕获的window.mount，递增renderCount、验证保留/逃逸属性并添加bound监听。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#named-function-expression#func1 | 在window.mount内创建具名函数并bind(window)，供bound函数原生监听的识别输入。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd1/index.js#assigned-function#window.unmount | 把清空root钩子写到当前可捕获window.unmount，供普通卸载调用。 三种style输入、window/document事件和timer、通信监听、全局写入及可捕获window.mount/unmount；提供副作用记录/恢复与重挂载输入。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd2/index.js#object-function-property#get | 被动监听options.passive getter；原生读取配置时把supportsPassive置true。 window load登记/移除、passive getter探测与命名对象钩子导出；当前库未读取旧library属性，不能冒称真实UMD钩子被捕获。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd3/index.js#assigned-function#mount | 同步抛错的mount钩子；最终导出到window['umd-app3']，当前旧library消费测试不执行这些钩子。 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd3/index.js#assigned-function#unmount | 同步抛错的unmount钩子；最终导出到window['umd-app3']，当前旧library消费测试不执行这些钩子。 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd3/index.js#assigned-function#mount@2 | 返回拒绝Promise的mount钩子；最终导出到window['umd-app3']，当前旧library消费测试不执行这些钩子。 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd3/index.js#assigned-function#unmount@2 | 返回拒绝Promise的unmount钩子；最终导出到window['umd-app3']，当前旧library消费测试不执行这些钩子。 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd3/index.js#assigned-function#mount@3 | 返回兑现Promise的mount钩子；最终导出到window['umd-app3']，当前旧library消费测试不执行这些钩子。 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |
| src/__tests__/demos/umd3/index.js#assigned-function#unmount@3 | 返回兑现Promise的unmount钩子；最终导出到window['umd-app3']，当前旧library消费测试不执行这些钩子。 三组同步抛错/Promise拒绝/Promise兑现钩子写入window[umd-app3]；当前捕获窗口配对属性，旧library消费者可能根本未进入这些钩子。 保留该liveServer响应作为原始被测输入，解释记录在消费测试与本次独立审计中。 |

## 验证

- TypeScript 4.1.6解析96个TS/JS文件：0错误。与本轮基线比较，解析器token（含字面量与标点）及去JSDoc AST均0差异。
- 162个测试的名称、调用形态与全部expect表达式逐项比较：0差异；56个fixture及2个受保护HTML文章字节/哈希不变。
- 声明结构门禁使用strict exemptions和fail-on-missing：1011 documented、26 exempt、0 missing、0 needs-tsdoc、0无匹配豁免。补充136项另行逐项复审。
- 两个return function具名表达式（fetchStub/microFetch）的TSDoc由人工确认；leading-comment工具不识别其return语句/同行注释。没有为结构计数改变return与function的换行关系。
- `git diff --check`通过。共享审计脚本与全局技能未改；其constructor统计原型问题按records独立重算。
- 未运行Jest测试（仅注释变更）。fixture数据对照是独立审查，不等于历史测试套件已执行通过。
- 未提交、推送、切分支或创建PR。

范围外：dev演示工程；src外构建、发布、类型声明目录；文章与站点扩写。本轮只读test_server等上下文以确认输入来源。
