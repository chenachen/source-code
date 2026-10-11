/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactNodeList,
  ReactCustomFormAction,
  Thenable,
} from 'shared/ReactTypes';
import type {
  CrossOriginEnum,
  PreloadImplOptions,
  PreloadModuleImplOptions,
  PreinitStyleOptions,
  PreinitScriptOptions,
  PreinitModuleScriptOptions,
  ImportMap,
} from 'react-dom/src/shared/ReactDOMTypes';

import {
  checkHtmlStringCoercion,
  checkCSSPropertyStringCoercion,
  checkAttributeStringCoercion,
  checkOptionStringCoercion,
} from 'shared/CheckStringCoercion';

import {Children} from 'react';

import {
  enableFizzExternalRuntime,
  enableSrcObject,
  enableFizzBlockingRender,
  enableViewTransition,
  enableViewTransitionParentEnterExit,
} from 'shared/ReactFeatureFlags';

import type {
  Destination,
  Chunk,
  PrecomputedChunk,
} from 'react-server/src/ReactServerStreamConfig';

import type {FormStatus} from '../shared/ReactDOMFormActions';

import {
  writeChunk,
  writeChunkAndReturn,
  stringToChunk,
  stringToPrecomputedChunk,
  readAsDataURL,
} from 'react-server/src/ReactServerStreamConfig';
import {
  resolveRequest,
  getResumableState,
  getRenderState,
  flushResources,
} from 'react-server/src/ReactFizzServer';

import isAttributeNameSafe from '../shared/isAttributeNameSafe';
import isUnitlessNumber from '../shared/isUnitlessNumber';
import getAttributeAlias from '../shared/getAttributeAlias';

import {checkControlledValueProps} from '../shared/ReactControlledValuePropTypes';
import {validateProperties as validateARIAProperties} from '../shared/ReactDOMInvalidARIAHook';
import {validateProperties as validateInputProperties} from '../shared/ReactDOMNullInputValuePropHook';
import {validateProperties as validateUnknownProperties} from '../shared/ReactDOMUnknownPropertyHook';
import warnValidStyle from '../shared/warnValidStyle';
import {getCrossOriginString} from '../shared/crossOriginStrings';

import escapeTextForBrowser from './escapeTextForBrowser';
import hyphenateStyleName from '../shared/hyphenateStyleName';
import hasOwnProperty from 'shared/hasOwnProperty';
import sanitizeURL from '../shared/sanitizeURL';
import isArray from 'shared/isArray';

import {
  clientRenderBoundary as clientRenderFunction,
  completeBoundary as completeBoundaryFunction,
  completeBoundaryUpgradeToViewTransitions as upgradeToViewTransitionsInstruction,
  completeBoundaryWithStyles as styleInsertionFunction,
  completeSegment as completeSegmentFunction,
  formReplaying as formReplayingRuntime,
  markShellTime,
} from './fizz-instruction-set/ReactDOMFizzInstructionSetInlineCodeStrings';

import {getValueDescriptorExpectingObjectForWarning} from '../shared/ReactDOMResourceValidation';

import {NotPending} from '../shared/ReactDOMFormActions';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

/** 安装 Fizz 服务端资源 dispatcher 前的 DOM dispatcher，用于无活动请求时回退。 */
const previousDispatcher =
  ReactDOMSharedInternals.d; /* ReactDOMCurrentDispatcher */
ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */ = {
  f /* flushSyncWork */: previousDispatcher.f /* flushSyncWork */,
  r /* requestFormReset */: previousDispatcher.r /* requestFormReset */,
  D /* prefetchDNS */: prefetchDNS,
  C /* preconnect */: preconnect,
  L /* preload */: preload,
  m /* preloadModule */: preloadModule,
  X /* preinitScript */: preinitScript,
  S /* preinitStyle */: preinitStyle,
  M /* preinitModuleScript */: preinitModuleScript,
};

/**
 * `onHeaders` 可接收的响应头描述；字段全为可选，因为回调不保证收到任何特定头类型。
 */
export type HeadersDescriptor = {
  /** 合并后的 HTTP Link 资源提示头。 */
  Link?: string,
};

/** 标识当前上下文属于现代主渲染器，可与 Legacy 等其他 renderer 区分。 */
export const isPrimaryRenderer = true;

/** DOM Fizz 支持需要浏览器执行的客户端指令。 */
export const supportsClientAPIs = true;

/** Fizz 指令采用内联 script 或 data/template 协议的判别值。 */
export type StreamingFormat = 0 | 1;
/** 通过内联 script 发送指令。 */
const ScriptStreamingFormat: StreamingFormat = 0;
/** 通过 data 属性与外部 runtime 发送指令。 */
const DataStreamingFormat: StreamingFormat = 1;

/** 已发送内联指令/runtime 片段的位掩码。 */
export type InstructionState = number;
/** 尚未发送任何指令辅助代码。 */
const NothingSent /*                      */ = 0b000000000;
/** 已发送 completeSegment 函数体。 */
const SentCompleteSegmentFunction /*      */ = 0b000000001;
/** 已发送 completeBoundary 函数体。 */
const SentCompleteBoundaryFunction /*     */ = 0b000000010;
/** 已发送 clientRenderBoundary 函数体。 */
const SentClientRenderFunction /*         */ = 0b000000100;
/** 已发送样式插入函数体。 */
const SentStyleInsertionFunction /*       */ = 0b000001000;
/** 已发送表单重放 runtime。 */
const SentFormReplayingRuntime /*         */ = 0b000010000;
/** 已把已完成 shell id 写入文档。 */
const SentCompletedShellId /*             */ = 0b000100000;
/** 已发送记录 shell 绘制时间的代码。 */
const SentMarkShellTime /*                */ = 0b001000000;
/** 后续揭示需要升级到 ViewTransition 指令。 */
const NeedUpgradeToViewTransitions /*     */ = 0b010000000;
/** ViewTransition 升级指令已经发送。 */
const SentUpgradeToViewTransitions /*     */ = 0b100000000;

/** 字符串仅配置脚本nonce；对象可分别指定script/style，字符串不会给样式设置nonce。 */
type NonceOption =
  | string
  | {
      /** script 标签的 CSP nonce。 */
      script?: string,
      /** style 标签的 CSP nonce。 */
      style?: string,
    };

/**
 * 单次请求的临时编码与刷新状态，不随postponedState序列化。待输出Chunk、Set及按precedence排序的Map属于本次渲染；跨prerender/resume的资源去重身份由ResumableState保存。resets另记已通过早期响应头发出的提示，以便shell未完成时重置可恢复状态后仍保留这些事实。
 */
export type RenderState = {
  /** 可从可恢复状态重建的 placeholder id 前缀。 */
  placeholderPrefix: PrecomputedChunk,
  /** 流式 segment id 前缀。 */
  segmentPrefix: PrecomputedChunk,
  /** Suspense boundary id 前缀。 */
  boundaryPrefix: PrecomputedChunk,

  /** 内联 script 指令起始块；外部 runtime/data 格式不使用。 */
  startInlineScript: PrecomputedChunk,

  /** 带当前 nonce 的内联 style 起始块。 */
  startInlineStyle: PrecomputedChunk,

  // preamble 必须在 resume 前全部刷新，因此恢复时以下块必须为空。

  /** 文档 html/head/body 前导块状态。 */
  preamble: PreambleState,

  /** 外部 Fizz runtime 脚本及其预编码块。 */
  externalRuntimeScript: null | ExternalRuntimeScript,
  /** bootstrap 脚本输出块。 */
  bootstrapChunks: Array<Chunk | PrecomputedChunk>,
  /** import map 输出块。 */
  importMapChunks: Array<Chunk | PrecomputedChunk>,

  /** charset 元数据提升块。 */
  charsetChunks: Array<Chunk | PrecomputedChunk>,
  /** viewport 元数据提升块。 */
  viewportChunks: Array<Chunk | PrecomputedChunk>,
  /** 其他可提升资源块。 */
  hoistableChunks: Array<Chunk | PrecomputedChunk>,

  /** 可选的提前响应头回调。 */
  onHeaders: void | ((headers: HeadersDescriptor) => void),
  /** 尚未刷新、可提前发出的 Link 头队列及容量。 */
  headers: null | {
    /** preconnect Link 头片段。 */
    preconnects: string,
    /** 字体 preload Link 头片段。 */
    fontPreloads: string,
    /** 高优先级图片 preload Link 头片段。 */
    highImagePreloads: string,
    /** 剩余 UTF-16 码元容量预算。 */
    remainingCapacity: number,
  },
  /** shell未完成而重置ResumableState时，保留已发早期响应头资源的快照；并非每次阶段切换都恢复。 */
  resets: {
    /** 对应 ResumableState.unknownResources["font"]。 */
    font: {
      /** 字体 href 到已预载标记。 */
      [href: string]: Preloaded,
    },
    /** 对应 dnsResources 的 key 集合。 */
    dns: {
      /** DNS 提示去重键。 */
      [key: string]: Exists
    },
    /** 按凭据模式拆分的 preconnect 快照。 */
    connect: {
      /** 未指定 crossOrigin 的连接。 */
      default: {
        /** 连接去重键。 */
        [key: string]: Exists
      },
      /** anonymous 跨域连接。 */
      anonymous: {
        /** 连接去重键。 */
        [key: string]: Exists
      },
      /** use-credentials 跨域连接。 */
      credentials: {
        /** 连接去重键。 */
        [key: string]: Exists
      },
    },
    /** 图片 preload 快照。 */
    image: {
      /** 图片资源键。 */
      [key: string]: Preloaded,
    },
    /** 样式资源存在/预载及凭据快照。 */
    style: {
      /** 样式资源键。 */
      [key: string]: Exists | Preloaded | PreloadedWithCredentials,
    },
  },

  /** 待刷新 preconnect 资源。 */
  preconnects: Set<Resource>,
  /** 待刷新字体 preload 资源。 */
  fontPreloads: Set<Resource>,
  /** 待刷新高优先级图片 preload 资源。 */
  highImagePreloads: Set<Resource>,
  // usedImagePreloads: Set<PreloadResource>,
  /** 按 precedence 保存的内联样式队列。 */
  styles: Map<string, StyleQueue>,
  /** 待刷新 bootstrap 脚本。 */
  bootstrapScripts: Set<Resource>,
  /** 待刷新普通脚本。 */
  scripts: Set<Resource>,
  /** 延后批量刷新的 preload 资源。 */
  bulkPreloads: Set<Resource>,

  /** shell 刷新前临时按键跟踪 preload 资源。 */
  preloads: {
    /** 图片 preload 键到资源。 */
    images: Map<string, Resource>,
    /** 样式表 preload 键到资源。 */
    stylesheets: Map<string, Resource>,
    /** 普通脚本 preload 键到资源。 */
    scripts: Map<string, Resource>,
    /** 模块脚本 preload 键到资源。 */
    moduleScripts: Map<string, Resource>,
  },

  /** 当前请求内联内容的 CSP nonce。 */
  nonce: {
    /** 脚本标签的CSP nonce。 */
    script: string | void,
    /** 样式标签的CSP nonce；字符串nonce配置不会填此字段。 */
    style: string | void,
  },

  /** 当前请求是否已刷新但尚未发送提升指令的样式资源。 */
  stylesToHoist: boolean,

  // 允许 Legacy renderer 扩展该对象。

  ...
};

/** 资源已存在但没有额外预载元数据的标记类型。 */
type Exists = null;
/** 资源已预载且没有独特凭据的标记类型。 */
type Preloaded = [];
/**
 * 会影响浏览器是否请求及复用哪条连接的预载凭据。
 * preload 与最终资源必须一致，否则预载会浪费；实验表明 referrerPolicy 不属于 HTTP
 * 缓存键且不影响连接选择，因此不纳入。
 */
type PreloadedWithCredentials = [
  /* 跨域模式 */ ?CrossOriginEnum,
  /* 完整性摘要 */ ?string,
];

/** 资源已存在的稳定空值标记。 */
const EXISTS: Exists = null;
/**
 * 表示没有独特凭据的 preload。不得按对象身份比较；ResumableState 中的值可能来自
 * 解析输入，不保证与此常量同一引用。
 */
const PRELOAD_NO_CREDS: Preloaded = [];
if (__DEV__) {
  Object.freeze(PRELOAD_NO_CREDS);
}

/** 单次响应全局且与子树无关的可恢复状态；所有字段必须可序列化。 */
export type ResumableState = {
  /** 所有服务端生成 id 的用户前缀。 */
  idPrefix: string,
  /** 下一枚表单状态标记 id。 */
  nextFormID: number,
  /** 当前采用 script 还是 data 指令格式。 */
  streamingFormat: StreamingFormat,

  // bootstrap 初始化器保存在可恢复状态中，以覆盖 prerender shell 推迟；恢复时必要则重建，
  // 一旦实际刷新就把对应字段置空。
  /** 可选内联 bootstrap 脚本文本。 */
  bootstrapScriptContent?: string | void,
  /** 普通 bootstrap 脚本描述。 */
  bootstrapScripts?: $ReadOnlyArray<string | BootstrapScriptDescriptor> | void,
  /** 模块 bootstrap 脚本描述。 */
  bootstrapModules?: $ReadOnlyArray<string | BootstrapScriptDescriptor> | void,

  /** script 指令格式已发送辅助代码位掩码；外部 runtime/data 格式不使用。 */
  instructions: InstructionState,

  /** 是否已出现 body，决定 postamble 是否闭合标签。 */
  hasBody: boolean,
  /** 是否已出现 html，决定 postamble 是否闭合根标签。 */
  hasHtml: boolean,

  /** 按 as 与 href 保存的未知资源 preload 缓存。 */
  unknownResources: {
    /** 资源 as 类型。 */
    [asType: string]: {
      /** 资源地址。 */
      [href: string]: Preloaded,
    },
  },
  /** DNS 预取去重缓存。 */
  dnsResources: {
    /** DNS 资源键。 */
    [key: string]: Exists
  },
  /** 按凭据模式拆分的 preconnect 缓存。 */
  connectResources: {
    /** 未指定 crossOrigin 的连接。 */
    default: {
      /** 连接资源键。 */
      [key: string]: Exists
    },
    /** anonymous 连接。 */
    anonymous: {
      /** 连接资源键。 */
      [key: string]: Exists
    },
    /** use-credentials 连接。 */
    credentials: {
      /** 连接资源键。 */
      [key: string]: Exists
    },
  },
  /** 图片 preload 缓存。 */
  imageResources: {
    /** 图片资源键。 */
    [key: string]: Preloaded,
  },
  /** 样式资源存在/预载缓存。 */
  styleResources: {
    /** 样式资源键。 */
    [key: string]: Exists | Preloaded | PreloadedWithCredentials,
  },
  /** 普通脚本资源存在/预载缓存。 */
  scriptResources: {
    /** 脚本资源键。 */
    [key: string]: Exists | Preloaded | PreloadedWithCredentials,
  },
  /** 按 as/href 保存的未知模块资源 preload 缓存。 */
  moduleUnknownResources: {
    /** 模块 as 类型。 */
    [asType: string]: {
      /** 模块地址。 */
      [href: string]: Preloaded,
    },
  },
  /** 模块脚本资源存在/预载缓存。 */
  moduleScriptResources: {
    /** 模块脚本资源键。 */
    [key: string]: Exists | Preloaded | PreloadedWithCredentials,
  },
};

/** 当前正在刷新资源的请求状态；dispatcher 通过它关联无显式 request 的调用。 */
let currentlyFlushingRenderState: RenderState | null = null;

/** data 指令 template 的属性结束与标签闭合块。 */
const dataElementQuotedEnd = stringToPrecomputedChunk('"></template>');

/** 无 nonce 的内联 script 起始块。 */
const startInlineScript = stringToPrecomputedChunk('<script');
/** script 结束块。 */
const endInlineScript = stringToPrecomputedChunk('</script>');

/** 外部普通脚本 src 属性起始块。 */
const startScriptSrc = stringToPrecomputedChunk('<script src="');
/** 外部模块脚本 src 属性起始块。 */
const startModuleSrc = stringToPrecomputedChunk('<script type="module" src="');
/** script nonce 属性起始块。 */
const scriptNonce = stringToPrecomputedChunk(' nonce="');
/** script integrity 属性起始块。 */
const scriptIntegirty = stringToPrecomputedChunk(' integrity="');
/** script crossorigin 属性起始块。 */
const scriptCrossOrigin = stringToPrecomputedChunk(' crossorigin="');
/** async script 起始标签闭合与结束标签块。 */
const endAsyncScript = stringToPrecomputedChunk(' async=""></script>');

/** 无 nonce 的内联 style 起始块。 */
const startInlineStyle = stringToPrecomputedChunk('<style');

/**
 * 转义整段内联脚本中的 `<script`/`</script` 序列，防止 HTML parser 提前结束或永不结束脚本。
 * 因为处理的是完整内容，无需转义同时也是合法 JavaScript 的 HTML 注释序列；不存在后续
 * `<script` 时 parser 不会进入 script data double escaped 状态
 *（https://www.w3.org/TR/html53/syntax.html#script-data-double-escaped-state）。
 * 不可信脚本内容仍应在调用前自行安全化。
 */
function escapeEntireInlineScriptContent(scriptText: string) {
  if (__DEV__) {
    checkHtmlStringCoercion(scriptText);
  }
  return ('' + scriptText).replace(scriptRegex, scriptReplacer);
}
/** 定位大小写任意的 script 起止标签前缀。 */
const scriptRegex = /(<\/|<)(s)(cript)/gi;
/** 把 script 首字母转为 Unicode 转义，破坏 HTML 标签序列但保持 JavaScript 语义。 */
const scriptReplacer = (
  match: string,
  prefix: string,
  s: string,
  suffix: string,
) => `${prefix}${s === 's' ? '\\u0073' : '\\u0053'}${suffix}`;

/** bootstrap 脚本地址及可选完整性/跨域信息。 */
export type BootstrapScriptDescriptor = {
  /** 脚本 URL。 */
  src: string,
  /** Subresource Integrity 摘要。 */
  integrity?: string,
  /** 跨域凭据模式。 */
  crossOrigin?: string,
};
/** 外部 Fizz runtime 的地址与预编码输出块。 */
export type ExternalRuntimeScript = {
  /** 外部运行时脚本地址。 */
  src: string,
  /** 完整 script 标签块。 */
  chunks: Array<Chunk | PrecomputedChunk>,
};

/** import map script 起始块。 */
const importMapScriptStart = stringToPrecomputedChunk(
  '<script type="importmap">',
);
/** import map script 结束块。 */
const importMapScriptEnd = stringToPrecomputedChunk('</script>');

/**
 * Link头的默认容量为2000个UTF-16码元，并非HTTP UTF-8字节数。初始化预算多加2以抵消首条之前并不存在的逗号空格；每次先扣条目长度加2，仅剩余非负时写入。超长条目使预算变负后不回补，后续提示退到HTML资源队列，不能据此推断响应头允许超预算。
 */
const DEFAULT_HEADERS_CAPACITY_IN_UTF16_CODE_UNITS = 2000;

/** 开发环境记录已警告的“新布尔 prop 传空字符串”名称。 */
let didWarnForNewBooleanPropsWithEmptyValue: {
  /** prop 名到已警告标记。 */
  [string]: boolean
};
if (__DEV__) {
  didWarnForNewBooleanPropsWithEmptyValue = {};
}

/**
 * 从可恢复资源身份构建本次请求的待刷新队列，并预编码nonce、bootstrap、import map和可选外部runtime。字符串nonce只用于script，对象style字段才用于style；内联指令前缀沿用resumableState.idPrefix。只有启用外部runtime且传入配置时才切到data指令格式。onHeaders存在时建立UTF-16容量预算；bootstrap配置未在先前shell刷新时才在本次重建，去重身份仍在resumableState而非这些待输出数组中。
 */
export function createRenderState(
  resumableState: ResumableState,
  nonce:
    | string
    | {
        /** 脚本标签的CSP nonce。 */
        script?: string,
        /** 样式标签的CSP nonce；字符串nonce配置不会填此字段。 */
        style?: string,
      }
    | void,
  externalRuntimeConfig: string | BootstrapScriptDescriptor | void,
  importMap: ImportMap | void,
  onHeaders: void | ((headers: HeadersDescriptor) => void),
  maxHeadersLength: void | number,
): RenderState {
  const nonceScript = typeof nonce === 'string' ? nonce : nonce && nonce.script;
  const inlineScriptWithNonce =
    nonceScript === undefined
      ? startInlineScript
      : stringToPrecomputedChunk(
          '<script nonce="' + escapeTextForBrowser(nonceScript) + '"',
        );
  const nonceStyle =
    typeof nonce === 'string' ? undefined : nonce && nonce.style;
  const inlineStyleWithNonce =
    nonceStyle === undefined
      ? startInlineStyle
      : stringToPrecomputedChunk(
          '<style nonce="' + escapeTextForBrowser(nonceStyle) + '"',
        );
  const idPrefix = resumableState.idPrefix;

  const bootstrapChunks: Array<Chunk | PrecomputedChunk> = [];
  let externalRuntimeScript: null | ExternalRuntimeScript = null;
  const {bootstrapScriptContent, bootstrapScripts, bootstrapModules} =
    resumableState;
  if (bootstrapScriptContent !== undefined) {
    bootstrapChunks.push(inlineScriptWithNonce);
    pushCompletedShellIdAttribute(bootstrapChunks, resumableState);
    bootstrapChunks.push(
      endOfStartTag,
      stringToChunk(escapeEntireInlineScriptContent(bootstrapScriptContent)),
      endInlineScript,
    );
  }
  if (enableFizzExternalRuntime) {
    if (externalRuntimeConfig !== undefined) {
      if (typeof externalRuntimeConfig === 'string') {
        externalRuntimeScript = {
          src: externalRuntimeConfig,
          chunks: [],
        };
        pushScriptImpl(externalRuntimeScript.chunks, {
          src: externalRuntimeConfig,
          async: true,
          integrity: undefined,
          nonce: nonceScript,
        });
      } else {
        externalRuntimeScript = {
          src: externalRuntimeConfig.src,
          chunks: [],
        };
        pushScriptImpl(externalRuntimeScript.chunks, {
          src: externalRuntimeConfig.src,
          async: true,
          integrity: externalRuntimeConfig.integrity,
          nonce: nonceScript,
        });
      }
    }
  }

  const importMapChunks: Array<Chunk | PrecomputedChunk> = [];
  if (importMap !== undefined) {
    const map = importMap;
    importMapChunks.push(importMapScriptStart);
    importMapChunks.push(
      stringToChunk(escapeEntireInlineScriptContent(JSON.stringify(map))),
    );
    importMapChunks.push(importMapScriptEnd);
  }
  if (__DEV__) {
    if (onHeaders && typeof maxHeadersLength === 'number') {
      if (maxHeadersLength <= 0) {
        console.error(
          'React expected a positive non-zero `maxHeadersLength` option but found %s instead. When using the `onHeaders` option you may supply an optional `maxHeadersLength` option as well however, when setting this value to zero or less no headers will be captured.',
          maxHeadersLength === 0 ? 'zero' : maxHeadersLength,
        );
      }
    }
  }
  const headers = onHeaders
    ? {
        preconnects: '',
        fontPreloads: '',
        highImagePreloads: '',
        remainingCapacity:
          // 容量初值多加 2，因为扣减时总是假设插入分隔符 ", "，而首条头实际不消耗它。
          2 +
          (typeof maxHeadersLength === 'number'
            ? maxHeadersLength
            : DEFAULT_HEADERS_CAPACITY_IN_UTF16_CODE_UNITS),
      }
    : null;
  const renderState: RenderState = {
    placeholderPrefix: stringToPrecomputedChunk(idPrefix + 'P:'),
    segmentPrefix: stringToPrecomputedChunk(idPrefix + 'S:'),
    boundaryPrefix: stringToPrecomputedChunk(idPrefix + 'B:'),
    startInlineScript: inlineScriptWithNonce,
    startInlineStyle: inlineStyleWithNonce,
    preamble: createPreambleState(),

    externalRuntimeScript: externalRuntimeScript,
    bootstrapChunks: bootstrapChunks,
    importMapChunks,

    onHeaders,
    headers,
    resets: {
      font: {},
      dns: {},
      connect: {
        default: {},
        anonymous: {},
        credentials: {},
      },
      image: {},
      style: {},
    },

    charsetChunks: [],
    viewportChunks: [],
    hoistableChunks: [],

    // 这些刷新队列会在 flush 后清空。
    preconnects: new Set(),
    fontPreloads: new Set(),
    highImagePreloads: new Set(),
    // usedImagePreloads: new Set(),
    styles: new Map(),
    bootstrapScripts: new Set(),
    scripts: new Set(),
    bulkPreloads: new Set(),

    preloads: {
      images: new Map(),
      stylesheets: new Map(),
      scripts: new Map(),
      moduleScripts: new Map(),
    },

    nonce: {
      script: nonceScript,
      style: nonceStyle,
    },
    // 类似模块全局，指向当前正在渲染边界的提升状态。
    hoistableState: null,
    stylesToHoist: false,
  };

  if (bootstrapScripts !== undefined) {
    for (let i = 0; i < bootstrapScripts.length; i++) {
      const scriptConfig = bootstrapScripts[i];
      let src, crossOrigin, integrity;
      const props: PreloadAsProps = {
        rel: 'preload',
        as: 'script',
        fetchPriority: 'low',
        nonce,
      } as any;
      if (typeof scriptConfig === 'string') {
        props.href = src = scriptConfig;
      } else {
        props.href = src = scriptConfig.src;
        props.integrity = integrity =
          typeof scriptConfig.integrity === 'string'
            ? scriptConfig.integrity
            : undefined;
        props.crossOrigin = crossOrigin =
          typeof scriptConfig === 'string' || scriptConfig.crossOrigin == null
            ? undefined
            : scriptConfig.crossOrigin === 'use-credentials'
              ? 'use-credentials'
              : '';
      }

      preloadBootstrapScriptOrModule(resumableState, renderState, src, props);

      bootstrapChunks.push(
        startScriptSrc,
        stringToChunk(escapeTextForBrowser(src)),
        attributeEnd,
      );
      if (nonceScript) {
        bootstrapChunks.push(
          scriptNonce,
          stringToChunk(escapeTextForBrowser(nonceScript)),
          attributeEnd,
        );
      }
      if (typeof integrity === 'string') {
        bootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity)),
          attributeEnd,
        );
      }
      if (typeof crossOrigin === 'string') {
        bootstrapChunks.push(
          scriptCrossOrigin,
          stringToChunk(escapeTextForBrowser(crossOrigin)),
          attributeEnd,
        );
      }
      pushCompletedShellIdAttribute(bootstrapChunks, resumableState);
      bootstrapChunks.push(endAsyncScript);
    }
  }
  if (bootstrapModules !== undefined) {
    for (let i = 0; i < bootstrapModules.length; i++) {
      const scriptConfig = bootstrapModules[i];
      let src, crossOrigin, integrity;
      const props: PreloadModuleProps = {
        rel: 'modulepreload',
        fetchPriority: 'low',
        nonce: nonceScript,
      } as any;
      if (typeof scriptConfig === 'string') {
        props.href = src = scriptConfig;
      } else {
        props.href = src = scriptConfig.src;
        props.integrity = integrity =
          typeof scriptConfig.integrity === 'string'
            ? scriptConfig.integrity
            : undefined;
        props.crossOrigin = crossOrigin =
          typeof scriptConfig === 'string' || scriptConfig.crossOrigin == null
            ? undefined
            : scriptConfig.crossOrigin === 'use-credentials'
              ? 'use-credentials'
              : '';
      }

      preloadBootstrapScriptOrModule(resumableState, renderState, src, props);

      bootstrapChunks.push(
        startModuleSrc,
        stringToChunk(escapeTextForBrowser(src)),
        attributeEnd,
      );
      if (nonceScript) {
        bootstrapChunks.push(
          scriptNonce,
          stringToChunk(escapeTextForBrowser(nonceScript)),
          attributeEnd,
        );
      }
      if (typeof integrity === 'string') {
        bootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity)),
          attributeEnd,
        );
      }
      if (typeof crossOrigin === 'string') {
        bootstrapChunks.push(
          scriptCrossOrigin,
          stringToChunk(escapeTextForBrowser(crossOrigin)),
          attributeEnd,
        );
      }
      pushCompletedShellIdAttribute(bootstrapChunks, resumableState);
      bootstrapChunks.push(endAsyncScript);
    }
  }

  return renderState;
}

/** 用 resumableState 新建本轮 RenderState；不传新 runtime/importMap/headers 配置，bootstrap 从尚未清除的保存字段重建。 */
export function resumeRenderState(
  resumableState: ResumableState,
  nonce: NonceOption | void,
): RenderState {
  return createRenderState(
    resumableState,
    nonce,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

/**
 * 创建可跨 prerender/resume 边界序列化的响应状态，并根据外部 runtime 选择指令格式。
 */
export function createResumableState(
  identifierPrefix: string | void,
  externalRuntimeConfig: string | BootstrapScriptDescriptor | void,
  bootstrapScriptContent: string | void,
  bootstrapScripts: $ReadOnlyArray<string | BootstrapScriptDescriptor> | void,
  bootstrapModules: $ReadOnlyArray<string | BootstrapScriptDescriptor> | void,
): ResumableState {
  const idPrefix = identifierPrefix === undefined ? '' : identifierPrefix;

  let streamingFormat = ScriptStreamingFormat;
  if (enableFizzExternalRuntime) {
    if (externalRuntimeConfig !== undefined) {
      streamingFormat = DataStreamingFormat;
    }
  }
  return {
    idPrefix: idPrefix,
    nextFormID: 0,
    streamingFormat,
    bootstrapScriptContent,
    bootstrapScripts,
    bootstrapModules,
    instructions: NothingSent,
    hasBody: false,
    hasHtml: false,

    // @TODO：把 bootstrap script 加入隐式 preload。

    // 以下资源缓存跨 prerender/resume 持久化。
    unknownResources: {},
    dnsResources: {},
    connectResources: {
      default: {},
      anonymous: {},
      credentials: {},
    },
    imageResources: {},
    styleResources: {},
    scriptResources: {},
    moduleUnknownResources: {},
    moduleScriptResources: {},
  };
}

/**
 * 根据本轮未完整刷新的 RenderState 快照复位可恢复状态。
 * HTML shell 尚未刷新，指令和文档骨架归零；已经发出的早期资源提示由 resets 保留。
 */
export function resetResumableState(
  resumableState: ResumableState,
  renderState: RenderState,
): void {
  // HTML shell 未刷新时，用 resets 重建资源缓存，保留已发出的早期资源提示。
  resumableState.nextFormID = 0;
  resumableState.hasBody = false;
  resumableState.hasHtml = false;
  resumableState.unknownResources = {
    font: renderState.resets.font,
  };
  resumableState.dnsResources = renderState.resets.dns;
  resumableState.connectResources = renderState.resets.connect;
  resumableState.imageResources = renderState.resets.image;
  resumableState.styleResources = renderState.resets.style;
  resumableState.scriptResources = {};
  resumableState.moduleUnknownResources = {};
  resumableState.moduleScriptResources = {};
  resumableState.instructions = NothingSent; // 没有刷新内容，也不可能刷新过指令。
}

/** prerender 已产生 shell 后清除 bootstrap 初始化器，避免 resume 重复发送。 */
export function completeResumableState(resumableState: ResumableState): void {
  // 仅在 prerender 已完成且存在 shell 时调用。
  resumableState.bootstrapScriptContent = undefined;
  resumableState.bootstrapScripts = undefined;
  resumableState.bootstrapModules = undefined;
}

/** 可在真正输出前收集 html/head/body 起始标签及其属性的 preamble 状态。 */
export type PreambleState = {
  /** html 起始标签块；null 表示尚未遇到。 */
  htmlChunks: null | Array<Chunk | PrecomputedChunk>,
  /** head 起始标签块；null 表示尚未遇到。 */
  headChunks: null | Array<Chunk | PrecomputedChunk>,
  /** body 起始标签块；null 表示尚未遇到。 */
  bodyChunks: null | Array<Chunk | PrecomputedChunk>,
};
/** 创建尚未发现任何文档骨架标签的 preamble 状态。 */
export function createPreambleState(): PreambleState {
  return {
    htmlChunks: null,
    headChunks: null,
    bodyChunks: null,
  };
}

// 当前写入位置的精简插入模式；只编码 Fizz 需要的 HTML5 变体。由于不直接传递
// namespace，使用数字常量而非字符串。
/** 根最外层元素模式。 */
export const ROOT_HTML_MODE = 0;
// 其他位置依赖“小于 HTML_HTML_MODE”的比较；增加更小枚举时必须复核。
/** 顶层 <html> 标签内部模式。 */
const HTML_HTML_MODE = 1;
/** 普通 HTML 内容模式。 */
const HTML_MODE = 2;
/** <head> 内容模式。 */
const HTML_HEAD_MODE = 3;
/** SVG 命名空间模式。 */
const SVG_MODE = 4;
/** MathML 命名空间模式。 */
const MATHML_MODE = 5;
/** <table> 直接子级模式。 */
const HTML_TABLE_MODE = 6;
/** thead/tbody/tfoot 子级模式。 */
const HTML_TABLE_BODY_MODE = 7;
/** <tr> 子级模式。 */
const HTML_TABLE_ROW_MODE = 8;
/** <colgroup> 子级模式。 */
const HTML_COLGROUP_MODE = 9;
// 其他位置依赖“大于 HTML_TABLE_MODE”的比较；增加表格模式时必须复核。

/** 所有受支持 DOM 插入模式的数字联合。 */
type InsertionMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 无特殊标签或动画作用域。 */
const NO_SCOPE = /*         */ 0b0000000;
/** 位于 noscript 子树。 */
const NOSCRIPT_SCOPE = /*   */ 0b0000001;
/** 位于 picture 子树。 */
const PICTURE_SCOPE = /*    */ 0b0000010;
/** 位于 Suspense fallback 子树。 */
const FALLBACK_SCOPE = /*   */ 0b0000100;
/** Suspense fallback 下首个直接实例可执行 exit。 */
const EXIT_SCOPE = /*       */ 0b0001000;
/** Suspense content 下首个直接实例可执行 enter。 */
const ENTER_SCOPE = /*      */ 0b0010000;
/** 子树发生变化时应用 update ViewTransition。 */
const UPDATE_SCOPE = /*     */ 0b0100000;
/** 位于可能参加 enter/share 动画的 Suspense content 子树。 */
const APPEARING_SCOPE = /*  */ 0b1000000;
/** 位于正在退出的父 ViewTransition 下。 */
const PARENT_EXIT_SCOPE = /* */ 0b10000000;
/** 位于正在进入的父 ViewTransition 下。 */
const PARENT_ENTER_SCOPE = /* */ 0b100000000;

/** 排除仅持续到下一 DOM 实例的 enter/exit 位，其余位贯穿整棵子树。 */
const SUBTREE_SCOPE = ~(ENTER_SCOPE | EXIT_SCOPE);

/** 当前 ViewTransition 的规范化类别、名称和父级传播状态。 */
type ViewTransitionContext = {
  /** 子树布局更新动画类别。 */
  update: 'none' | 'auto' | string,
  /** 新内容进入动画类别。 */
  enter: 'none' | 'auto' | string,
  /** fallback 内容退出动画类别。 */
  exit: 'none' | 'auto' | string,
  /** 同名旧/新元素共享动画类别。 */
  share: 'none' | 'auto' | string,
  /** 从进入父 transition 继承的类别。 */
  parentEnter: 'none' | 'auto' | string,
  /** 从退出父 transition 继承的类别。 */
  parentExit: 'none' | 'auto' | string,
  /** 显式名称或 auto。 */
  name: 'auto' | string,
  /** 未定义显式名称时使用的稳定自动名称。 */
  autoName: string,
  /** 已输出的同名实例数，用于生成无冲突后缀。 */
  nameIdx: number,
};

/** 可在挂起后恢复的 DOM 插入、select、标签作用域与 ViewTransition 上下文。 */
export type FormatContext = {
  /** root/svg/html/mathml/table 等插入模式。 */
  insertionMode: InsertionMode,
  /** select 内的当前选中值；select 外为 null。 */
  selectedValue: null | string | Array<string>,
  /** noscript/picture/Suspense/ViewTransition 位掩码。 */
  tagScope: number,
  /** 首个 DOM 节点之前尚未消费的 ViewTransition 上下文。 */
  viewTransition: null | ViewTransitionContext,
};

/**
 * 创建新的外层格式上下文，供Fizz进入子树时替换、退出时恢复父上下文。对象并未冻结；viewTransition对象可与父级共享，其中nameIdx由宿主属性编码递增，不能把整个上下文视为深层不可变。
 */
function createFormatContext(
  insertionMode: InsertionMode,
  selectedValue: null | string | Array<string>,
  tagScope: number,
  viewTransition: null | ViewTransitionContext,
): FormatContext {
  return {
    insertionMode,
    selectedValue,
    tagScope,
    viewTransition,
  };
}

/** 只有根或顶层 html 作用域可收集 preamble 标签。 */
export function canHavePreamble(formatContext: FormatContext): boolean {
  return formatContext.insertionMode < HTML_MODE;
}

/** 根据可选根 namespace 创建 HTML、SVG 或 MathML 根上下文。 */
export function createRootFormatContext(namespaceURI?: string): FormatContext {
  const insertionMode =
    namespaceURI === 'http://www.w3.org/2000/svg'
      ? SVG_MODE
      : namespaceURI === 'http://www.w3.org/1998/Math/MathML'
        ? MATHML_MODE
        : ROOT_HTML_MODE;
  return createFormatContext(insertionMode, null, NO_SCOPE, null);
}

/**
 * 根据子标签推进插入模式、select 值和作用域位；普通标签继承父上下文。
 * 进入实际 DOM 实例后会消费一次性的 enter/exit 与 ViewTransition 上下文。
 */
export function getChildFormatContext(
  parentContext: FormatContext,
  type: string,
  props: Object,
): FormatContext {
  const subtreeScope = parentContext.tagScope & SUBTREE_SCOPE;
  switch (type) {
    case 'noscript':
      return createFormatContext(
        HTML_MODE,
        null,
        subtreeScope | NOSCRIPT_SCOPE,
        null,
      );
    case 'select':
      return createFormatContext(
        HTML_MODE,
        props.value != null ? props.value : props.defaultValue,
        subtreeScope,
        null,
      );
    case 'svg':
      return createFormatContext(SVG_MODE, null, subtreeScope, null);
    case 'picture':
      return createFormatContext(
        HTML_MODE,
        null,
        subtreeScope | PICTURE_SCOPE,
        null,
      );
    case 'math':
      return createFormatContext(MATHML_MODE, null, subtreeScope, null);
    case 'foreignObject':
      return createFormatContext(HTML_MODE, null, subtreeScope, null);
    // 表格子节点只有包在对应表格父级下才能创建，因此必须编码进入的具体模式。
    case 'table':
      return createFormatContext(HTML_TABLE_MODE, null, subtreeScope, null);
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return createFormatContext(
        HTML_TABLE_BODY_MODE,
        null,
        subtreeScope,
        null,
      );
    case 'colgroup':
      return createFormatContext(HTML_COLGROUP_MODE, null, subtreeScope, null);
    case 'tr':
      return createFormatContext(HTML_TABLE_ROW_MODE, null, subtreeScope, null);
    case 'head':
      if (parentContext.insertionMode < HTML_MODE) {
        // 当前在根或 <html> 内，可以进入 <head> 作用域。
        return createFormatContext(HTML_HEAD_MODE, null, subtreeScope, null);
      }
      break;
    case 'html':
      if (parentContext.insertionMode === ROOT_HTML_MODE) {
        return createFormatContext(HTML_HTML_MODE, null, subtreeScope, null);
      }
      break;
  }
  if (parentContext.insertionMode >= HTML_TABLE_MODE) {
    // 标签既非表格父级也非特殊父级，说明已经回到普通 HTML。
    return createFormatContext(HTML_MODE, null, subtreeScope, null);
  }
  if (parentContext.insertionMode < HTML_MODE) {
    return createFormatContext(HTML_MODE, null, subtreeScope, null);
  }
  if (enableViewTransition) {
    if (parentContext.viewTransition !== null) {
      // 无论当前元素为何，ViewTransition 上下文都会被首个实例消费。
      return createFormatContext(
        parentContext.insertionMode,
        parentContext.selectedValue,
        subtreeScope,
        null,
      );
    }
  }
  if (parentContext.tagScope !== subtreeScope) {
    return createFormatContext(
      parentContext.insertionMode,
      parentContext.selectedValue,
      subtreeScope,
      null,
    );
  }
  return parentContext;
}

/**
 * 把包裹 Suspense 的父 ViewTransition 投影为 fallback/content 可共享的上下文。
 * enter/exit 在边界状态切换中有歧义，因此禁用；update 改映射为同名 share。
 */
function getSuspenseViewTransition(
  parentViewTransition: null | ViewTransitionContext,
): null | ViewTransitionContext {
  if (parentViewTransition === null) {
    return null;
  }
  // 父 ViewTransition 同时覆盖 fallback 与 content 的子实例。实例级表示无法区分父级
  // enter/exit/share 与 Suspense 自身状态切换；fallback 换 content 的 update 也无法直接表示，
  // 但可给两侧分配同名并将其建模为 share。
  const viewTransition: ViewTransitionContext = {
    update: parentViewTransition.update, // 仍允许更深层子树更新。
    enter: 'none',
    exit: 'none',
    share: parentViewTransition.update, // 用于揭示时的退出/进入配对。
    parentEnter: 'none',
    parentExit: 'none',
    name: parentViewTransition.autoName,
    autoName: parentViewTransition.autoName,
    // TODO：若 ViewTransition 除该 Suspense 外还有其他子节点，父级需隔离名称避免冲突。
    nameIdx: 0,
  };
  return viewTransition;
}

/** 创建 Suspense fallback 上下文，并在 update 动画可能受揭示影响时请求升级指令。 */
export function getSuspenseFallbackFormatContext(
  resumableState: ResumableState,
  parentContext: FormatContext,
): FormatContext {
  if (parentContext.tagScope & UPDATE_SCOPE) {
    // fallback 位于未禁用 update 的 ViewTransition 内时，揭示可能动画父级，需发送升级指令。
    resumableState.instructions |= NeedUpgradeToViewTransitions;
  }
  return createFormatContext(
    parentContext.insertionMode,
    parentContext.selectedValue,
    parentContext.tagScope | FALLBACK_SCOPE | EXIT_SCOPE,
    getSuspenseViewTransition(parentContext.viewTransition),
  );
}

/** 创建 Suspense content 上下文，并标记首个实例可 enter 或参与 share。 */
export function getSuspenseContentFormatContext(
  resumableState: ResumableState,
  parentContext: FormatContext,
): FormatContext {
  const viewTransition = getSuspenseViewTransition(
    parentContext.viewTransition,
  );
  let subtreeScope = parentContext.tagScope | ENTER_SCOPE;
  if (viewTransition !== null && viewTransition.share !== 'none') {
    // 包裹 Suspense 的 ViewTransition 会把出现动画像 enter 一样应用，标记为正在出现。
    subtreeScope |= APPEARING_SCOPE;
  }
  return createFormatContext(
    parentContext.insertionMode,
    parentContext.selectedValue,
    subtreeScope,
    viewTransition,
  );
}

/**
 * 规范化ViewTransition的名称、enter/exit/share并构造子树作用域。父级enter/exit只在本级对应值严格为undefined或none时消费，null不能简单等同该分支。需动画的首个fallback/content宿主会使用共享nameIdx生成名称；share或相关动画要求客户端升级，暂停重试对计数的影响仍由下方TODO描述。
 */
export function getViewTransitionFormatContext(
  resumableState: ResumableState,
  parentContext: FormatContext,
  update: ?string,
  enter: ?string,
  exit: ?string,
  share: ?string,
  parentEnter: ?string,
  parentExit: ?string,
  hasParentEnterHandler: boolean,
  hasParentExitHandler: boolean,
  name: ?string,
  autoName: string, // 显式名称或自动生成的唯一名称。
): FormatContext {
  // 进入 <ViewTransition> 时先规范化属性。
  if (update == null) {
    update = 'auto';
  }
  if (enter == null) {
    enter = 'auto';
  }
  if (exit == null) {
    exit = 'auto';
  }
  if (name == null) {
    const parentViewTransition = parentContext.viewTransition;
    if (parentViewTransition !== null) {
      // 嵌套 ViewTransition 中，父级有 share 而子级无显式名称时仍可能触发共享场景，
      // 因此复用父级名称和 share。
      name = parentViewTransition.name;
      share = parentViewTransition.share;
    } else {
      name = 'auto';
      share = 'none'; // share 仅对显式名称有意义。
    }
  } else {
    if (share == null) {
      share = 'auto';
    }
    if (parentContext.tagScope & FALLBACK_SCOPE) {
      // fallback 内显式命名且未禁用 share 时，可能与 content 配对，需要升级指令。
      resumableState.instructions |= NeedUpgradeToViewTransitions;
    }
  }
  if (!(parentContext.tagScope & EXIT_SCOPE)) {
    exit = 'none'; // exit 只对 fallback 内首个 ViewTransition 有意义。
  } else {
    resumableState.instructions |= NeedUpgradeToViewTransitions;
  }
  if (!(parentContext.tagScope & ENTER_SCOPE)) {
    enter = 'none'; // enter 只对 content 内首个 ViewTransition 有意义。
  } else {
    resumableState.instructions |= NeedUpgradeToViewTransitions;
  }
  let resolvedParentEnter = 'none';
  let resolvedParentExit = 'none';
  if (enableViewTransitionParentEnterExit) {
    if (
      parentEnter != null &&
      (parentContext.tagScope & PARENT_ENTER_SCOPE) !== 0
    ) {
      resolvedParentEnter = parentEnter;
    }
    if (
      parentExit != null &&
      (parentContext.tagScope & PARENT_EXIT_SCOPE) !== 0
    ) {
      resolvedParentExit = parentExit;
    }
  }
  const viewTransition: ViewTransitionContext = {
    update,
    enter,
    exit,
    share,
    parentEnter: resolvedParentEnter,
    parentExit: resolvedParentExit,
    name,
    autoName,
    nameIdx: 0,
  };
  let subtreeScope = parentContext.tagScope & SUBTREE_SCOPE;
  if (update !== 'none') {
    subtreeScope |= UPDATE_SCOPE;
  } else {
    subtreeScope &= ~UPDATE_SCOPE;
  }
  if (enter !== 'none') {
    subtreeScope |= APPEARING_SCOPE;
  }
  if (enableViewTransitionParentEnterExit) {
    // 父 enter 传播：自身正在进入的 ViewTransition 为子树开启传播；嵌套 transition
    // 只要 parentEnter 未解析为 none，或有 onParentEnter handler，就继续传播。
    // 缺省且无 handler、或显式 none 会截断后代参与；与 commitParentEnterViewTransitions 对齐。
    if (enter !== 'none') {
      subtreeScope |= PARENT_ENTER_SCOPE;
    } else if (
      (parentContext.tagScope & PARENT_ENTER_SCOPE) !== 0 &&
      (parentEnter === 'none' ||
        (parentEnter === undefined && !hasParentEnterHandler))
    ) {
      subtreeScope &= ~PARENT_ENTER_SCOPE;
    }
    // 父 exit 传播与上面的 enter 传播对称。
    if (exit !== 'none') {
      subtreeScope |= PARENT_EXIT_SCOPE;
    } else if (
      (parentContext.tagScope & PARENT_EXIT_SCOPE) !== 0 &&
      (parentExit === 'none' ||
        (parentExit === undefined && !hasParentExitHandler))
    ) {
      subtreeScope &= ~PARENT_EXIT_SCOPE;
    }
  }
  return createFormatContext(
    parentContext.insertionMode,
    parentContext.selectedValue,
    subtreeScope,
    viewTransition,
  );
}

/** 判断当前格式上下文是否正在收集 head preamble。 */
export function isPreambleContext(formatContext: FormatContext): boolean {
  return formatContext.insertionMode === HTML_HEAD_MODE;
}

/**
 * 根据响应 idPrefix、树路径和同 fiber 的局部序号生成稳定水合 id。
 * 首个 useId 省略局部后缀，后续序号用 32 进制压缩。
 */
export function makeId(
  resumableState: ResumableState,
  treeId: string,
  localId: number,
): string {
  const idPrefix = resumableState.idPrefix;

  let id = '_' + idPrefix + 'R_' + treeId;

  // 除该层首个 id 外，追加 useId Hook 在当前 fiber 中的位置。
  if (localId > 0) {
    id += 'H' + localId.toString(32);
  }

  return id + '_';
}

/** 把文本节点内容转为 HTML 安全字符串。 */
function encodeHTMLTextNode(text: string): string {
  return escapeTextForBrowser(text);
}

/** 相邻文本节点间的空注释分隔块，帮助水合恢复节点边界。 */
const textSeparator = stringToPrecomputedChunk('<!-- -->');

/**
 * 写入一个文本实例；相邻嵌入文本前插入分隔注释，空文本不产生 DOM 节点。
 * 返回值表示输出末尾是否仍是文本节点。
 */
export function pushTextInstance(
  target: Array<Chunk | PrecomputedChunk>,
  text: string,
  renderState: RenderState,
  textEmbedded: boolean,
): boolean {
  if (text === '') {
    // 空文本没有 DOM 节点表示，水合逻辑已知这一点。
    return textEmbedded;
  }
  if (textEmbedded) {
    target.push(textSeparator);
  }
  target.push(stringToChunk(encodeHTMLTextNode(text)));
  return true;
}

/** Segment 完成时在边界不确定的相邻文本后补分隔注释，避免水合合并节点。 */
export function pushSegmentFinale(
  target: Array<Chunk | PrecomputedChunk>,
  renderState: RenderState,
  lastPushedText: boolean,
  textEmbedded: boolean,
): void {
  if (lastPushedText && textEmbedded) {
    target.push(textSeparator);
  }
}

/**
 * 把尚未被首个 DOM 实例消费的 ViewTransition 上下文编码为 `vt-*` 属性。
 * 显式名称按同 transition 子节点序号去重；属性写入后由子上下文清除。
 */
function pushViewTransitionAttributes(
  target: Array<Chunk | PrecomputedChunk>,
  formatContext: FormatContext,
): void {
  if (!enableViewTransition) {
    return;
  }
  const viewTransition = formatContext.viewTransition;
  if (viewTransition === null) {
    return;
  }
  if (viewTransition.name !== 'auto') {
    pushStringAttribute(
      target,
      'vt-name',
      viewTransition.nameIdx === 0
        ? viewTransition.name
        : viewTransition.name + '_' + viewTransition.nameIdx,
    );
    // 同一 ViewTransition 可能有多个子节点，因此递增序号。该写操作发生在 render 中；
    // 理想情况下应像表单一样在挂起点之后调用，避免每次尝试都递增。TODO：改为确定性分配。
    viewTransition.nameIdx++;
  }
  pushStringAttribute(target, 'vt-update', viewTransition.update);
  if (viewTransition.enter !== 'none') {
    pushStringAttribute(target, 'vt-enter', viewTransition.enter);
  }
  if (viewTransition.exit !== 'none') {
    pushStringAttribute(target, 'vt-exit', viewTransition.exit);
  }
  if (viewTransition.share !== 'none') {
    pushStringAttribute(target, 'vt-share', viewTransition.share);
  }
  if (
    enableViewTransitionParentEnterExit &&
    viewTransition.parentEnter !== 'none'
  ) {
    pushStringAttribute(target, 'vt-parent-enter', viewTransition.parentEnter);
  }
  if (
    enableViewTransitionParentEnterExit &&
    viewTransition.parentExit !== 'none'
  ) {
    pushStringAttribute(target, 'vt-parent-exit', viewTransition.parentExit);
  }
}

/** camelCase style 名到已转义连字符块的进程级缓存。 */
const styleNameCache: Map<string, PrecomputedChunk> = new Map();
/** 取得或创建规范 CSS 属性名块，避免重复转换与转义。 */
function processStyleName(styleName: string): PrecomputedChunk {
  const chunk = styleNameCache.get(styleName);
  if (chunk !== undefined) {
    return chunk;
  }
  const result = stringToPrecomputedChunk(
    escapeTextForBrowser(hyphenateStyleName(styleName)),
  );
  styleNameCache.set(styleName, result);
  return result;
}

/** style 属性起始块。 */
const styleAttributeStart = stringToPrecomputedChunk(' style="');
/** CSS 声明名值分隔块。 */
const styleAssign = stringToPrecomputedChunk(':');
/** CSS 声明间分隔块。 */
const styleSeparator = stringToPrecomputedChunk(';');

/**
 * 把style对象的自有可枚举属性序列化为一个HTML style属性。null、布尔及空字符串省略；--自定义属性保留名称并字符串化，其余名称经缓存连字符化，非零且非unitless的number补px，bigint不补px。字符串trim后再转义；转换异常向上抛出，并不在此逐属性恢复。
 */
function pushStyleAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  style: Object,
): void {
  if (typeof style !== 'object') {
    throw new Error(
      'The `style` prop expects a mapping from style properties to values, ' +
        "not a string. For example, style={{marginRight: spacing + 'em'}} when " +
        'using JSX.',
    );
  }

  let isFirst = true;
  for (const styleName in style) {
    if (!hasOwnProperty.call(style, styleName)) {
      continue;
    }
    // 这里若传入不安全用户数据可能注入任意 CSS（尚无法复现）：
    // https://www.owasp.org/index.php/XSS_Filter_Evasion_Cheat_Sheet
    // http://www.thespanner.co.uk/2007/11/26/ultimate-xss-css-injection/
    // 这不是 XSS 漏洞，而是潜在 CSS 注入；后续 URL 信任模型讨论见 #2115901。
    const styleValue = style[styleName];
    if (
      styleValue == null ||
      typeof styleValue === 'boolean' ||
      styleValue === ''
    ) {
      // TODO：过去会把空字符串写成空 style 值；需确认是否存在合理场景。
      continue;
    }

    let nameChunk;
    let valueChunk;
    const isCustomProperty = styleName.indexOf('--') === 0;
    if (isCustomProperty) {
      nameChunk = stringToChunk(escapeTextForBrowser(styleName));
      if (__DEV__) {
        checkCSSPropertyStringCoercion(styleValue, styleName);
      }
      valueChunk = stringToChunk(
        escapeTextForBrowser(('' + styleValue).trim()),
      );
    } else {
      if (__DEV__) {
        warnValidStyle(styleName, styleValue);
      }

      nameChunk = processStyleName(styleName);
      if (typeof styleValue === 'number') {
        if (styleValue !== 0 && !isUnitlessNumber(styleName)) {
          valueChunk = stringToChunk(styleValue + 'px'); // 非零且需单位的数值默认追加 px。
        } else {
          valueChunk = stringToChunk('' + styleValue);
        }
      } else {
        if (__DEV__) {
          checkCSSPropertyStringCoercion(styleValue, styleName);
        }
        valueChunk = stringToChunk(
          escapeTextForBrowser(('' + styleValue).trim()),
        );
      }
    }
    if (isFirst) {
      isFirst = false;
      // 首项前无需分号分隔。
      target.push(styleAttributeStart, nameChunk, styleAssign, valueChunk);
    } else {
      target.push(styleSeparator, nameChunk, styleAssign, valueChunk);
    }
  }
  if (!isFirst) {
    target.push(attributeEnd);
  }
}

/** HTML 属性之间的空格块。 */
const attributeSeparator = stringToPrecomputedChunk(' ');
/** 普通属性赋值起始块。 */
const attributeAssign = stringToPrecomputedChunk('="');
/** 属性值结束引号块。 */
const attributeEnd = stringToPrecomputedChunk('"');
/** 布尔真属性的空字符串赋值块。 */
const attributeEmptyString = stringToPrecomputedChunk('=""');

/** 为 truthy 且可序列化的值写入 HTML 布尔属性。 */
function pushBooleanAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  name: string,
  value: string | boolean | number | Function | Object, // 不含 null/undefined。
): void {
  if (value && typeof value !== 'function' && typeof value !== 'symbol') {
    target.push(attributeSeparator, stringToChunk(name), attributeEmptyString);
  }
}

/** 为非函数、非 Symbol、非 boolean 值写入转义后的字符串属性。 */
function pushStringAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  name: string,
  value: string | boolean | number | Function | Object, // 不含 null/undefined。
): void {
  if (
    typeof value !== 'function' &&
    typeof value !== 'symbol' &&
    typeof value !== 'boolean'
  ) {
    target.push(
      attributeSeparator,
      stringToChunk(name),
      attributeAssign,
      stringToChunk(escapeTextForBrowser(value)),
      attributeEnd,
    );
  }
}

/** 为渐进增强表单 action 分配当前响应内唯一字段名前缀。 */
function makeFormFieldPrefix(resumableState: ResumableState): string {
  // TODO：改为确定性分配。
  const id = resumableState.nextFormID++;
  return resumableState.idPrefix + id;
}

/**
 * 函数 form action 的 javascript: 占位 URL；HTML 中会高频重复，因此消息比客户端更短且可搜索。
 */
const actionJavaScriptURL = stringToPrecomputedChunk(
  escapeTextForBrowser(
    // eslint-disable-next-line no-script-url
    "javascript:throw new Error('React form unexpectedly submitted.')",
  ),
);

/** 渐进增强附加字段的 hidden input 起始块。 */
const startHiddenInputChunk = stringToPrecomputedChunk('<input type="hidden"');

/** 作为 FormData.forEach 回调，把一个字符串字段序列化为 hidden input。 */
function pushAdditionalFormField(
  this: Array<Chunk | PrecomputedChunk>,
  value: string | File,
  key: string,
): void {
  const target: Array<Chunk | PrecomputedChunk> = this;
  target.push(startHiddenInputChunk);
  validateAdditionalFormField(value, key);
  pushStringAttribute(target, 'name', key);
  pushStringAttribute(target, 'value', value);
  target.push(endOfStartTagSelfClosing);
}

/** 把 action 编码产生的全部附加 FormData 字段写入目标块。 */
function pushAdditionalFormFields(
  target: Array<Chunk | PrecomputedChunk>,
  formData: void | null | FormData,
) {
  if (formData != null) {
    // $FlowFixMe[prop-missing]：FormData 实际提供 forEach。
    formData.forEach(pushAdditionalFormField, target);
  }
}

/** 渐进表单暂不支持 File/Blob 附加字段，遇到时触发客户端水合降级。 */
function validateAdditionalFormField(value: string | File, key: string): void {
  if (typeof value !== 'string') {
    throw new Error(
      'File/Blob fields are not yet supported in progressive forms. ' +
        'Will fallback to client hydration.',
    );
  }
}

/** 验证 FormData 的每一项都可由渐进表单的 hidden input 表示。 */
function validateAdditionalFormFields(formData: void | null | FormData) {
  if (formData != null) {
    // $FlowFixMe[prop-missing]：FormData 实际提供 forEach。
    formData.forEach(validateAdditionalFormField);
  }
  return formData;
}

/**
 * 调用函数action的$$FORM_ACTION编码器，取得action、method、encType与字符串FormData。先分配表单前缀，失败不回滚计数；编码器若抛出非空对象thenable则向上重抛以挂起，其它错误在DEV报告后返回null，由调用者写客户端提交重放协议。File/Blob字段不能成为隐藏input，会在校验时降级。
 */
function getCustomFormFields(
  resumableState: ResumableState,
  formAction: any,
): null | ReactCustomFormAction {
  const customAction = formAction.$$FORM_ACTION;
  if (typeof customAction === 'function') {
    const prefix = makeFormFieldPrefix(resumableState);
    try {
      const customFields = formAction.$$FORM_ACTION(prefix);
      if (customFields) {
        validateAdditionalFormFields(customFields.data);
      }
      return customFields;
    } catch (x) {
      if (typeof x === 'object' && x !== null && typeof x.then === 'function') {
        // 重新抛出 Suspense thenable。
        throw x;
      }
      // 渐进增强编码失败时不让整页失败，而是退回客户端重放；客户端环境可能成功。
      if (__DEV__) {
        // TODO：是否应作为可恢复错误上报？
        console.error(
          'Failed to serialize an action for progressive enhancement:\n%s',
          x,
        );
      }
    }
  }
  return null;
}

/**
 * 序列化 button/input 的 formAction 及相关覆盖属性。
 * 函数 action 优先使用服务端渐进增强字段，否则写入占位 URL 并注入客户端重放 runtime。
 */
function pushFormActionAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  resumableState: ResumableState,
  renderState: RenderState,
  formAction: any,
  formEncType: any,
  formMethod: any,
  formTarget: any,
  name: any,
): void | null | FormData {
  let formData = null;
  if (typeof formAction === 'function') {
    // 函数 form action 不能自行控制这些表单属性。
    if (__DEV__) {
      if (name !== null && !didWarnFormActionName) {
        didWarnFormActionName = true;
        console.error(
          'Cannot specify a "name" prop for a button that specifies a function as a formAction. ' +
            'React needs it to encode which action should be invoked. It will get overridden.',
        );
      }
      if (
        (formEncType !== null || formMethod !== null) &&
        !didWarnFormActionMethod
      ) {
        didWarnFormActionMethod = true;
        console.error(
          'Cannot specify a formEncType or formMethod for a button that specifies a ' +
            'function as a formAction. React provides those automatically. They will get overridden.',
        );
      }
      if (formTarget !== null && !didWarnFormActionTarget) {
        didWarnFormActionTarget = true;
        console.error(
          'Cannot specify a formTarget for a button that specifies a function as a formAction. ' +
            'The function will always be executed in the same window.',
        );
      }
    }
    const customFields = getCustomFormFields(resumableState, formAction);
    if (customFields !== null) {
      // 该 action 提供渐进增强编码，可在水合前把表单提交回服务端，例如 Server Action。
      name = customFields.name;
      formAction = customFields.action || '';
      formEncType = customFields.encType;
      formMethod = customFields.method;
      formTarget = customFields.target;
      formData = customFields.data;
    } else {
      // 写入无业务副作用的 javascript URL。Fizz runtime 通常会 preventDefault；手动提交或
      // React 收到事件前 stopPropagation 才可能访问它。CSP 阻止 javascript: 也可接受，只是不显示错误。
      target.push(
        attributeSeparator,
        stringToChunk('formAction'),
        attributeAssign,
        actionJavaScriptURL,
        attributeEnd,
      );
      name = null;
      formAction = null;
      formEncType = null;
      formMethod = null;
      formTarget = null;
      injectFormReplayingRuntime(resumableState, renderState);
    }
  }
  if (name != null) {
    pushAttribute(target, 'name', name);
  }
  if (formAction != null) {
    pushAttribute(target, 'formAction', formAction);
  }
  if (formEncType != null) {
    pushAttribute(target, 'formEncType', formEncType);
  }
  if (formMethod != null) {
    pushAttribute(target, 'formMethod', formMethod);
  }
  if (formTarget != null) {
    pushAttribute(target, 'formTarget', formTarget);
  }
  return formData;
}

/** Blob 到 data URL thenable 的进程级弱缓存，避免 Suspense 重试重复读取。 */
let blobCache: null | WeakMap<Blob, Thenable<string>> = null;

/**
 * 以Blob身份在进程级WeakMap复用readAsDataURL的thenable，让同一对象的Suspense重试只启动一次读取。完成回调写status/value或reason；未完成抛该thenable，失败重抛缓存原因，成功把data URL作为src属性转义输出。请求结束或abort不会在此取消读取或清理该弱缓存。
 */
function pushSrcObjectAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  blob: Blob,
): void {
  // 通过抛 Promise 风格读取 Blob 内容，让 Fizz 暂停当前 segment。
  if (blobCache === null) {
    blobCache = new WeakMap();
  }
  const suspenseCache: WeakMap<Blob, Thenable<string>> = blobCache;
  let thenable = suspenseCache.get(blob);
  if (thenable === undefined) {
    thenable = readAsDataURL(blob) as any as Thenable<string>;
    thenable.then(
      /** 保存data URL与完成状态；挂起segment重试时读取同一thenable的value。 */
      result => {
        (thenable as any).status = 'fulfilled';
        (thenable as any).value = result;
      },
      /** 保存失败原因，后续同Blob重试直接抛该原因，不重新发起读取。 */
      error => {
        (thenable as any).status = 'rejected';
        (thenable as any).reason = error;
      },
    );
    suspenseCache.set(blob, thenable);
  }
  if (thenable.status === 'rejected') {
    throw thenable.reason;
  } else if (thenable.status !== 'fulfilled') {
    throw thenable;
  }
  const url = thenable.value;
  target.push(
    attributeSeparator,
    stringToChunk('src'),
    attributeAssign,
    stringToChunk(escapeTextForBrowser(url)),
    attributeEnd,
  );
}

/**
 * 将非空prop编码到HTML Chunk，按名称处理别名、src/href URL净化、Blob src读取及布尔/枚举/数值约束。通用分支过滤事件前缀、函数和symbol，布尔值仅为data-/aria-保留；专用form与自定义元素有独立编码器，不能把这里的过滤规则推广到那些路径。字符串转换或Blob读取可向上抛错/挂起。
 */
function pushAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  name: string,
  value: string | boolean | number | Function | Object, // 不含 null/undefined。
): void {
  switch (name) {
    // 高频 props 放在 switch 前部。TODO：aria-label 同样高频，但允许 boolean，
    // 与其他项语义不同；理想情况下仍应加入热路径。
    case 'className': {
      pushStringAttribute(target, 'class', value);
      break;
    }
    case 'tabIndex': {
      pushStringAttribute(target, 'tabindex', value);
      break;
    }
    case 'dir':
    case 'role':
    case 'viewBox':
    case 'width':
    case 'height': {
      pushStringAttribute(target, name, value);
      break;
    }
    case 'style': {
      pushStyleAttribute(target, value);
      return;
    }
    case 'src': {
      // $FlowFixMe[invalid-compare]
      if (enableSrcObject && typeof value === 'object' && value !== null) {
        if (typeof Blob === 'function' && value instanceof Blob) {
          pushSrcObjectAttribute(target, value);
          return;
        }
      }
      // Fallthrough：继续走通用 URL 处理。
    }
    case 'href': {
      if (value === '') {
        if (__DEV__) {
          if (name === 'src') {
            console.error(
              'An empty string ("") was passed to the %s attribute. ' +
                'This may cause the browser to download the whole page again over the network. ' +
                'To fix this, either do not render the element at all ' +
                'or pass null to %s instead of an empty string.',
              name,
              name,
            );
          } else {
            console.error(
              'An empty string ("") was passed to the %s attribute. ' +
                'To fix this, either do not render the element at all ' +
                'or pass null to %s instead of an empty string.',
              name,
              name,
            );
          }
        }
        return;
      }
    }
    // Fall through：action/formAction 允许保留空字符串。
    case 'action':
    case 'formAction': {
      // TODO：考虑只在各自支持的标签中执行特殊处理。
      if (
        value == null ||
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        typeof value === 'boolean'
      ) {
        return;
      }
      if (__DEV__) {
        checkAttributeStringCoercion(value, name);
      }
      const sanitizedValue = sanitizeURL('' + value);
      target.push(
        attributeSeparator,
        stringToChunk(name),
        attributeAssign,
        stringToChunk(escapeTextForBrowser(sanitizedValue)),
        attributeEnd,
      );
      return;
    }
    case 'defaultValue':
    case 'defaultChecked': // 通用 HTML 元素不应输出这些属性。
    case 'innerHTML': // 必须改用 dangerouslySetInnerHTML。
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'ref':
      // 忽略：这些是 React 客户端内建语义。
      return;
    case 'autoFocus':
    case 'multiple':
    case 'muted': {
      pushBooleanAttribute(target, name.toLowerCase(), value);
      return;
    }
    case 'xlinkHref': {
      if (
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        typeof value === 'boolean'
      ) {
        return;
      }
      if (__DEV__) {
        checkAttributeStringCoercion(value, name);
      }
      const sanitizedValue = sanitizeURL('' + value);
      target.push(
        attributeSeparator,
        stringToChunk('xlink:href'),
        attributeAssign,
        stringToChunk(escapeTextForBrowser(sanitizedValue)),
        attributeEnd,
      );
      return;
    }
    case 'contentEditable':
    case 'spellCheck':
    case 'draggable':
    case 'value':
    case 'autoReverse':
    case 'externalResourcesRequired':
    case 'focusable':
    case 'preserveAlpha': {
      // Booleanish String：这些枚举属性接受 "true"/"false"。虽非真正布尔属性，
      // React 仍允许传 boolean 并把它字符串化。
      if (typeof value !== 'function' && typeof value !== 'symbol') {
        target.push(
          attributeSeparator,
          stringToChunk(name),
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd,
        );
      }
      return;
    }
    case 'inert': {
      if (__DEV__) {
        if (value === '' && !didWarnForNewBooleanPropsWithEmptyValue[name]) {
          didWarnForNewBooleanPropsWithEmptyValue[name] = true;
          console.error(
            'Received an empty string for a boolean attribute `%s`. ' +
              'This will treat the attribute as if it were false. ' +
              'Either pass `false` to silence this warning, or ' +
              'pass `true` if you used an empty string in earlier versions of React to indicate this attribute is true.',
            name,
          );
        }
      }
    }
    // Fallthrough：其余布尔 prop 不需要空字符串专用警告。
    case 'allowFullScreen':
    case 'async':
    case 'autoPlay':
    case 'controls':
    case 'credentialless':
    case 'default':
    case 'defer':
    case 'disabled':
    case 'disablePictureInPicture':
    case 'disableRemotePlayback':
    case 'formNoValidate':
    case 'hidden':
    case 'loop':
    case 'noModule':
    case 'noValidate':
    case 'open':
    case 'playsInline':
    case 'readOnly':
    case 'required':
    case 'reversed':
    case 'scoped':
    case 'seamless':
    case 'itemScope': {
      // 标准布尔属性。
      if (value && typeof value !== 'function' && typeof value !== 'symbol') {
        target.push(
          attributeSeparator,
          stringToChunk(name),
          attributeEmptyString,
        );
      }
      return;
    }
    case 'capture':
    case 'download': {
      // 重载布尔属性：true 写空值，false 忽略，其他值按字符串写出。
      if (value === true) {
        target.push(
          attributeSeparator,
          stringToChunk(name),
          attributeEmptyString,
        );
      } else if (value === false) {
        // false 表示忽略该属性。
      } else if (typeof value !== 'function' && typeof value !== 'symbol') {
        target.push(
          attributeSeparator,
          stringToChunk(name),
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd,
        );
      }
      return;
    }
    case 'cols':
    case 'rows':
    case 'size':
    case 'span': {
      // 这些 HTML 属性必须是正数。
      if (
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        !isNaN(value) &&
        (value as any) >= 1
      ) {
        target.push(
          attributeSeparator,
          stringToChunk(name),
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd,
        );
      }
      return;
    }
    case 'rowSpan':
    case 'start': {
      // 这些 HTML 属性必须是数值。
      if (
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        !isNaN(value)
      ) {
        target.push(
          attributeSeparator,
          stringToChunk(name),
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd,
        );
      }
      return;
    }
    case 'xlinkActuate':
      pushStringAttribute(target, 'xlink:actuate', value);
      return;
    case 'xlinkArcrole':
      pushStringAttribute(target, 'xlink:arcrole', value);
      return;
    case 'xlinkRole':
      pushStringAttribute(target, 'xlink:role', value);
      return;
    case 'xlinkShow':
      pushStringAttribute(target, 'xlink:show', value);
      return;
    case 'xlinkTitle':
      pushStringAttribute(target, 'xlink:title', value);
      return;
    case 'xlinkType':
      pushStringAttribute(target, 'xlink:type', value);
      return;
    case 'xmlBase':
      pushStringAttribute(target, 'xml:base', value);
      return;
    case 'xmlLang':
      pushStringAttribute(target, 'xml:lang', value);
      return;
    case 'xmlSpace':
      pushStringAttribute(target, 'xml:space', value);
      return;
    default:
      if (
        // shouldIgnoreAttribute：前面已经过滤 null/undefined 和保留词。
        name.length > 2 &&
        (name[0] === 'o' || name[0] === 'O') &&
        (name[1] === 'n' || name[1] === 'N')
      ) {
        return;
      }

      const attributeName = getAttributeAlias(name);
      if (isAttributeNameSafe(attributeName)) {
        // shouldRemoveAttribute：函数/Symbol 及非 data/aria boolean 不输出。
        switch (typeof value) {
          case 'function':
          case 'symbol':
            return;
          case 'boolean': {
            const prefix = attributeName.toLowerCase().slice(0, 5);
            if (prefix !== 'data-' && prefix !== 'aria-') {
              return;
            }
          }
        }
        target.push(
          attributeSeparator,
          stringToChunk(attributeName),
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd,
        );
      }
  }
}

/** 普通开始标签闭合块。 */
const endOfStartTag = stringToPrecomputedChunk('>');
/** 自闭合标签结束块。 */
const endOfStartTagSelfClosing = stringToPrecomputedChunk('/>');

/** 校验 dangerouslySetInnerHTML 与 children 互斥，并把原始 HTML 内容直接写入目标。 */
function pushInnerHTML(
  target: Array<Chunk | PrecomputedChunk>,
  innerHTML: any,
  children: any,
) {
  if (innerHTML != null) {
    if (children != null) {
      throw new Error(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
      );
    }

    if (typeof innerHTML !== 'object' || !('__html' in innerHTML)) {
      throw new Error(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://react.dev/link/dangerously-set-inner-html ' +
          'for more information.',
      );
    }

    const html = innerHTML.__html;
    if (html !== null && html !== undefined) {
      if (__DEV__) {
        checkHtmlStringCoercion(html);
      }
      target.push(stringToChunk('' + html));
    }
  }
}

// TODO：把以下警告标记移到 RenderState，使每个请求都能报告；这有助于调试有状态服务端（如 Service Worker）。
/** 是否已警告 input 同时提供 value/defaultValue。 */
let didWarnDefaultInputValue = false;
/** 是否已警告 input 同时提供 checked/defaultChecked。 */
let didWarnDefaultChecked = false;
/** 是否已警告 select 同时提供 value/defaultValue。 */
let didWarnDefaultSelectValue = false;
/** 是否已警告 textarea 同时提供 value/defaultValue。 */
let didWarnDefaultTextareaValue = false;
/** 是否已警告 option 包含无法推断 value 的复杂 children。 */
let didWarnInvalidOptionChildren = false;
/** 是否已警告 option 在无 value 时使用 innerHTML。 */
let didWarnInvalidOptionInnerHTML = false;
/** 是否已警告直接给 option 设置 selected。 */
let didWarnSelectedSetOnOption = false;
/** 是否已警告 formAction 与不支持的标签 type 组合。 */
let didWarnFormActionType = false;
/** 是否已警告函数 formAction 同时指定 name。 */
let didWarnFormActionName = false;
/** 是否已警告函数 form action 同时指定 target。 */
let didWarnFormActionTarget = false;
/** 是否已警告函数 form action 同时指定 method/encType。 */
let didWarnFormActionMethod = false;

/** 校验 select 的 value/defaultValue 是否与 multiple 所需标量/数组形状一致。 */
function checkSelectProp(props: any, propName: string) {
  if (__DEV__) {
    const value = props[propName];
    if (value != null) {
      const array = isArray(value);
      if (props.multiple && !array) {
        console.error(
          'The `%s` prop supplied to <select> must be an array if ' +
            '`multiple` is true.',
          propName,
        );
      } else if (!props.multiple && array) {
        console.error(
          'The `%s` prop supplied to <select> must be a scalar ' +
            'value if `multiple` is false.',
          propName,
        );
      }
    }
  }
}

/** 序列化 `<a>` 起始标签；空 href 在 anchor 上合法，字符串 child 走无分隔优化。 */
function pushStartAnchor(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag('a'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'href':
          if (propValue === '') {
            // anchor 的空 href 是特例，直接写出；其他标签应产生警告。
            pushStringAttribute(target, 'href', '');
          } else {
            pushAttribute(target, propKey, propValue);
          }
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    // 字符串 child 直接写入以省略多余分隔注释；TODO：通用优化落地后移除此特例。
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }
  return children;
}

/** 序列化 `<object>`，对 data URL 执行与其他资源 URL 相同的安全过滤。 */
function pushStartObject(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag('object'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'data': {
          if (__DEV__) {
            checkAttributeStringCoercion(propValue, 'data');
          }
          const sanitizedValue = sanitizeURL('' + propValue);
          if (sanitizedValue === '') {
            if (__DEV__) {
              console.error(
                'An empty string ("") was passed to the %s attribute. ' +
                  'To fix this, either do not render the element at all ' +
                  'or pass null to %s instead of an empty string.',
                propKey,
                propKey,
              );
            }
            break;
          }
          target.push(
            attributeSeparator,
            stringToChunk('data'),
            attributeAssign,
            stringToChunk(escapeTextForBrowser(sanitizedValue)),
            attributeEnd,
          );
          break;
        }
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    // 字符串 child 直接写入以省略多余分隔注释；TODO：通用优化落地后移除此特例。
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }
  return children;
}

/**
 * 编码select起始标签而不写value/defaultValue属性；Fizz随后依据同一props创建子FormatContext，把非null受控值优先于默认值传给option判定。此函数返回尚需遍历的children，自己不修改formatContext。
 */
function pushStartSelect(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  formatContext: FormatContext,
): ReactNodeList {
  if (__DEV__) {
    checkControlledValueProps('select', props);

    checkSelectProp(props, 'value');
    checkSelectProp(props, 'defaultValue');

    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnDefaultSelectValue
    ) {
      console.error(
        'Select elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled select ' +
          'element and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
      );
      didWarnDefaultSelectValue = true;
    }
  }

  target.push(startChunkForTag('select'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          // TODO：select 的 innerHTML 无法应用受控 value，因此该组合语义并不合理。
          innerHTML = propValue;
          break;
        case 'defaultValue':
        case 'value':
          // 值保存在 Context 中，由嵌套 option 应用。
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

/**
 * 用Children.forEach扁平遍历option原始children，再以content += child做JavaScript字符串转换。布尔/null由Children视为空值，普通对象可在遍历时被拒绝；React元素在这里不会执行组件，复杂节点只发一次DEV诊断，因此需显式value才能可靠比较选择值。
 */
function flattenOptionChildren(children: mixed): string {
  let content = '';
  // Children决定遍历/空值规则；每个有效项再由下方+=进行JavaScript字符串转换，不执行React元素。
  Children.forEach(children as any, function (child) {
    if (child == null) {
      return;
    }
    content += child as any;
    if (__DEV__) {
      if (
        !didWarnInvalidOptionChildren &&
        typeof child !== 'string' &&
        typeof child !== 'number' &&
        typeof child !== 'bigint'
      ) {
        didWarnInvalidOptionChildren = true;
        console.error(
          'Cannot infer the option value of complex children. ' +
            'Pass a `value` prop or use a plain string as children to <option>.',
        );
      }
    }
  });
  return content;
}

/** 选中 option 的布尔 selected 属性块。 */
const selectedMarkerAttribute = stringToPrecomputedChunk(' selected=""');

/**
 * 编码option并比较父select的非nullselectedValue；数组按字符串化后的每个值匹配，单值直接比较。未显式option.value时才扁平化原始children作候选值；有父选择值时覆盖selected prop，无父值时仍兼容selected。返回children供实际内容渲染，推断值不等于执行复杂子树得到的文本。
 */
function pushStartOption(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  formatContext: FormatContext,
): ReactNodeList {
  const selectedValue = formatContext.selectedValue;

  target.push(startChunkForTag('option'));

  let children = null;
  let value = null;
  let selected = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'selected':
          // 不直接按普通属性处理，只用于兼容选择逻辑。
          selected = propValue;
          if (__DEV__) {
            // TODO：移除 <option> 对 selected 的兼容支持。
            if (!didWarnSelectedSetOnOption) {
              console.error(
                'Use the `defaultValue` or `value` props on <select> instead of ' +
                  'setting `selected` on <option>.',
              );
              didWarnSelectedSetOnOption = true;
            }
          }
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'value':
          value = propValue;
        // fallthrough：同时把 value 写到节点属性。
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  if (selectedValue != null) {
    let stringValue;
    if (value !== null) {
      if (__DEV__) {
        checkAttributeStringCoercion(value, 'value');
      }
      stringValue = '' + value;
    } else {
      if (__DEV__) {
        if (innerHTML !== null) {
          if (!didWarnInvalidOptionInnerHTML) {
            didWarnInvalidOptionInnerHTML = true;
            console.error(
              'Pass a `value` prop if you set dangerouslyInnerHTML so React knows ' +
                'which value should be selected.',
            );
          }
        }
      }
      stringValue = flattenOptionChildren(children);
    }
    if (isArray(selectedValue)) {
      // multiple select：任一候选匹配即可选中。
      for (let i = 0; i < selectedValue.length; i++) {
        if (__DEV__) {
          checkAttributeStringCoercion(selectedValue[i], 'value');
        }
        const v = '' + selectedValue[i];
        if (v === stringValue) {
          target.push(selectedMarkerAttribute);
          break;
        }
      }
    } else {
      if (__DEV__) {
        checkAttributeStringCoercion(selectedValue, 'select.value');
      }
      if ('' + selectedValue === stringValue) {
        target.push(selectedMarkerAttribute);
      }
    }
  } else if (selected) {
    target.push(selectedMarkerAttribute);
  }

  // option 永不直接参与 ViewTransition。
  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

/** 内联表单重放 runtime 的预计算脚本块。 */
const formReplayingRuntimeScript =
  stringToPrecomputedChunk(formReplayingRuntime);

/**
 * 首次遇到客户端重放 action 时注入表单 runtime；外部 runtime 模式已内置，无需输出。
 * 完整文档优先把脚本放在 shell expect 目标处，否则插到 bootstrap 队列头部。
 */
function injectFormReplayingRuntime(
  resumableState: ResumableState,
  renderState: RenderState,
): void {
  // 尚未发送时注入跟踪 JS action 的 runtime，供 Fiber 稍后重放。
  if (
    (resumableState.instructions & SentFormReplayingRuntime) === NothingSent &&
    (!enableFizzExternalRuntime || !renderState.externalRuntimeScript)
  ) {
    resumableState.instructions |= SentFormReplayingRuntime;
    const preamble = renderState.preamble;
    const bootstrapChunks = renderState.bootstrapChunks;
    if (
      (preamble.htmlChunks || preamble.headChunks) &&
      bootstrapChunks.length === 0
    ) {
      // 完整文档已发出需要匹配目标的 rel="expect"；若目标尚未输出，就附在该 script 上。
      bootstrapChunks.push(renderState.startInlineScript);
      pushCompletedShellIdAttribute(bootstrapChunks, resumableState);
      bootstrapChunks.push(
        endOfStartTag,
        formReplayingRuntimeScript,
        endInlineScript,
      );
    } else {
      // 其他情况插到脚本队列开头；代价是它会出现在 shell ID 之前。
      bootstrapChunks.unshift(
        renderState.startInlineScript,
        endOfStartTag,
        formReplayingRuntimeScript,
        endInlineScript,
      );
    }
  }
}

/** 表单状态与服务端标记匹配的水合注释。 */
const formStateMarkerIsMatching = stringToPrecomputedChunk('<!--F!-->');
/** 表单状态与服务端标记不匹配的水合注释。 */
const formStateMarkerIsNotMatching = stringToPrecomputedChunk('<!--F-->');

/** 写入“表单状态匹配”标记。 */
export function pushFormStateMarkerIsMatching(
  target: Array<Chunk | PrecomputedChunk>,
) {
  target.push(formStateMarkerIsMatching);
}

/** 写入“表单状态不匹配”标记。 */
export function pushFormStateMarkerIsNotMatching(
  target: Array<Chunk | PrecomputedChunk>,
) {
  target.push(formStateMarkerIsNotMatching);
}

/**
 * 先收集form属性，再统一处理action，避免属性枚举顺序影响函数action的协议。成功的$$FORM_ACTION元数据覆盖原method/encType/target等并在普通children前输出隐藏字段；不可编码时写占位action及重放脚本。返回原children，隐藏字段不是由后续子树遍历补写。
 */
function pushStartForm(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag('form'));

  let children = null;
  let innerHTML = null;
  let formAction = null;
  let formEncType = null;
  let formMethod = null;
  let formTarget = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'action':
          formAction = propValue;
          break;
        case 'encType':
          formEncType = propValue;
          break;
        case 'method':
          formMethod = propValue;
          break;
        case 'target':
          formTarget = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  let formData = null;
  let formActionName = null;
  if (typeof formAction === 'function') {
    // 函数 form action 不能自行控制编码、方法与目标窗口。
    if (__DEV__) {
      if (
        (formEncType !== null || formMethod !== null) &&
        !didWarnFormActionMethod
      ) {
        didWarnFormActionMethod = true;
        console.error(
          'Cannot specify a encType or method for a form that specifies a ' +
            'function as the action. React provides those automatically. ' +
            'They will get overridden.',
        );
      }
      if (formTarget !== null && !didWarnFormActionTarget) {
        didWarnFormActionTarget = true;
        console.error(
          'Cannot specify a target for a form that specifies a function as the action. ' +
            'The function will always be executed in the same window.',
        );
      }
    }
    const customFields = getCustomFormFields(resumableState, formAction);
    if (customFields !== null) {
      // 该 action 支持水合前提交回服务端的渐进增强格式，例如 Server Action。
      formAction = customFields.action || '';
      formEncType = customFields.encType;
      formMethod = customFields.method;
      formTarget = customFields.target;
      formData = customFields.data;
      formActionName = customFields.name;
    } else {
      // 写入无业务副作用的 javascript URL。Fizz runtime 通常会 preventDefault；手动提交或
      // React 收到前 stopPropagation 才会访问它。CSP 阻止 javascript: 也可接受。
      target.push(
        attributeSeparator,
        stringToChunk('action'),
        attributeAssign,
        actionJavaScriptURL,
        attributeEnd,
      );
      formAction = null;
      formEncType = null;
      formMethod = null;
      formTarget = null;
      injectFormReplayingRuntime(resumableState, renderState);
    }
  }
  if (formAction != null) {
    pushAttribute(target, 'action', formAction);
  }
  if (formEncType != null) {
    pushAttribute(target, 'encType', formEncType);
  }
  if (formMethod != null) {
    pushAttribute(target, 'method', formMethod);
  }
  if (formTarget != null) {
    pushAttribute(target, 'target', formTarget);
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);

  if (formActionName !== null) {
    target.push(startHiddenInputChunk);
    pushStringAttribute(target, 'name', formActionName);
    target.push(endOfStartTagSelfClosing);
    pushAdditionalFormFields(target, formData);
  }

  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    // 字符串 child 直接写入以省略分隔注释；TODO：通用优化落地后移除此特例。
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }
  return children;
}

/**
 * 编码自闭合input，value/checked优先选非null受控值，再选defaultValue/defaultChecked，false与0仍是有效受控值。收集submit/image的formAction后统一应用编码器元数据；隐藏字段在input标签之后输出。children或dangerouslySetInnerHTML非法，字段转换/编码失败遵循对应校验和重放路径。
 */
function pushInput(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  formatContext: FormatContext,
): ReactNodeList {
  if (__DEV__) {
    checkControlledValueProps('input', props);
  }

  target.push(startChunkForTag('input'));

  let name = null;
  let formAction = null;
  let formEncType = null;
  let formMethod = null;
  let formTarget = null;
  let value = null;
  let defaultValue = null;
  let checked = null;
  let defaultChecked = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'input'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        case 'name':
          name = propValue;
          break;
        case 'formAction':
          formAction = propValue;
          break;
        case 'formEncType':
          formEncType = propValue;
          break;
        case 'formMethod':
          formMethod = propValue;
          break;
        case 'formTarget':
          formTarget = propValue;
          break;
        case 'defaultChecked':
          defaultChecked = propValue;
          break;
        case 'defaultValue':
          defaultValue = propValue;
          break;
        case 'checked':
          checked = propValue;
          break;
        case 'value':
          value = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  if (__DEV__) {
    if (
      formAction !== null &&
      props.type !== 'image' &&
      props.type !== 'submit' &&
      !didWarnFormActionType
    ) {
      didWarnFormActionType = true;
      console.error(
        'An input can only specify a formAction along with type="submit" or type="image".',
      );
    }
  }

  const formData = pushFormActionAttribute(
    target,
    resumableState,
    renderState,
    formAction,
    formEncType,
    formMethod,
    formTarget,
    name,
  );

  if (__DEV__) {
    if (checked !== null && defaultChecked !== null && !didWarnDefaultChecked) {
      console.error(
        '%s contains an input of type %s with both checked and defaultChecked props. ' +
          'Input elements must be either controlled or uncontrolled ' +
          '(specify either the checked prop, or the defaultChecked prop, but not ' +
          'both). Decide between using a controlled or uncontrolled input ' +
          'element and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
        'A component',
        props.type,
      );
      didWarnDefaultChecked = true;
    }
    if (value !== null && defaultValue !== null && !didWarnDefaultInputValue) {
      console.error(
        '%s contains an input of type %s with both value and defaultValue props. ' +
          'Input elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled input ' +
          'element and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
        'A component',
        props.type,
      );
      didWarnDefaultInputValue = true;
    }
  }

  if (checked !== null) {
    pushBooleanAttribute(target, 'checked', checked);
  } else if (defaultChecked !== null) {
    pushBooleanAttribute(target, 'checked', defaultChecked);
  }
  if (value !== null) {
    pushAttribute(target, 'value', value);
  } else if (defaultValue !== null) {
    pushAttribute(target, 'value', defaultValue);
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTagSelfClosing);

  // 附加 hidden 表单字段放在 input 之后。
  pushAdditionalFormFields(target, formData);

  return null;
}

/** 序列化 `<button>`，把函数 formAction 的附加 hidden 字段放在按钮内部。 */
function pushStartButton(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag('button'));

  let children = null;
  let innerHTML = null;
  let name = null;
  let formAction = null;
  let formEncType = null;
  let formMethod = null;
  let formTarget = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'name':
          name = propValue;
          break;
        case 'formAction':
          formAction = propValue;
          break;
        case 'formEncType':
          formEncType = propValue;
          break;
        case 'formMethod':
          formMethod = propValue;
          break;
        case 'formTarget':
          formTarget = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  if (__DEV__) {
    if (
      formAction !== null &&
      props.type != null &&
      props.type !== 'submit' &&
      !didWarnFormActionType
    ) {
      didWarnFormActionType = true;
      console.error(
        'A button can only specify a formAction along with type="submit" or no type.',
      );
    }
  }

  const formData = pushFormActionAttribute(
    target,
    resumableState,
    renderState,
    formAction,
    formEncType,
    formMethod,
    formTarget,
    name,
  );

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);

  // 需要的附加 hidden 字段放在 button 自身内部。
  pushAdditionalFormFields(target, formData);

  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    // 字符串 child 直接写入以省略分隔注释；TODO：通用优化落地后移除此特例。
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }

  return children;
}

/**
 * 把非nullvalue、defaultValue或兼容children编码为textarea文本，value不成为HTML attribute；children数组最多一项，rawHTML被拒绝。只有选中值本身是以换行开头的string才额外补一个换行，以抵消HTML parser吞首行；对象转换后得到的换行不在该补偿条件内。返回null，因为文本已写入target。
 */
function pushStartTextArea(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  formatContext: FormatContext,
): ReactNodeList {
  if (__DEV__) {
    checkControlledValueProps('textarea', props);
    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnDefaultTextareaValue
    ) {
      console.error(
        'Textarea elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled textarea ' +
          'and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
      );
      didWarnDefaultTextareaValue = true;
    }
  }

  target.push(startChunkForTag('textarea'));

  let value = null;
  let defaultValue = null;
  let children = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'value':
          value = propValue;
          break;
        case 'defaultValue':
          defaultValue = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          throw new Error(
            '`dangerouslySetInnerHTML` does not make sense on <textarea>.',
          );
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }
  if (value === null && defaultValue !== null) {
    value = defaultValue;
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);

  // TODO (yungsters)：移除 <textarea> children 内容兼容。
  if (children != null) {
    if (__DEV__) {
      console.error(
        'Use the `defaultValue` or `value` props instead of setting ' +
          'children on <textarea>.',
      );
    }

    if (value != null) {
      throw new Error(
        'If you supply `defaultValue` on a <textarea>, do not pass children.',
      );
    }

    if (isArray(children)) {
      if (children.length > 1) {
        throw new Error('<textarea> can only have at most one child.');
      }

      // TODO：移除此处转换与 DEV 检查，后面几行的转换总会覆盖它。#22309
      if (__DEV__) {
        checkHtmlStringCoercion(children[0]);
      }
      value = '' + children[0];
    }
    if (__DEV__) {
      checkHtmlStringCoercion(children);
    }
    value = '' + children;
  }

  if (typeof value === 'string' && value[0] === '\n') {
    // text/html 会忽略这些标签开头的换行。当前优先保证 text/html：额外添加一个专供
    // parser 吞掉的换行，即便破坏 application/xml。（textarea 也可把 "^\n" 换成
    // "\r\n"，它不会被吞，首个 \r 会由 HTMLTextAreaElement#value 规范化掉。）
    // 参考：<http://www.w3.org/TR/html-polyglot/#newlines-in-textarea-and-pre>
    // 参考：<http://www.w3.org/TR/html5/syntax.html#element-restrictions>
    // 参考：<http://www.w3.org/TR/html5/syntax.html#newlines>
    // 另见 textarea/listing/pre 的解析规则：
    // <http://www.w3.org/TR/html5/syntax.html#parsing-main-inbody>
    target.push(leadingNewline);
  }

  // 直接 ToString 并写出，而不递归 children；value 本就不支持复杂 children，
  // 同时可避免破坏 textarea 的尾部注释节点。
  if (value !== null) {
    if (__DEV__) {
      checkAttributeStringCoercion(value, 'value');
    }
    target.push(stringToChunk(encodeHTMLTextNode('' + value)));
  }

  return null;
}

/**
 * 序列化或提升 `<meta>`：charset/viewport 进入专用早期队列，其他项进入通用 hoistable 队列。
 * fallback、SVG、noscript 与 itemProp 场景保持原位或省略。
 */
function pushMeta(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  renderState: RenderState,
  textEmbedded: boolean,
  formatContext: FormatContext,
): null {
  const noscriptTagInScope = formatContext.tagScope & NOSCRIPT_SCOPE;
  const isFallback = formatContext.tagScope & FALLBACK_SCOPE;
  if (
    formatContext.insertionMode === SVG_MODE ||
    noscriptTagInScope ||
    props.itemProp != null
  ) {
    return pushSelfClosing(target, props, 'meta', formatContext);
  } else {
    if (textEmbedded) {
      // meta 跟在文本后却不会原位写标签；保守插入 textSeparator，假设后面仍可能是文本。
      target.push(textSeparator);
    }

    if (isFallback) {
      // fallback 的可提升元素直接省略：它们通常会被主内容取代，提前输出会增加清理成本；
      // fallback 边界最终等待或客户端渲染，本来也不会水合这些元素。
      return null;
    } else if (typeof props.charSet === 'string') {
      // charset 理想上应是配置而非从标签发现；当前只能通过标签表达，所以进入请求级
      // 专用队列并抢在所有内容前输出。它与 viewport 一样会逃离原父容器。
      return pushSelfClosing(
        renderState.charsetChunks,
        props,
        'meta',
        formatContext,
      );
    } else if (props.name === 'viewport') {
      // viewport 在请求级刷新，以早于受其影响的 Float 资源；代价是逃离原边界。
      // 这是兼顾其文档顺序敏感性、又不迫使所有 hoistable 过早刷新的折中。
      return pushSelfClosing(
        renderState.viewportChunks,
        props,
        'meta',
        formatContext,
      );
    } else {
      return pushSelfClosing(
        renderState.hoistableChunks,
        props,
        'meta',
        formatContext,
      );
    }
  }
}

/**
 * 按rel、href、precedence和作用域选择link原位输出或资源登记。有效stylesheet且有字符串precedence、无disabled/onLoad/onError时进入稳定StyleQueue，即使位于fallback也登记；既有preload可提供缺失凭据并被清空避免重复。其它可提升link在fallback省略；SVG/noscript/itemProp或不满足资源条件的link走原位编码。
 */
function pushLink(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  hoistableState: null | HoistableState,
  textEmbedded: boolean,
  formatContext: FormatContext,
): null {
  const noscriptTagInScope = formatContext.tagScope & NOSCRIPT_SCOPE;
  const isFallback = formatContext.tagScope & FALLBACK_SCOPE;
  const rel = props.rel;
  const href = props.href;
  const precedence = props.precedence;
  if (
    formatContext.insertionMode === SVG_MODE ||
    noscriptTagInScope ||
    props.itemProp != null ||
    typeof rel !== 'string' ||
    typeof href !== 'string' ||
    href === ''
  ) {
    if (__DEV__) {
      if (rel === 'stylesheet' && typeof props.precedence === 'string') {
        if (typeof href !== 'string' || !href) {
          console.error(
            'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and expected the `href` prop to be a non-empty string but ecountered %s instead. If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` prop ensure there is a non-empty string `href` prop as well, otherwise remove the `precedence` prop.',
            getValueDescriptorExpectingObjectForWarning(href),
          );
        }
      }
    }
    pushLinkImpl(target, props);
    return null;
  }

  if (props.rel === 'stylesheet') {
    // 该 link 可能提升为 Stylesheet Resource，否则原位输出。
    const key = getResourceKey(href);
    if (
      typeof precedence !== 'string' ||
      props.disabled != null ||
      props.onLoad ||
      props.onError
    ) {
      // 未选择Resource语义或存在冲突属性时只走原位link编码，此分支本身不建立preload。
      if (__DEV__) {
        if (typeof precedence === 'string') {
          if (props.disabled != null) {
            console.error(
              'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and a `disabled` prop. The presence of the `disabled` prop indicates an intent to manage the stylesheet active state from your from your Component code and React will not hoist or deduplicate this stylesheet. If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` prop remove the `disabled` prop, otherwise remove the `precedence` prop.',
            );
          } else if (props.onLoad || props.onError) {
            const propDescription =
              props.onLoad && props.onError
                ? '`onLoad` and `onError` props'
                : props.onLoad
                  ? '`onLoad` prop'
                  : '`onError` prop';
            console.error(
              'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and %s. The presence of loading and error handlers indicates an intent to manage the stylesheet loading state from your from your Component code and React will not hoist or deduplicate this stylesheet. If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` prop remove the %s, otherwise remove the `precedence` prop.',
              propDescription,
              propDescription,
            );
          }
        }
      }
      return pushLinkImpl(target, props);
    } else {
      // 该样式表引用 Resource，必要时创建新条目。
      let styleQueue = renderState.styles.get(precedence);
      const hasKey = resumableState.styleResources.hasOwnProperty(key);
      const resourceState = hasKey
        ? resumableState.styleResources[key]
        : undefined;
      if (resourceState !== EXISTS) {
        // 即将创建资源，先标记为 Exists。
        resumableState.styleResources[key] = EXISTS;

        // 首次遇到该 precedence 时创建 StyleQueue。
        if (!styleQueue) {
          styleQueue = {
            precedence: stringToChunk(escapeTextForBrowser(precedence)),
            rules: [] as Array<Chunk | PrecomputedChunk>,
            hrefs: [] as Array<Chunk | PrecomputedChunk>,
            sheets: new Map() as Map<string, StylesheetResource>,
          };
          renderState.styles.set(precedence, styleQueue);
        }

        const resource: StylesheetResource = {
          state: PENDING,
          props: stylesheetPropsFromRawProps(props),
        };

        if (resourceState) {
          // truthy resourceState 表示 preload 状态；显式类型转换便于阅读。
          const preloadState: Preloaded | PreloadedWithCredentials =
            resourceState;
          if (preloadState.length === 2) {
            adoptPreloadCredentials(resource.props, preloadState);
          }

          const preloadResource = renderState.preloads.stylesheets.get(key);
          if (preloadResource && preloadResource.length > 0) {
            // preload 本轮创建且尚未刷新，清空块以阻止重复输出。
            preloadResource.length = 0;
          } else {
            // preload 已在本轮或先前 prerender 刷新，标记该资源已预载。
            resource.state = PRELOADED;
          }
        } else {
          // 无需再查 RenderState preload；若存在，对应 resourceState 也必存在并已进入上方分支。
        }

        // 把新资源加入 StyleQueue，必要时也关联当前边界。
        styleQueue.sheets.set(key, resource);
        if (hoistableState) {
          hoistableState.stylesheets.add(resource);
        }
      } else {
        // 判断当前边界是否需等待该资源。通常资源已存在或刚创建；resume 时样式可能已输出，
        // 因而不会在 RenderState 重建，也无需再次跟踪，因为它应已提升到 shell。
        if (styleQueue) {
          const resource = styleQueue.sheets.get(key);
          if (resource) {
            if (hoistableState) {
              hoistableState.stylesheets.add(resource);
            }
          }
        }
      }
      if (textEmbedded) {
        // link 跟在文本后却不原位写标签，保守插入 textSeparator。
        target.push(textSeparator);
      }
      return null;
    }
  } else if (props.onLoad || props.onError) {
    // 有加载处理器时不能提升，必须原位输出。
    return pushLinkImpl(target, props);
  } else {
    // 可提升 link，可能需要文本分隔符。@TODO：重构分隔逻辑，避免 pushStartInstance
    // 最终不输出标签时仍需防御性添加。
    if (textEmbedded) {
      // link 跟在文本后却不原位写标签，保守插入 textSeparator。
      target.push(textSeparator);
    }

    if (isFallback) {
      // fallback 的可提升元素直接省略，避免主内容就绪后再清理；它们本来也不会被水合。
      return null;
    } else {
      return pushLinkImpl(renderState.hoistableChunks, props);
    }
  }
}

/** 原位序列化普通自闭合 `<link>`，拒绝 children/innerHTML。 */
function pushLinkImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
): null {
  target.push(startChunkForTag('link'));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'link'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  // link 永不直接参与 ViewTransition。

  target.push(endOfStartTagSelfClosing);
  return null;
}

/**
 * 把有效href/precedence的style加入对应StyleQueue，fallback中同样登记；SVG/noscript/itemProp或无有效资源标识时原位输出。先标记资源EXISTS再处理规则；仅当配置style nonce为真值时要求标签nonce匹配，失配规则被省略且该href仍去重。未配置真值style nonce时不把标签自己的nonce带到提升后的合并标签。
 */
function pushStyle(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  hoistableState: null | HoistableState,
  textEmbedded: boolean,
  formatContext: FormatContext,
): ReactNodeList {
  const noscriptTagInScope = formatContext.tagScope & NOSCRIPT_SCOPE;
  if (__DEV__) {
    if (hasOwnProperty.call(props, 'children')) {
      const children = props.children;

      const child = Array.isArray(children)
        ? children.length < 2
          ? children[0]
          : null
        : children;

      if (
        typeof child === 'function' ||
        typeof child === 'symbol' ||
        Array.isArray(child)
      ) {
        const childType =
          typeof child === 'function'
            ? 'a Function'
            : typeof child === 'symbol'
              ? 'a Sybmol'
              : 'an Array';
        console.error(
          'React expect children of <style> tags to be a string, number, or object with a `toString` method but found %s instead. ' +
            'In browsers style Elements can only have `Text` Nodes as children.',
          childType,
        );
      }
    }
  }
  const precedence = props.precedence;
  const href = props.href;
  const nonce = props.nonce;

  if (
    formatContext.insertionMode === SVG_MODE ||
    noscriptTagInScope ||
    props.itemProp != null ||
    typeof precedence !== 'string' ||
    typeof href !== 'string' ||
    href === ''
  ) {
    // 该 style 无法转换为 Style Resource。
    return pushStyleImpl(target, props);
  }

  if (__DEV__) {
    if (href.includes(' ')) {
      console.error(
        'React expected the `href` prop for a <style> tag opting into hoisting semantics using the `precedence` prop to not have any spaces but ecountered spaces instead. using spaces in this prop will cause hydration of this style to fail on the client. The href for the <style> where this ocurred is "%s".',
        href,
      );
    }
  }

  const key = getResourceKey(href);
  let styleQueue = renderState.styles.get(precedence);
  const hasKey = resumableState.styleResources.hasOwnProperty(key);
  const resourceState = hasKey ? resumableState.styleResources[key] : undefined;
  if (resourceState !== EXISTS) {
    // 即将创建该资源，先标记为 Exists。
    resumableState.styleResources[key] = EXISTS;

    if (__DEV__) {
      if (resourceState) {
        console.error(
          'React encountered a hoistable style tag for the same href as a preload: "%s". When using a style tag to inline styles you should not also preload it as a stylsheet.',
          href,
        );
      }
    }

    if (!styleQueue) {
      // 首次遇到该 precedence，创建 StyleQueue。
      styleQueue = {
        precedence: stringToChunk(escapeTextForBrowser(precedence)),
        rules: [] as Array<Chunk | PrecomputedChunk>,
        hrefs: [] as Array<Chunk | PrecomputedChunk>,
        sheets: new Map() as Map<string, StylesheetResource>,
      };
      renderState.styles.set(precedence, styleQueue);
    }

    const nonceStyle = renderState.nonce.style;
    if (!nonceStyle || nonceStyle === nonce) {
      if (__DEV__) {
        if (!nonceStyle && nonce) {
          console.error(
            'React encountered a style tag with `precedence` "%s" and `nonce` "%s". When React manages style rules using `precedence` it will only include a nonce attributes if you also provide the same style nonce value as a render option.',
            precedence,
            nonce,
          );
        }
      }
      styleQueue.hrefs.push(stringToChunk(escapeTextForBrowser(href)));
      pushStyleContents(styleQueue.rules, props);
    } else if (__DEV__) {
      console.error(
        'React encountered a style tag with `precedence` "%s" and `nonce` "%s". When React manages style rules using `precedence` it will only include rules if the nonce matches the style nonce "%s" that was included with this render.',
        precedence,
        nonce,
        nonceStyle,
      );
    }
  }
  if (styleQueue) {
    // 关联当前边界是否需等待该资源。resume 时样式可能早已输出且不在 RenderState 重建，
    // 此时无需跟踪，因为它应已提升到 shell。
    if (hoistableState) {
      hoistableState.styles.add(styleQueue);
    }
  }

  if (textEmbedded) {
    // style 跟在文本后却不原位写标签，保守插入 textSeparator。
    target.push(textSeparator);
  }
}

/**
 * 专用于 style 标签 textContent 的转义，破坏 `<style`/`</style` 序列以避免标签提前结束或无法结束。
 * 不可信样式内容仍应在调用前自行安全化。
 */
function escapeStyleTextContent(styleText: string) {
  if (__DEV__) {
    checkHtmlStringCoercion(styleText);
  }
  return ('' + styleText).replace(styleRegex, styleReplacer);
}
/** 定位大小写任意的 style 起止标签前缀。 */
const styleRegex = /(<\/|<)(s)(tyle)/gi;
/** 把 style 首字母改为 CSS 十六进制转义，破坏 HTML 标签序列。 */
const styleReplacer = (
  match: string,
  prefix: string,
  s: string,
  suffix: string,
) => `${prefix}${s === 's' ? '\\73 ' : '\\53 '}${suffix}`;

/**
 * 原位编码style标签和内容：dangerouslySetInnerHTML按原文写入；普通children只取非数组或少于两项数组的单值，再字符串化并转义可能提前闭合style的前缀。这里不遍历React子树，布尔值也可能成为字符串。
 */
function pushStyleImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
): ReactNodeList {
  target.push(startChunkForTag('style'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  // `<style>` 不会参与视图过渡，因此这里无需写入过渡属性。
  target.push(endOfStartTag);

  const child = Array.isArray(children)
    ? children.length < 2
      ? children[0]
      : null
    : children;
  if (
    typeof child !== 'function' &&
    typeof child !== 'symbol' &&
    child !== null &&
    child !== undefined
  ) {
    target.push(stringToChunk(escapeStyleTextContent(child)));
  }
  pushInnerHTML(target, innerHTML, children);
  target.push(endChunkForTag('style'));
  return null;
}

/**
 * 仅编码合并style的内容，不写标签。rawHTML原样输出；children只接受非数组或少于两项数组的单值，过滤null/function/symbol后字符串化并处理style闭合前缀；多项数组不在此逐项遍历。
 */
function pushStyleContents(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
): void {
  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
      }
    }
  }

  const child = Array.isArray(children)
    ? children.length < 2
      ? children[0]
      : null
    : children;
  if (
    typeof child !== 'function' &&
    typeof child !== 'symbol' &&
    child !== null &&
    child !== undefined
  ) {
    target.push(stringToChunk(escapeStyleTextContent(child)));
  }
  pushInnerHTML(target, innerHTML, children);
  return;
}

/**
 * 输出img并在非data URI、非lazy/low、非picture/noscript且URL有效时登记图片preload。响应式键含srcSet/sizes，普通键为src；fetchPriority=high或高优先级队列不足10项可进入高队列，已有bulk条目通过清空Chunk后提升。Link头对typeof srcSet===string均跳过，包括空字符串；高图片头长度500只是选择启发，最终仍必须满足总UTF-16预算。APPEARING_SCOPE内满足条件的图片另记为揭示依赖，普通图片不都阻塞边界。
 */
function pushImg(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  hoistableState: null | HoistableState,
  formatContext: FormatContext,
): null {
  const pictureOrNoScriptTagInScope =
    formatContext.tagScope & (PICTURE_SCOPE | NOSCRIPT_SCOPE);
  const {src, srcSet} = props;
  if (
    props.loading !== 'lazy' &&
    (src || srcSet) &&
    (typeof src === 'string' || src == null) &&
    (typeof srcSet === 'string' || srcSet == null) &&
    props.fetchPriority !== 'low' &&
    !pictureOrNoScriptTagInScope &&
    // data URI 已自带内容，不应再对 src 或 srcSet 发起预加载。
    !(
      typeof src === 'string' &&
      src[4] === ':' &&
      (src[0] === 'd' || src[0] === 'D') &&
      (src[1] === 'a' || src[1] === 'A') &&
      (src[2] === 't' || src[2] === 'T') &&
      (src[3] === 'a' || src[3] === 'A')
    ) &&
    !(
      typeof srcSet === 'string' &&
      srcSet[4] === ':' &&
      (srcSet[0] === 'd' || srcSet[0] === 'D') &&
      (srcSet[1] === 'a' || srcSet[1] === 'A') &&
      (srcSet[2] === 't' || srcSet[2] === 'T') &&
      (srcSet[3] === 'a' || srcSet[3] === 'A')
    )
  ) {
    // 这是可能阻塞展示的图片；预加载可缩短 Suspense 揭示前的等待时间。

    if (hoistableState !== null) {
      // 仅当进入型 View Transition 可能触发父 Suspense 的出现动画时，
      // 才把当前边界标记为包含阻塞图片；SSR 揭示只有在此路径才需要该信号。
      const isInSuspenseWithEnterViewTransition =
        formatContext.tagScope & APPEARING_SCOPE;
      if (isInSuspenseWithEnterViewTransition) {
        hoistableState.suspenseyImages = true;
      }
    }

    const sizes = typeof props.sizes === 'string' ? props.sizes : undefined;
    const key = getImageResourceKey(src, srcSet, sizes);

    const promotablePreloads = renderState.preloads.images;

    let resource = promotablePreloads.get(key);
    if (resource) {
      // 已存在的资源只可能由本次渲染创建且尚未进入高优先级队列；
      // 此处根据显式优先级或队列余量决定是否晋升。
      if (
        props.fetchPriority === 'high' ||
        renderState.highImagePreloads.size < 10
      ) {
        // 晋升后从可晋升映射删除，避免重复 href 在后续遍历中再次进入本分支。
        promotablePreloads.delete(key);

        // $FlowFixMe[incompatible-type]：条件为真时该值必为 Resource，Flow 尚未完成收窄。
        renderState.highImagePreloads.add(resource);
      }
    } else if (!resumableState.imageResources.hasOwnProperty(key)) {
      // 尚未见过该图片，创建新的预加载资源并记录去重状态。
      resumableState.imageResources[key] = PRELOAD_NO_CREDS;
      const crossOrigin = getCrossOriginString(props.crossOrigin);

      const headers = renderState.headers;
      let header;
      if (
        headers &&
        headers.remainingCapacity > 0 &&
        // 浏览器目前不支持通过 Link 响应头预加载响应式图片；存在 srcSet 时退回元素形式。
        typeof props.srcSet !== 'string' &&
        // 与元素 preload 默认上限 10 类似，这里用累计字符串长度 500 作为启发式阈值，
        // 但显式 fetchPriority="high" 可越过限制。长度按UTF-16码元估计提示规模；最终是否写入还受总预算扣减结果约束。
        // 响应头通常早于正文发送，与元素队列并不直接竞争，因此暂时分别计数。
        (props.fetchPriority === 'high' ||
          headers.highImagePreloads.length < 500) &&
        // 只从字符串属性手工构造 preload 选项，避免任意 props 污染参数列表或触发强制转换错误；
        // 即使开发模式已有检查，服务端仍采用更保守的白名单策略。
        ((header = getPreloadAsHeader(src, 'image', {
          imageSrcSet: props.srcSet,
          imageSizes: props.sizes,
          crossOrigin,
          integrity: props.integrity,
          nonce: props.nonce,
          type: props.type,
          fetchPriority: props.fetchPriority,
          referrerPolicy: props.referrerPolicy,
        })),
        // 无论当前头是否装得下，都扣减其长度；一旦容量转负，后续资源便快速跳过响应头尝试，
        // 避免在极小剩余容量下反复构造必然放不下的头。预渲染将来可采用不同策略，
        // 因为它更重视最大化响应头利用率，而非单次请求的运行时成本。
        (headers.remainingCapacity -= header.length + 2) >= 0)
      ) {
        // 即使 shell 延后仍会发出此 preload，因此记入 resets，防止恢复时被错误重置。
        renderState.resets.image[key] = PRELOAD_NO_CREDS;
        if (headers.highImagePreloads) {
          headers.highImagePreloads += ', ';
        }
        // $FlowFixMe[unsafe-addition]：header 已在 if 条件中赋值。
        headers.highImagePreloads += header;
      } else {
        resource = [];
        pushLinkImpl(resource, {
          rel: 'preload',
          as: 'image',
          // Safari 的 preload link 会忽略 imageSrcSet；若同时写 href，可能预载错误图片。
          // 因此存在 imageSrcSet 时省略 href。旧浏览器会因此失去预加载，但其占比很小，接受该权衡。
          href: srcSet ? undefined : src,
          imageSrcSet: srcSet,
          imageSizes: sizes,
          crossOrigin: crossOrigin,
          integrity: props.integrity,
          type: props.type,
          fetchPriority: props.fetchPriority,
          referrerPolicy: props.referrerPolicy,
        } as PreloadProps);
        if (
          props.fetchPriority === 'high' ||
          renderState.highImagePreloads.size < 10
        ) {
          renderState.highImagePreloads.add(resource);
        } else {
          renderState.bulkPreloads.add(resource);
          // 若相同图片稍后以 fetchPriority="high" 出现，可再从该映射晋升。
          promotablePreloads.set(key, resource);
        }
      }
    }
  }
  return pushSelfClosing(target, props, 'img', formatContext);
}

/** 序列化自闭合标签，并拒绝不合法的 children/innerHTML 内容。 */
function pushSelfClosing(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  formatContext: FormatContext,
): null {
  target.push(startChunkForTag(tag));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${tag} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTagSelfClosing);
  return null;
}

/** 序列化 `<menuitem>` 起始标签，并拒绝其不允许的子内容。 */
function pushStartMenuItem(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag('menuitem'));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            'menuitems cannot have `children` nor `dangerouslySetInnerHTML`.',
          );
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  return null;
}

/**
 * 校验并序列化 `<title>`；文档级标题提升到 hoistable 队列，回退树中的标题则省略。
 */
function pushTitle(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  renderState: RenderState,
  formatContext: FormatContext,
): ReactNodeList {
  const noscriptTagInScope = formatContext.tagScope & NOSCRIPT_SCOPE;
  const isFallback = formatContext.tagScope & FALLBACK_SCOPE;
  if (__DEV__) {
    if (hasOwnProperty.call(props, 'children')) {
      const children = props.children;

      const child = Array.isArray(children)
        ? children.length < 2
          ? children[0]
          : null
        : children;

      if (Array.isArray(children) && children.length > 1) {
        console.error(
          'React expects the `children` prop of <title> tags to be a string, number, bigint, or object with a novel `toString` method but found an Array with length %s instead.' +
            ' Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert `children` of <title> tags to a single string value' +
            ' which is why Arrays of length greater than 1 are not supported. When using JSX it can be common to combine text nodes and value nodes.' +
            ' For example: <title>hello {nameOfUser}</title>. While not immediately apparent, `children` in this case is an Array with length 2. If your `children` prop' +
            ' is using this form try rewriting it using a template string: <title>{`hello ${nameOfUser}`}</title>.',
          children.length,
        );
      } else if (typeof child === 'function' || typeof child === 'symbol') {
        const childType =
          typeof child === 'function' ? 'a Function' : 'a Sybmol';
        console.error(
          'React expect children of <title> tags to be a string, number, bigint, or object with a novel `toString` method but found %s instead.' +
            ' Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert children of <title>' +
            ' tags to a single string value.',
          childType,
        );
        // $FlowFixMe[invalid-compare]
        // $FlowFixMe[constant-condition]
      } else if (child && child.toString === {}.toString) {
        if (child.$$typeof != null) {
          console.error(
            'React expects the `children` prop of <title> tags to be a string, number, bigint, or object with a novel `toString` method but found an object that appears to be' +
              ' a React element which never implements a suitable `toString` method. Browsers treat all child Nodes of <title> tags as Text content and React expects to' +
              ' be able to convert children of <title> tags to a single string value which is why rendering React elements is not supported. If the `children` of <title> is' +
              ' a React Component try moving the <title> tag into that component. If the `children` of <title> is some HTML markup change it to be Text only to be valid HTML.',
          );
        } else {
          console.error(
            'React expects the `children` prop of <title> tags to be a string, number, bigint, or object with a novel `toString` method but found an object that does not implement' +
              ' a suitable `toString` method. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert children of <title> tags' +
              ' to a single string value. Using the default `toString` method available on every object is almost certainly an error. Consider whether the `children` of this <title>' +
              ' is an object in error and change it to a string or number value if so. Otherwise implement a `toString` method that React can use to produce a valid <title>.',
          );
        }
      }
    }
  }

  if (
    formatContext.insertionMode !== SVG_MODE &&
    !noscriptTagInScope &&
    props.itemProp == null
  ) {
    if (isFallback) {
      // 回退树中的可提升元素直接省略：主内容很可能取代它们，提前输出只会增加揭示时的清理成本。
      // 客户端要么等待该边界，要么改为客户端渲染，本来也不会水合这些回退元素。
      return null;
    } else {
      pushTitleImpl(renderState.hoistableChunks, props);
    }
  } else {
    return pushTitleImpl(target, props);
  }
}

/**
 * 原位输出title并把单个可转换children转义为文字；少于两项的数组取首项，多项数组不遍历，null/function/symbol省略，其余可字符串化值包含布尔。内容已在此写入，返回空值阻止Fizz再次遍历。
 */
function pushTitleImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
): null {
  target.push(startChunkForTag('title'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }
  // `<title>` 不参与视图过渡，因此无需写入过渡属性。
  target.push(endOfStartTag);

  const child = Array.isArray(children)
    ? children.length < 2
      ? children[0]
      : null
    : children;
  if (
    typeof child !== 'function' &&
    typeof child !== 'symbol' &&
    child !== null &&
    child !== undefined
  ) {
    // eslint-disable-next-line react-internal/safe-string-coercion
    target.push(stringToChunk(escapeTextForBrowser('' + child)));
  }
  pushInnerHTML(target, innerHTML, children);
  target.push(endChunkForTag('title'));
  return null;
}

// 客户端清理边界时若发现这些贡献标记，也会同步清理对应的文档单例。
/** 标记某个边界对 `<head>` 前导内容作出了贡献。 */
const headPreambleContributionChunk = stringToPrecomputedChunk('<!--head-->');
/** 标记某个边界对 `<body>` 前导内容作出了贡献。 */
const bodyPreambleContributionChunk = stringToPrecomputedChunk('<!--body-->');
/** 标记某个边界对 `<html>` 前导内容作出了贡献。 */
const htmlPreambleContributionChunk = stringToPrecomputedChunk('<!--html-->');

/** 把文档级 `<head>` 收集到前导区；深层误用则按普通元素原位输出。 */
function pushStartHead(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  renderState: RenderState,
  preambleState: null | PreambleState,
  formatContext: FormatContext,
): ReactNodeList {
  if (formatContext.insertionMode < HTML_MODE) {
    // 此 `<head>` 对应 Document.head，应归入前导区。
    const preamble = preambleState || renderState.preamble;

    if (preamble.headChunks) {
      throw new Error(`The ${'`<head>`'} tag may only be rendered once.`);
    }

    // 在正文原贡献位置留下标记，以便边界清理时同时撤销 head 单例贡献。
    if (preambleState !== null) {
      target.push(headPreambleContributionChunk);
    }

    preamble.headChunks = [];
    return pushStartSingletonElement(
      preamble.headChunks,
      props,
      'head',
      formatContext,
    );
  } else {
    // 深层 `<head>` 多半是用法错误，但仍原位输出；校验层负责提示位置不合法。
    return pushStartGenericElement(target, props, 'head', formatContext);
  }
}

/** 把文档级 `<body>` 收集到前导区；深层误用则按普通元素原位输出。 */
function pushStartBody(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  renderState: RenderState,
  preambleState: null | PreambleState,
  formatContext: FormatContext,
): ReactNodeList {
  if (formatContext.insertionMode < HTML_MODE) {
    // 此 `<body>` 对应 Document.body。
    const preamble = preambleState || renderState.preamble;

    if (preamble.bodyChunks) {
      throw new Error(`The ${'`<body>`'} tag may only be rendered once.`);
    }

    // 在正文原贡献位置留下标记，以便边界清理时撤销 body 单例贡献。
    if (preambleState !== null) {
      target.push(bodyPreambleContributionChunk);
    }

    preamble.bodyChunks = [];
    return pushStartSingletonElement(
      preamble.bodyChunks,
      props,
      'body',
      formatContext,
    );
  } else {
    // 深层 `<body>` 多半是用法错误，但仍原位输出；校验层负责提示位置不合法。
    return pushStartGenericElement(target, props, 'body', formatContext);
  }
}

/** 把根 `<html>` 与 DOCTYPE 收集到前导区；非根位置则按普通元素原位输出。 */
function pushStartHtml(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  renderState: RenderState,
  preambleState: null | PreambleState,
  formatContext: FormatContext,
): ReactNodeList {
  if (formatContext.insertionMode === ROOT_HTML_MODE) {
    // 此 `<html>` 对应 Document.documentElement。
    const preamble = preambleState || renderState.preamble;

    if (preamble.htmlChunks) {
      throw new Error(`The ${'`<html>`'} tag may only be rendered once.`);
    }

    // 在正文原贡献位置留下标记，以便边界清理时撤销 html 单例贡献。
    if (preambleState !== null) {
      target.push(htmlPreambleContributionChunk);
    }

    preamble.htmlChunks = [DOCTYPE];
    return pushStartSingletonElement(
      preamble.htmlChunks,
      props,
      'html',
      formatContext,
    );
  } else {
    // 深层 `<html>` 多半是用法错误，但仍原位输出；校验层负责提示位置不合法。
    return pushStartGenericElement(target, props, 'html', formatContext);
  }
}

/**
 * 序列化脚本；可安全提升的 async 外部脚本登记为资源，否则立即原位输出。
 * 已有 preload 会被相应脚本资源吸收凭据并取消后续重复刷新。
 */
function pushScript(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  textEmbedded: boolean,
  formatContext: FormatContext,
): null {
  const noscriptTagInScope = formatContext.tagScope & NOSCRIPT_SCOPE;
  const asyncProp = props.async;
  if (
    typeof props.src !== 'string' ||
    !props.src ||
    !(
      asyncProp &&
      typeof asyncProp !== 'function' &&
      typeof asyncProp !== 'symbol'
    ) ||
    props.onLoad ||
    props.onError ||
    formatContext.insertionMode === SVG_MODE ||
    noscriptTagInScope ||
    props.itemProp != null
  ) {
    // 该脚本不满足资源提升条件，提前退出并在当前位置输出。
    return pushScriptImpl(target, props);
  }

  const src = props.src;
  const key = getResourceKey(src);
  // 满足约束的 `<script>` 可提升为 ScriptResource。

  let resources, preloads;
  if (props.type === 'module') {
    resources = resumableState.moduleScriptResources;
    preloads = renderState.preloads.moduleScripts;
  } else {
    resources = resumableState.scriptResources;
    preloads = renderState.preloads.scripts;
  }

  const hasKey = resources.hasOwnProperty(key);
  const resourceState = hasKey ? resources[key] : undefined;
  if (resourceState !== EXISTS) {
    // 即将创建脚本资源，先标记为已存在以阻止重复登记。
    resources[key] = EXISTS;

    let scriptProps = props;
    if (resourceState) {
      // resourceState 为真时代表 preload 状态；显式收窄类型以便读取凭据。
      const preloadState: Preloaded | PreloadedWithCredentials = resourceState;
      if (preloadState.length === 2) {
        scriptProps = {...props};
        adoptPreloadCredentials(scriptProps, preloadState);
      }

      const preloadResource = preloads.get(key);
      if (preloadResource) {
        // 该 preload 由本次渲染创建；脚本资源会更早输出，因此若 preload 尚未刷新，
        // 将其长度清零以取消重复输出。
        preloadResource.length = 0;
      }
    }

    const resource: Resource = [];
    // 加入脚本刷新队列。
    renderState.scripts.add(resource);
    // 预先把标签编码为 Chunk 序列。
    pushScriptImpl(resource, scriptProps);
  }

  if (textEmbedded) {
    // 当前脚本资源被提升而不会原位写标签；若前面紧邻文本，仍插入分隔符，
    // 保守地防止后续文本与现有文本节点在水合时合并。
    target.push(textSeparator);
  }
  return null;
}

/**
 * 原位编码script：dangerouslySetInnerHTML原文写入，普通children仅string会经内联脚本闭合前缀转义后输出，数字或数组不会变成脚本文本。async/src等仍经属性编码；这个文本转义不会改写用户显式rawHTML。
 */
function pushScriptImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
): null {
  target.push(startChunkForTag('script'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }
  // `<script>` 不参与视图过渡，因此无需写入过渡属性。
  target.push(endOfStartTag);

  if (__DEV__) {
    if (children != null && typeof children !== 'string') {
      const descriptiveStatement =
        typeof children === 'number'
          ? 'a number for children'
          : Array.isArray(children)
            ? 'an array for children'
            : 'something unexpected for children';
      console.error(
        'A script element was rendered with %s. If script element has children it must be a single string.' +
          ' Consider using dangerouslySetInnerHTML or passing a plain string as children.',
        descriptiveStatement,
      );
    }
  }

  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    target.push(stringToChunk(escapeEntireInlineScriptContent(children)));
  }
  target.push(endChunkForTag('script'));
  return null;
}

// 这是 pushStartGenericElement 的分支：文档单例绝不能采用字符串 children 快路径。
// 待移除通用元素的特殊优化路径后，可删除此分支并重新合并实现。
/** 序列化文档单例起始标签，始终把 children 留给常规子树流程处理。 */
function pushStartSingletonElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

/** 序列化普通元素，并对单个字符串 children 采用无需文本哨兵的快速路径。 */
function pushStartGenericElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    // 字符串 children 可直接编码，避免生成不必要的文本分隔注释。
    // TODO：通用优化落地后移除此特殊分支。
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }
  return children;
}

/**
 * 编码自定义元素的专用属性协议：className映射class、style走专用编码，React专用props忽略；通用安全属性名过滤对象/function/symbol，false省略、true写空属性。它不调用普通pushAttribute的URL净化或on前缀过滤；返回children让Fizz继续遍历而不走普通标签的字符串快路。
 */
function pushStartCustomElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      let propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      let attributeName = propKey;
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'style':
          pushStyleAttribute(target, propValue);
          break;
        case 'suppressContentEditableWarning':
        case 'suppressHydrationWarning':
        case 'ref':
          // 这些属性由客户端 React 内建处理，服务端不输出。
          break;
        case 'className':
          // 客户端会把 className 写成 class，服务端必须采用相同属性名。
          attributeName = 'class';
        // 有意 fallthrough：按普通安全属性路径继续序列化 class。
        default:
          if (
            isAttributeNameSafe(propKey) &&
            typeof propValue !== 'function' &&
            typeof propValue !== 'symbol'
          ) {
            // $FlowFixMe[invalid-compare]
            if (propValue === false) {
              continue;
              // $FlowFixMe[invalid-compare]
            } else if (propValue === true) {
              propValue = '';
            } else if (typeof propValue === 'object') {
              continue;
            }
            target.push(
              attributeSeparator,
              stringToChunk(attributeName),
              attributeAssign,
              stringToChunk(escapeTextForBrowser(propValue)),
              attributeEnd,
            );
          }
          break;
      }
    }
  }

  // TODO：自定义元素会观察到 ViewTransition 属性；该可见副作用仍需更稳妥的设计。
  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

/** HTML 预格式化元素用来补偿首个换行被解析器吞掉的预计算 Chunk。 */
const leadingNewline = stringToPrecomputedChunk('\n');

/**
 * 编码listing/pre起始标签，并补偿text/html吞首换行的规则。字面string children或字面string rawHTML以换行开头时补一行；后者随后原文写入，前者返回给Fizz继续遍历。由组件或数组最终产生的首换行不在此识别；textarea使用自己的编码器。
 */
function pushStartPreformattedElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  formatContext: FormatContext,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, propKey, propValue);
          break;
      }
    }
  }

  pushViewTransitionAttributes(target, formatContext);

  target.push(endOfStartTag);

  // text/html 会忽略这些标签内容开头的首个换行。这里额外补一个专供解析器吞掉的换行，
  // 暂时优先保证 text/html，哪怕 application/xml 的表现不同。
  // 对 textarea 而言，把开头 "\n" 换成 "\r\n" 不会被吞掉，且首个 \r 会由
  // HTMLTextAreaElement#value 规范化掉。
  // 参考：<http://www.w3.org/TR/html-polyglot/#newlines-in-textarea-and-pre>
  // 参考：<http://www.w3.org/TR/html5/syntax.html#element-restrictions>
  // 参考：<http://www.w3.org/TR/html5/syntax.html#newlines>
  // 参考：<http://www.w3.org/TR/html5/syntax.html#parsing-main-inbody> 中
  // textarea、listing 与 pre 元素的解析规则。
  // TODO：尚未覆盖 children 为数组或由组件返回字符串的情况。
  if (innerHTML != null) {
    if (children != null) {
      throw new Error(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
      );
    }

    if (typeof innerHTML !== 'object' || !('__html' in innerHTML)) {
      throw new Error(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://react.dev/link/dangerously-set-inner-html ' +
          'for more information.',
      );
    }

    const html = innerHTML.__html;
    if (html !== null && html !== undefined) {
      if (typeof html === 'string' && html.length > 0 && html[0] === '\n') {
        target.push(leadingNewline, stringToChunk(html));
      } else {
        if (__DEV__) {
          checkHtmlStringCoercion(html);
        }
        target.push(stringToChunk('' + html));
      }
    }
  }
  if (typeof children === 'string' && children[0] === '\n') {
    target.push(leadingNewline);
  }
  return children;
}

// React 接受任意标签名，但它将被注入任意 HTML，必须先确保名称安全。
// http://www.w3.org/TR/REC-xml/#NT-Name
/** XML Name 规则的简化安全子集，用来拒绝可逃逸标签上下文的名称。 */
const VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/; // 简化子集
/** 缓存已校验标签的起始 Chunk，避免重复验证与编码。 */
const validatedTagCache = new Map<string, PrecomputedChunk>();
/** 校验标签名并返回可复用的 `<tag` 起始 Chunk。 */
function startChunkForTag(tag: string): PrecomputedChunk {
  let tagStartChunk = validatedTagCache.get(tag);
  if (tagStartChunk === undefined) {
    if (!VALID_TAG_REGEX.test(tag)) {
      throw new Error(`Invalid tag: ${tag}`);
    }

    tagStartChunk = stringToPrecomputedChunk('<' + tag);
    validatedTagCache.set(tag, tagStartChunk);
  }
  return tagStartChunk;
}

/** 标准 HTML 文档类型声明的预计算 Chunk。 */
export const doctypeChunk: PrecomputedChunk =
  stringToPrecomputedChunk('<!DOCTYPE html>');

import {doctypeChunk as DOCTYPE} from 'react-server/src/ReactFizzConfig';

/**
 * Fizz的宿主起始标签入口，读取父FormatContext后按标签分派；进入子上下文由后续getChildFormatContext处理。普通元素写target，资源类可改写请求级提升队列而无原位标签。返回尚需遍历的children；内容已处理或资源已登记时返回null/undefined等空值，不能假定每个分支都返回null。
 */
export function pushStartInstance(
  target: Array<Chunk | PrecomputedChunk>,
  type: string,
  props: Object,
  resumableState: ResumableState,
  renderState: RenderState,
  preambleState: null | PreambleState,
  hoistableState: null | HoistableState,
  formatContext: FormatContext,
  textEmbedded: boolean,
): ReactNodeList {
  if (__DEV__) {
    validateARIAProperties(type, props);
    validateInputProperties(type, props);
    validateUnknownProperties(type, props, null);

    if (
      !props.suppressContentEditableWarning &&
      props.contentEditable &&
      props.children != null
    ) {
      console.error(
        'A component is `contentEditable` and contains `children` managed by ' +
          'React. It is now your responsibility to guarantee that none of ' +
          'those nodes are unexpectedly modified or duplicated. This is ' +
          'probably not intentional.',
      );
    }

    if (
      formatContext.insertionMode !== SVG_MODE &&
      formatContext.insertionMode !== MATHML_MODE
    ) {
      if (type.indexOf('-') === -1 && type.toLowerCase() !== type) {
        console.error(
          '<%s /> is using incorrect casing. ' +
            'Use PascalCase for React components, ' +
            'or lowercase for HTML elements.',
          type,
        );
      }
    }
  }

  switch (type) {
    case 'div':
    case 'span':
    case 'svg':
    case 'path':
      // 高频标签直接走下方通用快速路径。
      break;
    case 'a':
      return pushStartAnchor(target, props, formatContext);
    case 'g':
    case 'p':
    case 'li':
      // 高频标签直接走下方通用快速路径。
      break;
    // 需要属性归一化、资源提升或表单状态的特殊标签。
    case 'select':
      return pushStartSelect(target, props, formatContext);
    case 'option':
      return pushStartOption(target, props, formatContext);
    case 'textarea':
      return pushStartTextArea(target, props, formatContext);
    case 'input':
      return pushInput(
        target,
        props,
        resumableState,
        renderState,
        formatContext,
      );
    case 'button':
      return pushStartButton(
        target,
        props,
        resumableState,
        renderState,
        formatContext,
      );
    case 'form':
      return pushStartForm(
        target,
        props,
        resumableState,
        renderState,
        formatContext,
      );
    case 'menuitem':
      return pushStartMenuItem(target, props, formatContext);
    case 'object':
      return pushStartObject(target, props, formatContext);
    case 'title':
      return pushTitle(target, props, renderState, formatContext);
    case 'link':
      return pushLink(
        target,
        props,
        resumableState,
        renderState,
        hoistableState,
        textEmbedded,
        formatContext,
      );
    case 'script':
      return pushScript(
        target,
        props,
        resumableState,
        renderState,
        textEmbedded,
        formatContext,
      );
    case 'style':
      return pushStyle(
        target,
        props,
        resumableState,
        renderState,
        hoistableState,
        textEmbedded,
        formatContext,
      );
    case 'meta':
      return pushMeta(target, props, renderState, textEmbedded, formatContext);
    // HTML 解析器会吞掉首换行的标签。
    case 'listing':
    case 'pre': {
      return pushStartPreformattedElement(target, props, type, formatContext);
    }
    case 'img': {
      return pushImg(
        target,
        props,
        resumableState,
        renderState,
        hoistableState,
        formatContext,
      );
    }
    // HTML 规范允许省略闭合标签的空元素。
    case 'base':
    case 'area':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'keygen':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr': {
      return pushSelfClosing(target, props, type, formatContext);
    }
    // 这些是保留的 SVG/MathML 元素，绝不能按自定义元素处理。
    // https://html.spec.whatwg.org/multipage/custom-elements.html#custom-elements-core-concepts
    case 'annotation-xml':
    case 'color-profile':
    case 'font-face':
    case 'font-face-src':
    case 'font-face-uri':
    case 'font-face-format':
    case 'font-face-name':
    case 'missing-glyph': {
      break;
    }
    // 需要收集到文档前导区的单例起始标签。
    case 'head':
      return pushStartHead(
        target,
        props,
        renderState,
        preambleState,
        formatContext,
      );
    case 'body':
      return pushStartBody(
        target,
        props,
        renderState,
        preambleState,
        formatContext,
      );
    case 'html': {
      return pushStartHtml(
        target,
        props,
        renderState,
        preambleState,
        formatContext,
      );
    }
    default: {
      if (type.indexOf('-') !== -1) {
        // 带连字符的未知标签按自定义元素规则处理。
        return pushStartCustomElement(target, props, type, formatContext);
      }
    }
  }
  // 其余标签走通用元素序列化路径。
  return pushStartGenericElement(target, props, type, formatContext);
}

/** 缓存已编码的闭合标签 Chunk，避免重复分配。 */
const endTagCache = new Map<string, PrecomputedChunk>();
/** 返回可复用的 `</tag>` 预计算 Chunk。 */
function endChunkForTag(tag: string): PrecomputedChunk {
  let chunk = endTagCache.get(tag);
  if (chunk === undefined) {
    chunk = stringToPrecomputedChunk('</' + tag + '>');
    endTagCache.set(tag, chunk);
  }
  return chunk;
}

/**
 * 写入主机实例闭合标签；空元素与已整体序列化的标签跳过，文档单例延迟到 postamble。
 */
export function pushEndInstance(
  target: Array<Chunk | PrecomputedChunk>,
  type: string,
  props: Object,
  resumableState: ResumableState,
  formatContext: FormatContext,
): void {
  switch (type) {
    // title/style/script 始终整块输出且不返回 children，这里必须避免再写一次闭合标签。
    case 'title':
    case 'style':
    case 'script':
    // 省略闭合标签的空元素。
    // TODO：可由上层返回标志以消除重复 switch，但需改为元组返回；若能内联，成本可能可接受。
    // fallthrough
    case 'area':
    case 'base':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'img':
    case 'input':
    case 'keygen':
    case 'link':
    case 'meta':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr': {
      // 这些分支无需闭合标签。
      return;
    }
    // 文档单例的闭合标签属于 postamble。
    // 当 body/html 代表 Document.body/documentElement 时暂不闭合，
    // 直到确定不会再输出标签的 postamble 阶段才写入。
    case 'body': {
      if (formatContext.insertionMode <= HTML_HTML_MODE) {
        resumableState.hasBody = true;
        return;
      }
      break;
    }
    case 'html':
      if (formatContext.insertionMode === ROOT_HTML_MODE) {
        resumableState.hasHtml = true;
        return;
      }
      break;
    case 'head':
      if (formatContext.insertionMode <= HTML_HTML_MODE) {
        return;
      }
      break;
  }
  target.push(endChunkForTag(type));
}

/** 将子边界首次发现的 html/head/body 单例贡献提升到根前导状态。 */
export function hoistPreambleState(
  renderState: RenderState,
  preambleState: PreambleState,
) {
  const rootPreamble = renderState.preamble;
  if (rootPreamble.htmlChunks === null && preambleState.htmlChunks) {
    rootPreamble.htmlChunks = preambleState.htmlChunks;
  }
  if (rootPreamble.headChunks === null && preambleState.headChunks) {
    rootPreamble.headChunks = preambleState.headChunks;
  }
  if (rootPreamble.bodyChunks === null && preambleState.bodyChunks) {
    rootPreamble.bodyChunks = preambleState.bodyChunks;
  }
}

/**
 * 判断文档前导区是否可刷新：没有潜在贡献边界，或 head/body 均已唯一确定时即可。
 */
export function isPreambleReady(
  renderState: RenderState,
  // true 表示仍有可能包含前导贡献的未完成 Suspense 边界。
  // DOM 合法树中每种单例只能出现一次，因此已收齐必要标签即可判定就绪。
  hasPendingPreambles: boolean,
): boolean {
  const preamble = renderState.preamble;
  return (
    // 已无可能贡献前导内容的边界，当前状态就是最终完整状态。
    hasPendingPreambles === false ||
    // head/body 已确定；继续等待只可能得到非法重复单例。
    !!(preamble.headChunks && preamble.bodyChunks)
  );
}

/** 顺序刷新 bootstrap Chunk，并用最后一块的背压结果作为返回值。 */
function writeBootstrap(
  destination: Destination,
  renderState: RenderState,
): boolean {
  const bootstrapChunks = renderState.bootstrapChunks;
  let i = 0;
  for (; i < bootstrapChunks.length - 1; i++) {
    writeChunk(destination, bootstrapChunks[i]);
  }
  if (i < bootstrapChunks.length) {
    const lastChunk = bootstrapChunks[i];
    bootstrapChunks.length = 0;
    return writeChunkAndReturn(destination, lastChunk);
  }
  return true;
}

/** 内联记录 shell 完成时刻的运行时代码 Chunk。 */
const shellTimeRuntimeScript = stringToPrecomputedChunk(markShellTime);

/** 在首次需要时发送 shell 计时指令，供后续边界揭示节流使用。 */
function writeShellTimeInstruction(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
): boolean {
  if (
    enableFizzExternalRuntime &&
    resumableState.streamingFormat !== ScriptStreamingFormat
  ) {
    // 外部运行时会自行记录 shell 时间，无需额外内联指令。
    return true;
  }
  if ((resumableState.instructions & SentMarkShellTime) !== NothingSent) {
    // 该指令已发送，保持幂等。
    return true;
  }
  resumableState.instructions |= SentMarkShellTime;
  writeChunk(destination, renderState.startInlineScript);
  writeCompletedShellIdAttribute(destination, resumableState);
  writeChunk(destination, endOfStartTag);
  writeChunk(destination, shellTimeRuntimeScript);
  return writeChunkAndReturn(destination, endInlineScript);
}

/**
 * 完成根输出：必要时记录 shell 时间、补齐阻塞渲染目标，并刷新 bootstrap 内容。
 */
export function writeCompletedRoot(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
  isComplete: boolean,
): boolean {
  if (!isComplete) {
    // 根尚未完全结束时仍可能揭示其他边界；记录 shell 绘制时间以计算揭示节流。
    writeShellTimeInstruction(destination, resumableState, renderState);
  }
  if (enableFizzBlockingRender) {
    const preamble = renderState.preamble;
    if (preamble.htmlChunks || preamble.headChunks) {
      // 完整文档会输出需要匹配目标的 rel="expect"。通常 bootstrap script 充当目标；
      // 若没有脚本，则补一个 template 来完成 shell 的阻塞渲染握手。
      if (
        (resumableState.instructions & SentCompletedShellId) ===
        NothingSent
      ) {
        writeChunk(destination, startChunkForTag('template'));
        writeCompletedShellIdAttribute(destination, resumableState);
        writeChunk(destination, endOfStartTag);
        writeChunk(destination, endChunkForTag('template'));
      }
    }
  }
  return writeBootstrap(destination, renderState);
}

// 结构节点编码。

// 占位符位于隐藏的局部树内，可在展示前被后续内容填充，用户永远看不到。
// template 可用于任意父元素；script 除 colgroup 外也可用，但不满足全部上下文。
/** 占位 template 的起始 Chunk，后接带前缀的十六进制 ID。 */
const placeholder1 = stringToPrecomputedChunk('<template id="');
/** 占位 template 的闭合 Chunk。 */
const placeholder2 = stringToPrecomputedChunk('"></template>');
/** 写入可由后续流式片段定位并替换的隐藏占位节点。 */
export function writePlaceholder(
  destination: Destination,
  renderState: RenderState,
  id: number,
): boolean {
  writeChunk(destination, placeholder1);
  writeChunk(destination, renderState.placeholderPrefix);
  const formattedID = stringToChunk(id.toString(16));
  writeChunk(destination, formattedID);
  return writeChunkAndReturn(destination, placeholder2);
}

// Activity 边界使用注释节点编码，避免产生可见 DOM。
/** Activity 边界起始注释 Chunk。 */
const startActivityBoundary = stringToPrecomputedChunk('<!--&-->');
/** Activity 边界结束注释 Chunk。 */
const endActivityBoundary = stringToPrecomputedChunk('<!--/&-->');

/** 写入 Activity 边界起始哨兵。 */
export function pushStartActivityBoundary(
  target: Array<Chunk | PrecomputedChunk>,
  renderState: RenderState,
): void {
  target.push(startActivityBoundary);
}

/** 写入 Activity 边界结束哨兵。 */
export function pushEndActivityBoundary(
  target: Array<Chunk | PrecomputedChunk>,
  renderState: RenderState,
): void {
  target.push(endActivityBoundary);
}

// Suspense 边界使用注释节点编码，供客户端水合与揭示逻辑识别。
/** 已完成 Suspense 边界的起始注释 Chunk。 */
const startCompletedSuspenseBoundary = stringToPrecomputedChunk('<!--$-->');
/** 待定 Suspense 边界起始标记与 template ID 前缀。 */
const startPendingSuspenseBoundary1 = stringToPrecomputedChunk(
  '<!--$?--><template id="',
);
/** 待定 Suspense 边界占位 template 的闭合 Chunk。 */
const startPendingSuspenseBoundary2 = stringToPrecomputedChunk('"></template>');
/** 转为客户端渲染的 Suspense 边界起始注释 Chunk。 */
const startClientRenderedSuspenseBoundary =
  stringToPrecomputedChunk('<!--$!-->');
/** 任意 Suspense 边界的结束注释 Chunk。 */
const endSuspenseBoundary = stringToPrecomputedChunk('<!--/$-->');

/** 客户端渲染边界错误 template 的起始 Chunk。 */
const clientRenderedSuspenseBoundaryError1 =
  stringToPrecomputedChunk('<template');
/** 错误 template 属性值的通用闭合引号 Chunk。 */
const clientRenderedSuspenseBoundaryErrorAttrInterstitial =
  stringToPrecomputedChunk('"');
/** 错误摘要 data-dgst 属性前缀。 */
const clientRenderedSuspenseBoundaryError1A =
  stringToPrecomputedChunk(' data-dgst="');
/** 开发模式错误消息 data-msg 属性前缀。 */
const clientRenderedSuspenseBoundaryError1B =
  stringToPrecomputedChunk(' data-msg="');
/** 开发模式错误栈 data-stck 属性前缀。 */
const clientRenderedSuspenseBoundaryError1C =
  stringToPrecomputedChunk(' data-stck="');
/** 开发模式组件栈 data-cstck 属性前缀。 */
const clientRenderedSuspenseBoundaryError1D =
  stringToPrecomputedChunk(' data-cstck="');
/** 客户端渲染错误 template 的闭合 Chunk。 */
const clientRenderedSuspenseBoundaryError2 =
  stringToPrecomputedChunk('></template>');

/** 写入已完成 Suspense 边界的起始哨兵。 */
export function writeStartCompletedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  return writeChunkAndReturn(destination, startCompletedSuspenseBoundary);
}
/** 写入带边界 ID 的待定 Suspense 起始占位节点。 */
export function writeStartPendingSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
  id: number,
): boolean {
  writeChunk(destination, startPendingSuspenseBoundary1);

  // $FlowFixMe[invalid-compare]
  if (id === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.',
    );
  }

  writeChunk(destination, renderState.boundaryPrefix);
  writeChunk(destination, stringToChunk(id.toString(16)));
  return writeChunkAndReturn(destination, startPendingSuspenseBoundary2);
}
/**
 * 写入客户端渲染 Suspense 起始标记及可选错误元数据；详细消息与栈仅开发模式输出。
 */
export function writeStartClientRenderedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
  errorDigest: ?string,
  errorMessage: ?string,
  errorStack: ?string,
  errorComponentStack: ?string,
): boolean {
  let result;
  result = writeChunkAndReturn(
    destination,
    startClientRenderedSuspenseBoundary,
  );
  writeChunk(destination, clientRenderedSuspenseBoundaryError1);
  if (errorDigest != null) {
    writeChunk(destination, clientRenderedSuspenseBoundaryError1A);
    writeChunk(destination, stringToChunk(escapeTextForBrowser(errorDigest)));
    writeChunk(
      destination,
      clientRenderedSuspenseBoundaryErrorAttrInterstitial,
    );
  }
  if (__DEV__) {
    if (errorMessage) {
      writeChunk(destination, clientRenderedSuspenseBoundaryError1B);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorMessage)),
      );
      writeChunk(
        destination,
        clientRenderedSuspenseBoundaryErrorAttrInterstitial,
      );
    }
    if (errorStack) {
      writeChunk(destination, clientRenderedSuspenseBoundaryError1C);
      writeChunk(destination, stringToChunk(escapeTextForBrowser(errorStack)));
      writeChunk(
        destination,
        clientRenderedSuspenseBoundaryErrorAttrInterstitial,
      );
    }
    if (errorComponentStack) {
      writeChunk(destination, clientRenderedSuspenseBoundaryError1D);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorComponentStack)),
      );
      writeChunk(
        destination,
        clientRenderedSuspenseBoundaryErrorAttrInterstitial,
      );
    }
  }
  result = writeChunkAndReturn(
    destination,
    clientRenderedSuspenseBoundaryError2,
  );
  return result;
}
/** 写入已完成 Suspense 边界的结束哨兵。 */
export function writeEndCompletedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
/** 写入待定 Suspense 边界的结束哨兵。 */
export function writeEndPendingSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
/** 写入客户端渲染 Suspense 边界的结束哨兵。 */
export function writeEndClientRenderedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}

/** HTML 模式隐藏片段容器的起始 Chunk。 */
const startSegmentHTML = stringToPrecomputedChunk('<div hidden id="');
/** HTML 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentHTML2 = stringToPrecomputedChunk('">');
/** HTML 模式隐藏片段容器的结束 Chunk。 */
const endSegmentHTML = stringToPrecomputedChunk('</div>');

/** SVG 模式隐藏片段容器的起始 Chunk。 */
const startSegmentSVG = stringToPrecomputedChunk(
  '<svg aria-hidden="true" style="display:none" id="',
);
/** SVG 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentSVG2 = stringToPrecomputedChunk('">');
/** SVG 模式隐藏片段容器的结束 Chunk。 */
const endSegmentSVG = stringToPrecomputedChunk('</svg>');

/** MathML 模式隐藏片段容器的起始 Chunk。 */
const startSegmentMathML = stringToPrecomputedChunk(
  '<math aria-hidden="true" style="display:none" id="',
);
/** MathML 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentMathML2 = stringToPrecomputedChunk('">');
/** MathML 模式隐藏片段容器的结束 Chunk。 */
const endSegmentMathML = stringToPrecomputedChunk('</math>');

/** table 模式隐藏片段容器的起始 Chunk。 */
const startSegmentTable = stringToPrecomputedChunk('<table hidden id="');
/** table 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentTable2 = stringToPrecomputedChunk('">');
/** table 模式隐藏片段容器的结束 Chunk。 */
const endSegmentTable = stringToPrecomputedChunk('</table>');

/** tbody 上下文所需隐藏 table/tbody 包装的起始 Chunk。 */
const startSegmentTableBody = stringToPrecomputedChunk(
  '<table hidden><tbody id="',
);
/** tbody 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentTableBody2 = stringToPrecomputedChunk('">');
/** tbody 模式隐藏包装的结束 Chunk。 */
const endSegmentTableBody = stringToPrecomputedChunk('</tbody></table>');

/** tr 上下文所需隐藏 table/tr 包装的起始 Chunk。 */
const startSegmentTableRow = stringToPrecomputedChunk('<table hidden><tr id="');
/** tr 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentTableRow2 = stringToPrecomputedChunk('">');
/** tr 模式隐藏包装的结束 Chunk。 */
const endSegmentTableRow = stringToPrecomputedChunk('</tr></table>');

/** colgroup 上下文所需隐藏 table/colgroup 包装的起始 Chunk。 */
const startSegmentColGroup = stringToPrecomputedChunk(
  '<table hidden><colgroup id="',
);
/** colgroup 模式片段 ID 后的起始标签闭合 Chunk。 */
const startSegmentColGroup2 = stringToPrecomputedChunk('">');
/** colgroup 模式隐藏包装的结束 Chunk。 */
const endSegmentColGroup = stringToPrecomputedChunk('</colgroup></table>');

/** 根据当前插入模式写入带 ID 的隐藏片段容器起始标签。 */
export function writeStartSegment(
  destination: Destination,
  renderState: RenderState,
  formatContext: FormatContext,
  id: number,
): boolean {
  switch (formatContext.insertionMode) {
    case ROOT_HTML_MODE:
    case HTML_HTML_MODE:
    case HTML_HEAD_MODE:
    case HTML_MODE: {
      writeChunk(destination, startSegmentHTML);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentHTML2);
    }
    case SVG_MODE: {
      writeChunk(destination, startSegmentSVG);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentSVG2);
    }
    case MATHML_MODE: {
      writeChunk(destination, startSegmentMathML);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentMathML2);
    }
    case HTML_TABLE_MODE: {
      writeChunk(destination, startSegmentTable);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTable2);
    }
    // TODO：以下模式会遗留额外包装节点；注入脚本应同时删除外层 table。
    // 它们不可见，且在表格内挂起属于边缘场景，因此当前代价可接受，但功能仍完整支持。
    case HTML_TABLE_BODY_MODE: {
      writeChunk(destination, startSegmentTableBody);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTableBody2);
    }
    case HTML_TABLE_ROW_MODE: {
      writeChunk(destination, startSegmentTableRow);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTableRow2);
    }
    case HTML_COLGROUP_MODE: {
      writeChunk(destination, startSegmentColGroup);
      writeChunk(destination, renderState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentColGroup2);
    }
    default: {
      throw new Error('Unknown insertion mode. This is a bug in React.');
    }
  }
}
/** 根据当前插入模式闭合隐藏片段容器。 */
export function writeEndSegment(
  destination: Destination,
  formatContext: FormatContext,
): boolean {
  switch (formatContext.insertionMode) {
    case ROOT_HTML_MODE:
    case HTML_HTML_MODE:
    case HTML_HEAD_MODE:
    case HTML_MODE: {
      return writeChunkAndReturn(destination, endSegmentHTML);
    }
    case SVG_MODE: {
      return writeChunkAndReturn(destination, endSegmentSVG);
    }
    case MATHML_MODE: {
      return writeChunkAndReturn(destination, endSegmentMathML);
    }
    case HTML_TABLE_MODE: {
      return writeChunkAndReturn(destination, endSegmentTable);
    }
    case HTML_TABLE_BODY_MODE: {
      return writeChunkAndReturn(destination, endSegmentTableBody);
    }
    case HTML_TABLE_ROW_MODE: {
      return writeChunkAndReturn(destination, endSegmentTableRow);
    }
    case HTML_COLGROUP_MODE: {
      return writeChunkAndReturn(destination, endSegmentColGroup);
    }
    default: {
      throw new Error('Unknown insertion mode. This is a bug in React.');
    }
  }
}

/** 首次完成片段时内联 `$RS` 实现并开始第一个字符串参数。 */
const completeSegmentScript1Full = stringToPrecomputedChunk(
  completeSegmentFunction + '$RS("',
);
/** 后续完成片段时复用既有 `$RS` 函数的调用前缀。 */
const completeSegmentScript1Partial = stringToPrecomputedChunk('$RS("');
/** `$RS` 两个字符串参数之间的分隔 Chunk。 */
const completeSegmentScript2 = stringToPrecomputedChunk('","');
/** `$RS` 调用与内联 script 的闭合 Chunk。 */
const completeSegmentScriptEnd = stringToPrecomputedChunk('")</script>');

/** 外部运行时格式的完成片段 template 与 segment ID 属性前缀。 */
const completeSegmentData1 = stringToPrecomputedChunk(
  '<template data-rsi="" data-sid="',
);
/** 外部运行时格式中 placeholder ID 属性前缀。 */
const completeSegmentData2 = stringToPrecomputedChunk('" data-pid="');
/** 外部运行时完成片段 template 的通用闭合 Chunk。 */
const completeSegmentDataEnd = dataElementQuotedEnd;

/**
 * 写入“以内容片段替换占位符”指令；首次脚本格式携带实现，后续只发调用。
 */
export function writeCompletedSegmentInstruction(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
  contentSegmentID: number,
): boolean {
  const scriptFormat =
    !enableFizzExternalRuntime ||
    resumableState.streamingFormat === ScriptStreamingFormat;
  if (scriptFormat) {
    writeChunk(destination, renderState.startInlineScript);
    writeChunk(destination, endOfStartTag);
    if (
      (resumableState.instructions & SentCompleteSegmentFunction) ===
      NothingSent
    ) {
      // 首次发送时必须携带完整函数实现。
      resumableState.instructions |= SentCompleteSegmentFunction;
      writeChunk(destination, completeSegmentScript1Full);
    } else {
      // 后续调用复用已安装的函数。
      writeChunk(destination, completeSegmentScript1Partial);
    }
  } else {
    writeChunk(destination, completeSegmentData1);
  }

  // 写入两个字符串字面量参数：内容片段 ID 与占位符 ID。
  writeChunk(destination, renderState.segmentPrefix);
  const formattedID = stringToChunk(contentSegmentID.toString(16));
  writeChunk(destination, formattedID);
  if (scriptFormat) {
    writeChunk(destination, completeSegmentScript2);
  } else {
    writeChunk(destination, completeSegmentData2);
  }
  writeChunk(destination, renderState.placeholderPrefix);
  writeChunk(destination, formattedID);

  if (scriptFormat) {
    return writeChunkAndReturn(destination, completeSegmentScriptEnd);
  } else {
    return writeChunkAndReturn(destination, completeSegmentDataEnd);
  }
}

/** 仅包含完成边界函数实现、尚未开始调用的 Chunk。 */
const completeBoundaryScriptFunctionOnly = stringToPrecomputedChunk(
  completeBoundaryFunction,
);
/** 把边界完成运行时升级为支持 View Transition 的指令 Chunk。 */
const completeBoundaryUpgradeToViewTransitionsInstruction = stringToChunk(
  upgradeToViewTransitionsInstruction,
);
/** 无样式依赖时完成边界的 `$RC` 调用前缀。 */
const completeBoundaryScript1Partial = stringToPrecomputedChunk('$RC("');

/** 首次带样式完成边界时的样式插入函数实现与 `$RR` 调用前缀。 */
const completeBoundaryWithStylesScript1FullPartial = stringToPrecomputedChunk(
  styleInsertionFunction + '$RR("',
);

/** 后续带样式完成边界时复用 `$RR` 的调用前缀。 */
const completeBoundaryWithStylesScript1Partial =
  stringToPrecomputedChunk('$RR("');
/** 完成边界脚本中 boundary ID 与 segment ID 的分隔 Chunk。 */
const completeBoundaryScript2 = stringToPrecomputedChunk('","');
/** 完成边界脚本中样式依赖数组前的分隔 Chunk。 */
const completeBoundaryScript3a = stringToPrecomputedChunk('",');
/** 无样式依赖时关闭第二个字符串参数的 Chunk。 */
const completeBoundaryScript3b = stringToPrecomputedChunk('"');
/** 完成边界调用及内联 script 的闭合 Chunk。 */
const completeBoundaryScriptEnd = stringToPrecomputedChunk(')</script>');

/** 外部运行时无样式完成边界 template 的起始 Chunk。 */
const completeBoundaryData1 = stringToPrecomputedChunk(
  '<template data-rci="" data-bid="',
);
/** 外部运行时带样式完成边界 template 的起始 Chunk。 */
const completeBoundaryWithStylesData1 = stringToPrecomputedChunk(
  '<template data-rri="" data-bid="',
);
/** 外部运行时格式中 segment ID 属性前缀。 */
const completeBoundaryData2 = stringToPrecomputedChunk('" data-sid="');
/** 外部运行时格式中样式依赖属性前缀。 */
const completeBoundaryData3a = stringToPrecomputedChunk('" data-sty="');
/** 外部运行时完成边界 template 的通用闭合 Chunk。 */
const completeBoundaryDataEnd = dataElementQuotedEnd;

/**
 * 写入已完成Suspense边界的script或data指令，id采用同一十六进制编号配boundary/segment前缀。读取并先清空renderState.stylesToHoist；需要样式时编码该边界依赖并选择RR协议，否则选择RC，按位首次补对应运行时代码及可选ViewTransition升级。一个指令批次仍完整写出，返回bootstrap与末次写入的可继续信号，不在内部逐Chunk暂停。
 */
export function writeCompletedBoundaryInstruction(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
  id: number,
  hoistableState: HoistableState,
): boolean {
  const requiresStyleInsertion = renderState.stylesToHoist;
  const requiresViewTransitions =
    enableViewTransition &&
    (resumableState.instructions & NeedUpgradeToViewTransitions) !==
      NothingSent;
  // 必要样式表会随本指令刷新，尚未提升到 Document 的 style 也会被提升。
  // 指令执行后此前样式均已处理，因此立即重置聚合状态。
  renderState.stylesToHoist = false;
  const scriptFormat =
    !enableFizzExternalRuntime ||
    resumableState.streamingFormat === ScriptStreamingFormat;
  if (scriptFormat) {
    writeChunk(destination, renderState.startInlineScript);
    writeChunk(destination, endOfStartTag);
    if (requiresStyleInsertion) {
      if (
        (resumableState.instructions & SentClientRenderFunction) ===
        NothingSent
      ) {
        // 带样式的完成函数依赖客户端渲染函数，首次使用时先安装依赖。
        resumableState.instructions |= SentClientRenderFunction;
        writeChunk(destination, clientRenderScriptFunctionOnly);
      }
      if (
        (resumableState.instructions & SentCompleteBoundaryFunction) ===
        NothingSent
      ) {
        // 带样式的完成函数也依赖普通完成边界函数，首次使用时先安装。
        resumableState.instructions |= SentCompleteBoundaryFunction;
        writeChunk(destination, completeBoundaryScriptFunctionOnly);
      }
      if (
        requiresViewTransitions &&
        (resumableState.instructions & SentUpgradeToViewTransitions) ===
          NothingSent
      ) {
        resumableState.instructions |= SentUpgradeToViewTransitions;
        writeChunk(
          destination,
          completeBoundaryUpgradeToViewTransitionsInstruction,
        );
      }
      if (
        (resumableState.instructions & SentStyleInsertionFunction) ===
        NothingSent
      ) {
        resumableState.instructions |= SentStyleInsertionFunction;
        writeChunk(destination, completeBoundaryWithStylesScript1FullPartial);
      } else {
        writeChunk(destination, completeBoundaryWithStylesScript1Partial);
      }
    } else {
      if (
        (resumableState.instructions & SentCompleteBoundaryFunction) ===
        NothingSent
      ) {
        resumableState.instructions |= SentCompleteBoundaryFunction;
        writeChunk(destination, completeBoundaryScriptFunctionOnly);
      }
      if (
        requiresViewTransitions &&
        (resumableState.instructions & SentUpgradeToViewTransitions) ===
          NothingSent
      ) {
        resumableState.instructions |= SentUpgradeToViewTransitions;
        writeChunk(
          destination,
          completeBoundaryUpgradeToViewTransitionsInstruction,
        );
      }
      writeChunk(destination, completeBoundaryScript1Partial);
    }
  } else {
    if (requiresStyleInsertion) {
      writeChunk(destination, completeBoundaryWithStylesData1);
    } else {
      writeChunk(destination, completeBoundaryData1);
    }
  }

  const idChunk = stringToChunk(id.toString(16));

  writeChunk(destination, renderState.boundaryPrefix);
  writeChunk(destination, idChunk);

  // 写入字符串参数以及可选的样式依赖数组字面量。
  if (scriptFormat) {
    writeChunk(destination, completeBoundaryScript2);
  } else {
    writeChunk(destination, completeBoundaryData2);
  }
  writeChunk(destination, renderState.segmentPrefix);
  writeChunk(destination, idChunk);
  if (requiresStyleInsertion) {
    // 脚本与 data 格式的编码不同：
    // - script 写入 JavaScript 数组字面量，字符串按 JS 规则转义，例如 ["A", "B"]；
    // - data 写入 HTML 属性字符串，内容按 HTML 规则转义，例如 [&#34;A&#34;, &#34;B&#34;]。
    if (scriptFormat) {
      writeChunk(destination, completeBoundaryScript3a);
      // hoistableState 在此编码为数组字面量。
      writeStyleResourceDependenciesInJS(destination, hoistableState);
    } else {
      writeChunk(destination, completeBoundaryData3a);
      writeStyleResourceDependenciesInAttr(destination, hoistableState);
    }
  } else {
    if (scriptFormat) {
      writeChunk(destination, completeBoundaryScript3b);
    }
  }
  let writeMore;
  if (scriptFormat) {
    writeMore = writeChunkAndReturn(destination, completeBoundaryScriptEnd);
  } else {
    writeMore = writeChunkAndReturn(destination, completeBoundaryDataEnd);
  }
  return writeBootstrap(destination, renderState) && writeMore;
}

/** 仅包含客户端渲染边界函数实现的 Chunk。 */
const clientRenderScriptFunctionOnly =
  stringToPrecomputedChunk(clientRenderFunction);

/** 首次客户端渲染边界时携带 `$RX` 实现与调用前缀。 */
const clientRenderScript1Full = stringToPrecomputedChunk(
  clientRenderFunction + ';$RX("',
);
/** 后续客户端渲染边界时复用 `$RX` 的调用前缀。 */
const clientRenderScript1Partial = stringToPrecomputedChunk('$RX("');
/** `$RX` 首个字符串参数的闭合引号 Chunk。 */
const clientRenderScript1A = stringToPrecomputedChunk('"');
/** `$RX` 可选错误参数之间的逗号分隔 Chunk。 */
const clientRenderErrorScriptArgInterstitial = stringToPrecomputedChunk(',');
/** `$RX` 缺失错误摘要时的 null 字面量 Chunk。 */
const clientRenderErrorScriptNull = stringToPrecomputedChunk('null');
/** `$RX` 调用与内联 script 的闭合 Chunk。 */
const clientRenderScriptEnd = stringToPrecomputedChunk(')</script>');

/** 外部运行时客户端渲染 template 与 boundary ID 前缀。 */
const clientRenderData1 = stringToPrecomputedChunk(
  '<template data-rxi="" data-bid="',
);
/** 外部运行时错误摘要属性前缀。 */
const clientRenderData2 = stringToPrecomputedChunk('" data-dgst="');
/** 外部运行时错误消息属性前缀。 */
const clientRenderData3 = stringToPrecomputedChunk('" data-msg="');
/** 外部运行时错误栈属性前缀。 */
const clientRenderData4 = stringToPrecomputedChunk('" data-stck="');
/** 外部运行时组件栈属性前缀。 */
const clientRenderData5 = stringToPrecomputedChunk('" data-cstck="');
/** 外部运行时客户端渲染 template 的闭合 Chunk。 */
const clientRenderDataEnd = dataElementQuotedEnd;

/**
 * 写客户端接管指定Suspense边界的RX脚本或data模板。errorDigest/message/stack是否提供由调用者决定，本函数不以DEV开关统一过滤诊断字段；分别按JavaScript字面量或HTML属性上下文转义，末次写入结果作为背压信号。
 */
export function writeClientRenderBoundaryInstruction(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
  id: number,
  errorDigest: ?string,
  errorMessage: ?string,
  errorStack: ?string,
  errorComponentStack: ?string,
): boolean {
  const scriptFormat =
    !enableFizzExternalRuntime ||
    resumableState.streamingFormat === ScriptStreamingFormat;
  if (scriptFormat) {
    writeChunk(destination, renderState.startInlineScript);
    writeChunk(destination, endOfStartTag);
    if (
      (resumableState.instructions & SentClientRenderFunction) ===
      NothingSent
    ) {
      // 首次发送时必须携带完整函数实现。
      resumableState.instructions |= SentClientRenderFunction;
      writeChunk(destination, clientRenderScript1Full);
    } else {
      // 后续调用复用已安装的函数。
      writeChunk(destination, clientRenderScript1Partial);
    }
  } else {
    // <template data-rxi="" data-bid="
    writeChunk(destination, clientRenderData1);
  }

  writeChunk(destination, renderState.boundaryPrefix);
  writeChunk(destination, stringToChunk(id.toString(16)));
  if (scriptFormat) {
    // 脚本格式需显式补首个参数的闭合引号；参数分隔 Chunk 本身不含引号。
    writeChunk(destination, clientRenderScript1A);
  }

  if (
    errorDigest != null ||
    errorMessage ||
    errorStack ||
    errorComponentStack
  ) {
    if (scriptFormat) {
      // 脚本格式：写入 `,null` 或 `,"JSONString"`。
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      if (errorDigest == null) {
        writeChunk(destination, clientRenderErrorScriptNull);
      } else {
        writeChunk(
          destination,
          stringToChunk(escapeJSStringsForInstructionScripts(errorDigest)),
        );
      }
    } else if (errorDigest != null) {
      // data 格式：写入 `" data-dgst="HTMLString`。
      writeChunk(destination, clientRenderData2);
      writeChunk(destination, stringToChunk(escapeTextForBrowser(errorDigest)));
    }
  }
  if (errorMessage || errorStack || errorComponentStack) {
    if (scriptFormat) {
      // 脚本格式：写入 `,"JSONString"`。
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      writeChunk(
        destination,
        stringToChunk(escapeJSStringsForInstructionScripts(errorMessage || '')),
      );
    } else {
      // data 格式：写入 `" data-msg="HTMLString`。
      writeChunk(destination, clientRenderData3);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorMessage || '')),
      );
    }
  }
  if (errorStack || errorComponentStack) {
    // 脚本格式：写入 `,"JSONString"`。
    if (scriptFormat) {
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      writeChunk(
        destination,
        stringToChunk(escapeJSStringsForInstructionScripts(errorStack || '')),
      );
    } else {
      // data 格式：写入 `" data-stck="HTMLString`。
      writeChunk(destination, clientRenderData4);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorStack || '')),
      );
    }
  }
  if (errorComponentStack) {
    // 脚本格式：写入 `,"JSONString"`。
    if (scriptFormat) {
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      writeChunk(
        destination,
        stringToChunk(
          escapeJSStringsForInstructionScripts(errorComponentStack),
        ),
      );
    } else {
      // data 格式：写入 `" data-cstck="HTMLString`。
      writeChunk(destination, clientRenderData5);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorComponentStack)),
      );
    }
  }

  if (scriptFormat) {
    // 结束调用与 script 标签。
    return writeChunkAndReturn(destination, clientRenderScriptEnd);
  } else {
    // 结束 data template 标签。
    return writeChunkAndReturn(destination, clientRenderDataEnd);
  }
}

/** 匹配会逃逸 script/JS 字符串上下文的字符。 */
const regexForJSStringsInInstructionScripts = /[<\u2028\u2029]/g;
/** 把单个字符串编码为可安全嵌入指令 script 的 JSON 字符串字面量。 */
function escapeJSStringsForInstructionScripts(input: string): string {
  const escaped = JSON.stringify(input);
  return escaped.replace(regexForJSStringsInInstructionScripts, match => {
    switch (match) {
      // 转义可能突破字符串或 script 标签上下文的字符。
      case '<':
        return '\\u003c';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default: {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error(
          'escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React',
        );
      }
    }
  });
}

/** 匹配对象 JSON 嵌入 script 时需要额外转义的 HTML/行分隔字符。 */
const regexForJSStringsInScripts = /[&><\u2028\u2029]/g;
/** 把对象编码为可安全嵌入指令 script 的 JSON 文本。 */
function escapeJSObjectForInstructionScripts(input: Object): string {
  const escaped = JSON.stringify(input);
  return escaped.replace(regexForJSStringsInScripts, match => {
    switch (match) {
      // 转义可能突破字符串或 script 标签上下文的字符。
      case '&':
        return '\\u0026';
      case '>':
        return '\\u003e';
      case '<':
        return '\\u003c';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default: {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error(
          'escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React',
        );
      }
    }
  });
}

/** 延迟 style 资源起始标签中 media 与 precedence 属性前缀。 */
const lateStyleTagResourceOpen1 = stringToPrecomputedChunk(
  ' media="not all" data-precedence="',
);
/** 延迟 style 资源的 data-href 属性前缀。 */
const lateStyleTagResourceOpen2 = stringToPrecomputedChunk('" data-href="');
/** 延迟 style 资源起始标签的闭合 Chunk。 */
const lateStyleTagResourceOpen3 = stringToPrecomputedChunk('">');
/** 延迟 style 资源的闭合标签 Chunk。 */
const lateStyleTagTemplateClose = stringToPrecomputedChunk('</style>');

// 记录当前边界是否刷新了 style，或依赖尚未在 preamble 刷新的 stylesheet。
/** 当前边界完成指令是否还需在客户端提升样式。 */
let currentlyRenderingBoundaryHasStylesToHoist = false;

// 作为 forEach 样式刷新回调的聚合返回状态。
/** 最近一次延迟样式写入后，目标流是否仍有容量。 */
let destinationHasCapacity = true;

/** 刷新某一 precedence 队列的延迟 style 规则，并重置可继续追加的队列内容。 */
function flushStyleTagsLateForBoundary(
  this: Destination,
  styleQueue: StyleQueue,
) {
  const rules = styleQueue.rules;
  const hrefs = styleQueue.hrefs;
  if (__DEV__) {
    if (rules.length > 0 && hrefs.length === 0) {
      console.error(
        'React expected to have at least one href for an a hoistable style but found none. This is a bug in React.',
      );
    }
  }
  let i = 0;
  if (hrefs.length) {
    writeChunk(
      this,
      (currentlyFlushingRenderState as any as RenderState).startInlineStyle,
    );
    writeChunk(this, lateStyleTagResourceOpen1);
    writeChunk(this, styleQueue.precedence);
    writeChunk(this, lateStyleTagResourceOpen2);
    for (; i < hrefs.length - 1; i++) {
      writeChunk(this, hrefs[i]);
      writeChunk(this, spaceSeparator);
    }
    writeChunk(this, hrefs[i]);
    writeChunk(this, lateStyleTagResourceOpen3);
    for (i = 0; i < rules.length; i++) {
      writeChunk(this, rules[i]);
    }
    destinationHasCapacity = writeChunkAndReturn(
      this,
      lateStyleTagTemplateClose,
    );

    // 当前边界已写入 style，后续可能需要脚本把它们提升到文档 head。
    currentlyRenderingBoundaryHasStylesToHoist = true;

    // style 资源允许持续追加新规则与 href；不标记为永久已刷新，只清空本批数组。
    rules.length = 0;
    hrefs.length = 0;
  }
}

/** 检查 stylesheet 是否未在 preamble 完成，从而要求边界揭示时处理样式。 */
function hasStylesToHoist(stylesheet: StylesheetResource): boolean {
  // 依赖未刷新，或只在 shell 后刷新时，边界揭示必须携带样式提升流程。
  if (stylesheet.state !== PREAMBLE) {
    currentlyRenderingBoundaryHasStylesToHoist = true;
    return true;
  }
  return false;
}

/**
 * 在输出完成边界指令前刷新其延迟style，清空每个队列的rules/hrefs；stylesheet若非PREAMBLE则把请求级stylesToHoist设为true，供下一条揭示指令消费。临时全局保存当前renderState供Set回调，正常返回时清除；write结果反映最后一次延迟样式写入，未逐项因背压中断或累积全部write结果。
 */
export function writeHoistablesForBoundary(
  destination: Destination,
  hoistableState: HoistableState,
  renderState: RenderState,
): boolean {
  // 每次调用重置临时聚合变量；它们只在本函数同步执行期间可安全读取。
  currentlyRenderingBoundaryHasStylesToHoist = false;
  destinationHasCapacity = true;

  // 按当前边界依赖的每个 precedence 刷新 style 队列。
  currentlyFlushingRenderState = renderState;
  hoistableState.styles.forEach(flushStyleTagsLateForBoundary, destination);
  currentlyFlushingRenderState = null;

  // 判断边界完成时是否仍有必须等待的 stylesheet。
  hoistableState.stylesheets.forEach(hasStylesToHoist);

  // 边界完成前不刷新其他 hoistable。它们不同于可去重资源，更像普通元素：
  // 每个渲染实例在 DOM 中都有唯一表示，不能早于所属边界出现。

  if (currentlyRenderingBoundaryHasStylesToHoist) {
    renderState.stylesToHoist = true;
  }
  return destinationHasCapacity;
}

/** 写出资源的全部 Chunk，并清空数组以标记该批次已刷新。 */
function flushResource(this: Destination, resource: Resource) {
  for (let i = 0; i < resource.length; i++) {
    writeChunk(this, resource[i]);
  }
  resource.length = 0;
}

/** 复用的 stylesheet 编码暂存队列，避免每次前导刷新重新分配。 */
const stylesheetFlushingQueue: Array<Chunk | PrecomputedChunk> = [];

/** 在 preamble 阶段编码并刷新 stylesheet，同时更新其 PREAMBLE 状态。 */
function flushStyleInPreamble(
  this: Destination,
  stylesheet: StylesheetResource,
  key: string,
  map: Map<string, StylesheetResource>,
) {
  // stylesheet 不像多数 hoistable/resource 那样在渲染时急切编码：
  // 延迟刷新需要另一种表示，为避免重复编码，到实际刷新阶段才生成 Chunk。
  pushLinkImpl(stylesheetFlushingQueue, stylesheet.props);
  for (let i = 0; i < stylesheetFlushingQueue.length; i++) {
    writeChunk(this, stylesheetFlushingQueue[i]);
  }
  stylesheetFlushingQueue.length = 0;
  stylesheet.state = PREAMBLE;
}

/** preamble style 标签的 data-precedence 属性前缀。 */
const styleTagResourceOpen1 = stringToPrecomputedChunk(' data-precedence="');
/** preamble style 标签的 data-href 属性前缀。 */
const styleTagResourceOpen2 = stringToPrecomputedChunk('" data-href="');
/** style 资源多个 href 之间的空格分隔 Chunk。 */
const spaceSeparator = stringToPrecomputedChunk(' ');
/** preamble style 起始标签的闭合 Chunk。 */
const styleTagResourceOpen3 = stringToPrecomputedChunk('">');

/** preamble style 标签的闭合 Chunk。 */
const styleTagResourceClose = stringToPrecomputedChunk('</style>');

/** 按 precedence 刷新 preamble 中的 stylesheet 与聚合 style 规则。 */
function flushStylesInPreamble(
  this: Destination,
  styleQueue: StyleQueue,
  precedence: string,
) {
  const hasStylesheets = styleQueue.sheets.size > 0;
  styleQueue.sheets.forEach(flushStyleInPreamble, this);
  styleQueue.sheets.clear();

  const rules = styleQueue.rules;
  const hrefs = styleQueue.hrefs;
  // 即使该 precedence 没有 stylesheet/rule，也可能需要空 style 标签来保留优先级顺序；
  // data-precedence 让客户端后续插入仍能找到正确位置。
  if (!hasStylesheets || hrefs.length) {
    writeChunk(
      this,
      (currentlyFlushingRenderState as any as RenderState).startInlineStyle,
    );
    writeChunk(this, styleTagResourceOpen1);
    writeChunk(this, styleQueue.precedence);
    let i = 0;
    if (hrefs.length) {
      writeChunk(this, styleTagResourceOpen2);
      for (; i < hrefs.length - 1; i++) {
        writeChunk(this, hrefs[i]);
        writeChunk(this, spaceSeparator);
      }
      writeChunk(this, hrefs[i]);
    }
    writeChunk(this, styleTagResourceOpen3);
    for (i = 0; i < rules.length; i++) {
      writeChunk(this, rules[i]);
    }
    writeChunk(this, styleTagResourceClose);

    // style 资源可持续追加规则与 href；不标记为永久已刷新，只清空本批数组。
    rules.length = 0;
    hrefs.length = 0;
  }
}

/** 对尚未发送的延迟 stylesheet 写入 preload，并把状态推进到 PRELOADED。 */
function preloadLateStyle(this: Destination, stylesheet: StylesheetResource) {
  if (stylesheet.state === PENDING) {
    stylesheet.state = PRELOADED;
    const preloadProps = preloadAsStylePropsFromProps(
      stylesheet.props.href,
      stylesheet.props,
    );
    pushLinkImpl(stylesheetFlushingQueue, preloadProps);
    for (let i = 0; i < stylesheetFlushingQueue.length; i++) {
      writeChunk(this, stylesheetFlushingQueue[i]);
    }
    stylesheetFlushingQueue.length = 0;
  }
}

/** 预加载某一 precedence 队列内全部延迟 stylesheet，并清空待处理映射。 */
function preloadLateStyles(this: Destination, styleQueue: StyleQueue) {
  styleQueue.sheets.forEach(preloadLateStyle, this);
  styleQueue.sheets.clear();
}

/** 阻塞首屏绘制的 rel="expect" link 与目标 ID 前缀。 */
const blockingRenderChunkStart = stringToPrecomputedChunk(
  '<link rel="expect" href="#',
);
/** 阻塞首屏绘制 link 的闭合 Chunk。 */
const blockingRenderChunkEnd = stringToPrecomputedChunk(
  '" blocking="render"/>',
);

/** 在功能开关启用时写入指向 shell 完成目标的阻塞渲染 link。 */
function writeBlockingRenderInstruction(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
): void {
  if (enableFizzBlockingRender) {
    const idPrefix = resumableState.idPrefix;
    const shellId = '_' + idPrefix + 'R_';
    writeChunk(destination, blockingRenderChunkStart);
    writeChunk(destination, stringToChunk(escapeTextForBrowser(shellId)));
    writeChunk(destination, blockingRenderChunkEnd);
  }
}

/** shell 完成目标的 id 属性前缀。 */
const completedShellIdAttributeStart = stringToPrecomputedChunk(' id="');

/** 首次调用时把 shell 完成 ID 直接写入目标流，并更新已发送位。 */
function writeCompletedShellIdAttribute(
  destination: Destination,
  resumableState: ResumableState,
): void {
  if ((resumableState.instructions & SentCompletedShellId) !== NothingSent) {
    return;
  }
  resumableState.instructions |= SentCompletedShellId;
  const idPrefix = resumableState.idPrefix;
  const shellId = '_' + idPrefix + 'R_';
  writeChunk(destination, completedShellIdAttributeStart);
  writeChunk(destination, stringToChunk(escapeTextForBrowser(shellId)));
  writeChunk(destination, attributeEnd);
}

/** 首次调用时把 shell 完成 ID 追加到 Chunk 数组，并更新已发送位。 */
function pushCompletedShellIdAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  resumableState: ResumableState,
): void {
  if ((resumableState.instructions & SentCompletedShellId) !== NothingSent) {
    return;
  }
  resumableState.instructions |= SentCompletedShellId;
  const idPrefix = resumableState.idPrefix;
  const shellId = '_' + idPrefix + 'R_';
  target.push(
    completedShellIdAttributeStart,
    stringToChunk(escapeTextForBrowser(shellId)),
    attributeEnd,
  );
}

// 当前假设 preamble 一次性全部刷新，因此不返回背压；若要支持背压，
// 需要对 Fizz 刷新状态机做更大范围重构。
/**
 * 一次写完整文档前导区：html/head单例、charset、连接提示、viewport、字体/高图片、precedence样式、配置import map、bootstrap preload、脚本、bulk preload和其它提升内容。输出后清空Chunk/Set中的待发内容，styles Map保留precedence顺序；此批次不因单次write背压拆开或回滚。每请求只调用一次，resume要求这些前导块已完成。
 */
export function writePreambleStart(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
  skipBlockingShell: boolean,
): void {
  // 每个请求必须且只能调用一次。
  if (enableFizzExternalRuntime && renderState.externalRuntimeScript) {
    // 根片段因挂起任务而不完整（如 willFlushAllSegments=false）且采用 data 流格式时，
    // 必须保证外部运行时已发送。若用户预知会挂起，也可更早调用 preinit(...)。
    const {src, chunks} = renderState.externalRuntimeScript;
    internalPreinitScript(resumableState, renderState, src, chunks);
  }

  const preamble = renderState.preamble;

  const htmlChunks = preamble.htmlChunks;
  const headChunks = preamble.headChunks;

  let i = 0;

  // 先输出文档单例开标签，再输出 hoistable 与资源。
  if (htmlChunks) {
    // preamble 明确包含 `<html>`。
    for (i = 0; i < htmlChunks.length; i++) {
      writeChunk(destination, htmlChunks[i]);
    }
    if (headChunks) {
      for (i = 0; i < headChunks.length; i++) {
        writeChunk(destination, headChunks[i]);
      }
    } else {
      // 已输出 `<html>` 却没有显式 `<head>`，补一个隐式 head 以承载资源。
      writeChunk(destination, startChunkForTag('head'));
      writeChunk(destination, endOfStartTag);
    }
  } else if (headChunks) {
    // 没有 `<html>`，但有可直接输出的 `<head>`。
    for (i = 0; i < headChunks.length; i++) {
      writeChunk(destination, headChunks[i]);
    }
  }

  // 输出最高优先级的 hoistable。
  const charsetChunks = renderState.charsetChunks;
  for (i = 0; i < charsetChunks.length; i++) {
    writeChunk(destination, charsetChunks[i]);
  }
  charsetChunks.length = 0;

  // 输出 preconnect/dns-prefetch 资源。
  renderState.preconnects.forEach(flushResource, destination);
  renderState.preconnects.clear();

  const viewportChunks = renderState.viewportChunks;
  for (i = 0; i < viewportChunks.length; i++) {
    writeChunk(destination, viewportChunks[i]);
  }
  viewportChunks.length = 0;

  renderState.fontPreloads.forEach(flushResource, destination);
  renderState.fontPreloads.clear();

  renderState.highImagePreloads.forEach(flushResource, destination);
  renderState.highImagePreloads.clear();

  // 按 precedence 刷新未阻塞的 stylesheet。
  currentlyFlushingRenderState = renderState;
  renderState.styles.forEach(flushStylesInPreamble, destination);
  currentlyFlushingRenderState = null;

  const importMapChunks = renderState.importMapChunks;
  for (i = 0; i < importMapChunks.length; i++) {
    writeChunk(destination, importMapChunks[i]);
  }
  importMapChunks.length = 0;

  renderState.bootstrapScripts.forEach(flushResource, destination);

  renderState.scripts.forEach(flushResource, destination);
  renderState.scripts.clear();

  renderState.bulkPreloads.forEach(flushResource, destination);
  renderState.bulkPreloads.clear();

  if ((htmlChunks || headChunks) && !skipBlockingShell) {
    // 存在 html/head Chunk 表明正在渲染完整文档；应在完整 shell 下载前阻止展示。
    // 重要资源已先发出，随后插入指向 shell 最后正文目标的阻塞指令，
    // 既不延迟关键加载，也防止浏览器过早绘制。
    writeBlockingRenderInstruction(destination, resumableState, renderState);
  } else {
    // 无需新增 shell ID，直接标记已发送；若 bootstrap script 已携带则保持现状。
    resumableState.instructions |= SentCompletedShellId;
  }

  // 最后写入内嵌 hoistable Chunk。
  const hoistableChunks = renderState.hoistableChunks;
  for (i = 0; i < hoistableChunks.length; i++) {
    writeChunk(destination, hoistableChunks[i]);
  }
  hoistableChunks.length = 0;
}

// 当前假设 preamble 一次性全部刷新，因此不返回背压；支持背压需重构 Fizz 刷新状态机。
/** 若存在html或head前导块，闭合显式或隐式head，然后写body单例的前导Chunk；并非仅负责隐式head。 */
export function writePreambleEnd(
  destination: Destination,
  renderState: RenderState,
): void {
  const preamble = renderState.preamble;
  const htmlChunks = preamble.htmlChunks;
  const headChunks = preamble.headChunks;
  if (htmlChunks || headChunks) {
    // 已有 html/head 前导上下文；若 head 是隐式补入，主内容不会闭合它，因此在此统一闭合。
    writeChunk(destination, endChunkForTag('head'));
  }

  const bodyChunks = preamble.bodyChunks;
  if (bodyChunks) {
    for (let i = 0; i < bodyChunks.length; i++) {
      writeChunk(destination, bodyChunks[i]);
    }
  }
}

// 当前假设该批 hoistable 一次性全部刷新，因此不返回背压；支持背压需重构刷新状态机。
/**
 * shell之后刷新新发现的连接/字体/图片、配置import map、脚本、样式preload、bulk preload及普通提升块。仅createRenderState配置的import map有专用优先队列，树中原位importmap仍受发现顺序影响；late stylesheet先建立preload，随后清空临时preload Map，但可恢复资源身份继续去重。
 */
export function writeHoistables(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
): void {
  let i = 0;

  // 输出高优先级 hoistable。

  // shell 已发送；此时再发 charset 已无效，因此省略 charsetChunks。

  const viewportChunks = renderState.viewportChunks;
  for (i = 0; i < viewportChunks.length; i++) {
    writeChunk(destination, viewportChunks[i]);
  }
  viewportChunks.length = 0;

  renderState.preconnects.forEach(flushResource, destination);
  renderState.preconnects.clear();

  renderState.fontPreloads.forEach(flushResource, destination);
  renderState.fontPreloads.clear();

  renderState.highImagePreloads.forEach(flushResource, destination);
  renderState.highImagePreloads.clear();

  // stylesheet 会随随后的渲染指令正式输出；先发 preload 尽早启动网络请求。
  renderState.styles.forEach(preloadLateStyles, destination);

  // 仅提升通过 createRenderState 配置、保证在 preamble 刷新的 import map。
  // 用户直接渲染的 importmap 标签会被当作普通内联脚本，在其他 hoistable 后刷新，顺序可能有问题。

  // bootstrap script 优先级高于普通 script，但只能在 preamble 刷新；此处省略分支以减少成本。

  renderState.scripts.forEach(flushResource, destination);
  renderState.scripts.clear();

  renderState.bulkPreloads.forEach(flushResource, destination);
  renderState.bulkPreloads.clear();

  // 写入内嵌 hoistable Chunk。
  const hoistableChunks = renderState.hoistableChunks;
  for (i = 0; i < hoistableChunks.length; i++) {
    writeChunk(destination, hoistableChunks[i]);
  }
  hoistableChunks.length = 0;
}

/** 在流末尾按记录闭合文档级 body/html 单例。 */
export function writePostamble(
  destination: Destination,
  resumableState: ResumableState,
): void {
  if (resumableState.hasBody) {
    writeChunk(destination, endChunkForTag('body'));
  }
  if (resumableState.hasHtml) {
    writeChunk(destination, endChunkForTag('html'));
  }
}

/** 二维依赖数组及其首个子数组的起始括号。 */
const arrayFirstOpenBracket = stringToPrecomputedChunk('[');
/** 后续子数组前的逗号与起始括号。 */
const arraySubsequentOpenBracket = stringToPrecomputedChunk(',[');
/** 数组元素之间的逗号分隔 Chunk。 */
const arrayInterstitial = stringToPrecomputedChunk(',');
/** 数组或子数组的闭合括号 Chunk。 */
const arrayCloseBracket = stringToPrecomputedChunk(']');

// 写入可嵌入 JavaScript 的二维字符串数组，例如：
//  [["JS_escaped_string1", "JS_escaped_string2"]]
/**
 * 把边界stylesheet依赖写为JavaScript二维数组字面量。PREAMBLE资源已在head输出而跳过；LATE资源只写href，其它状态首次写[href,precedence,属性名,值,...]后标记LATE。这些状态描述服务器已写哪类协议，不代表浏览器加载完成；完整描述净化URL，已缓存的href简写按既有身份使用。
 */
function writeStyleResourceDependenciesInJS(
  destination: Destination,
  hoistableState: HoistableState,
): void {
  writeChunk(destination, arrayFirstOpenBracket);

  let nextArrayOpenBrackChunk = arrayFirstOpenBracket;
  hoistableState.stylesheets.forEach(resource => {
    if (resource.state === PREAMBLE) {
      // 该依赖已在 shell 刷新，客户端展示内容前应已就绪，可省略。
    } else if (resource.state === LATE) {
      // 该资源已由更早边界输出完整属性；这里只需发送 href 以引用客户端实例。
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyHrefOnlyInJS(
        destination,
        resource.props.href,
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
    } else {
      // 客户端尚无该实例，必须发送完整资源描述，并把状态推进为 LATE。
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyInJS(
        destination,
        resource.props.href,
        resource.props['data-precedence'],
        resource.props,
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;

      resource.state = LATE;
    }
  });
  writeChunk(destination, arrayCloseBracket);
}

/* 辅助函数。 */
/** 仅把已存在 stylesheet 的 href 编码进 JavaScript 依赖数组。 */
function writeStyleResourceDependencyHrefOnlyInJS(
  destination: Destination,
  href: string,
) {
  // 理想情况下资源创建时就应强制为字符串；当前在最终编码点再次保证类型安全。
  if (__DEV__) {
    checkAttributeStringCoercion(href, 'href');
  }
  const coercedHref = '' + (href as any);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedHref)),
  );
}

/** 把新 stylesheet 的 href、precedence 与安全属性编码进 JavaScript 依赖数组。 */
function writeStyleResourceDependencyInJS(
  destination: Destination,
  href: mixed,
  precedence: mixed,
  props: Object,
) {
  // eslint-disable-next-line react-internal/safe-string-coercion
  const coercedHref = sanitizeURL('' + (href as any));
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedHref)),
  );

  if (__DEV__) {
    checkAttributeStringCoercion(precedence, 'precedence');
  }
  const coercedPrecedence = '' + (precedence as any);
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedPrecedence)),
  );

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'href':
        case 'rel':
        case 'precedence':
        case 'data-precedence': {
          break;
        }
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'link'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        default:
          writeStyleResourceAttributeInJS(destination, propKey, propValue);
          break;
      }
    }
  }
  return null;
}

/** 把单个安全 stylesheet 属性编码为 JavaScript 数组中的名称/值对。 */
function writeStyleResourceAttributeInJS(
  destination: Destination,
  name: string,
  value: string | boolean | number | Function | Object, // 不含 null 或 undefined
): void {
  let attributeName = name.toLowerCase();
  let attributeValue;
  switch (typeof value) {
    case 'function':
    case 'symbol':
      return;
  }

  switch (name) {
    // React 保留属性。
    case 'innerHTML':
    case 'dangerouslySetInnerHTML':
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'style':
    case 'ref':
      // 不序列化。
      return;

    // 属性重命名。
    case 'className': {
      attributeName = 'class';
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value as any);
      break;
    }
    // 布尔属性。
    case 'hidden': {
      if (value === false) {
        return;
      }
      attributeValue = '';
      break;
    }
    // 需要净化的 URL。
    case 'src':
    case 'href': {
      value = sanitizeURL(value);
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value as any);
      break;
    }
    default: {
      if (
        // 未识别事件处理器不参与 SSR；以 on* 作为处理器属性的启发式判定。
        name.length > 2 &&
        (name[0] === 'o' || name[0] === 'O') &&
        (name[1] === 'n' || name[1] === 'N')
      ) {
        return;
      }
      if (!isAttributeNameSafe(name)) {
        return;
      }
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value as any);
    }
  }
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(attributeName)),
  );
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(attributeValue)),
  );
}

// 写入嵌入 HTML 属性值、由 ReactDOMServerExternalRuntime.js 用 JSON.parse 读取的二维数组，例如：
//  [[&quot;JSON_escaped_string1&quot;, &quot;JSON_escaped_string2&quot;]]
/**
 * 以HTML属性内JSON数组编码边界stylesheet依赖：PREAMBLE跳过、LATE只写href，其它状态写完整扁平描述后改为LATE。先满足JSON结构再做HTML属性转义；属性过滤与普通pushAttribute不同，不能把LATE理解为客户端CSS已加载。
 */
function writeStyleResourceDependenciesInAttr(
  destination: Destination,
  hoistableState: HoistableState,
): void {
  writeChunk(destination, arrayFirstOpenBracket);

  let nextArrayOpenBrackChunk = arrayFirstOpenBracket;
  hoistableState.stylesheets.forEach(resource => {
    if (resource.state === PREAMBLE) {
      // 该依赖已在 shell 刷新，客户端展示内容前应已就绪，可省略。
    } else if (resource.state === LATE) {
      // 该资源已由更早边界输出完整属性；这里只需发送 href 引用客户端实例。
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyHrefOnlyInAttr(
        destination,
        resource.props.href,
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
    } else {
      // 客户端尚无该实例，必须发送完整资源描述，并把状态推进为 LATE。
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyInAttr(
        destination,
        resource.props.href,
        resource.props['data-precedence'],
        resource.props,
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;

      resource.state = LATE;
    }
  });
  writeChunk(destination, arrayCloseBracket);
}

/* 辅助函数。 */
/** 仅把已存在 stylesheet 的 href 编码进 HTML 属性依赖数组。 */
function writeStyleResourceDependencyHrefOnlyInAttr(
  destination: Destination,
  href: string,
) {
  // 理想情况下资源创建时就应强制为字符串；当前在最终编码点再次保证类型安全。
  if (__DEV__) {
    checkAttributeStringCoercion(href, 'href');
  }
  const coercedHref = '' + (href as any);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(coercedHref))),
  );
}

/** 把新 stylesheet 的 href、precedence 与安全属性编码进 HTML 属性依赖数组。 */
function writeStyleResourceDependencyInAttr(
  destination: Destination,
  href: mixed,
  precedence: mixed,
  props: Object,
) {
  // eslint-disable-next-line react-internal/safe-string-coercion
  const coercedHref = sanitizeURL('' + (href as any));
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(coercedHref))),
  );

  if (__DEV__) {
    checkAttributeStringCoercion(precedence, 'precedence');
  }
  const coercedPrecedence = '' + (precedence as any);
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(coercedPrecedence))),
  );

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'href':
        case 'rel':
        case 'precedence':
        case 'data-precedence': {
          break;
        }
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'link'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        default:
          writeStyleResourceAttributeInAttr(destination, propKey, propValue);
          break;
      }
    }
  }
  return null;
}

/** 把单个安全 stylesheet 属性编码为 HTML 属性 JSON 中的名称/值对。 */
function writeStyleResourceAttributeInAttr(
  destination: Destination,
  name: string,
  value: string | boolean | number | Function | Object, // 不含 null 或 undefined
): void {
  let attributeName = name.toLowerCase();
  let attributeValue;
  switch (typeof value) {
    case 'function':
    case 'symbol':
      return;
  }

  switch (name) {
    // React 保留属性。
    case 'innerHTML':
    case 'dangerouslySetInnerHTML':
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'style':
    case 'ref':
      // 不序列化。
      return;

    // 属性重命名。
    case 'className': {
      attributeName = 'class';
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value as any);
      break;
    }

    // 布尔属性。
    case 'hidden': {
      if (value === false) {
        return;
      }
      attributeValue = '';
      break;
    }

    // 需要净化的 URL。
    case 'src':
    case 'href': {
      value = sanitizeURL(value);
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value as any);
      break;
    }
    default: {
      if (
        // 未识别事件处理器不参与 SSR；以 on* 作为处理器属性的启发式判定。
        name.length > 2 &&
        (name[0] === 'o' || name[0] === 'O') &&
        (name[1] === 'n' || name[1] === 'N')
      ) {
        return;
      }
      if (!isAttributeNameSafe(name)) {
        return;
      }
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value as any);
    }
  }
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(attributeName))),
  );
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(attributeValue))),
  );
}

/**
 * 资源状态与属性模型。
 */

/** stylesheet 从发现、预加载、前导刷新到延迟刷新的状态编码。 */
type StylesheetState = 0 | 1 | 2 | 3;
/** stylesheet 已登记但尚未发送。 */
const PENDING: StylesheetState = 0;
/** stylesheet 的 preload 已发送，但正式 link 尚未输出。 */
const PRELOADED: StylesheetState = 1;
/** stylesheet 已在 preamble/shell 中输出。 */
const PREAMBLE: StylesheetState = 2;
/** stylesheet 已随某个完成边界延迟输出。 */
const LATE: StylesheetState = 3;

/** DNS 预取或跨源预连接 link 的最小属性集合。 */
type PreconnectProps = {
  /** 选择 DNS 预取或完整预连接。 */
  rel: 'preconnect' | 'dns-prefetch',
  /** 目标源或 URL。 */
  href: string,
  /** 透传其余安全 link 属性。 */
  [string]: mixed,
};

/** `rel=preload` 资源的属性集合。 */
type PreloadAsProps = {
  /** 固定资源关系类型。 */
  rel: 'preload',
  /** 浏览器资源类别，如 image/style/font。 */
  as: string,
  /** 资源地址；响应式图片在兼容性路径可省略。 */
  href: ?string,
  /** 其余可选 preload 属性。 */
  [string]: ?string,
};
/** `rel=modulepreload` 模块资源属性。 */
type PreloadModuleProps = {
  /** 固定模块预加载关系类型。 */
  rel: 'modulepreload',
  /** 模块资源地址。 */
  href: ?string,
  /** 其余可选模块 preload 属性。 */
  [string]: ?string,
};
/** 普通或模块 preload 属性联合。 */
type PreloadProps = PreloadAsProps | PreloadModuleProps;

/** 可提升的异步经典脚本属性。 */
type ScriptProps = {
  /** 资源脚本必须异步，才能安全改变输出位置。 */
  async: true,
  /** 外部脚本地址。 */
  src: string,
  /** 可选跨源凭据策略。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 其余安全脚本属性。 */
  [string]: mixed,
};
/** 可提升的异步 ES 模块脚本属性。 */
type ModuleScriptProps = {
  /** 模块资源脚本必须异步。 */
  async: true,
  /** 外部模块地址。 */
  src: string,
  /** 固定为模块脚本类型。 */
  type: 'module',
  /** 可选跨源凭据策略。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 其余安全脚本属性。 */
  [string]: mixed,
};

/** 已编码、可进入任一刷新队列的 Chunk 数组。 */
export type Resource = Array<Chunk | PrecomputedChunk>;

/** 可提升 stylesheet link 的标准化属性。 */
type StylesheetProps = {
  /** 固定资源关系类型。 */
  rel: 'stylesheet',
  /** 样式表地址，也是资源去重键来源。 */
  href: string,
  /** 决定服务端与客户端插入顺序的优先级名称。 */
  'data-precedence': string,
  /** 跨源凭据策略。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 子资源完整性摘要。 */
  integrity?: ?string,
  /** 内容安全策略的nonce值。 */
  nonce?: ?string,
  /** MIME 类型提示。 */
  type?: ?string,
  /** 浏览器抓取优先级提示。 */
  fetchPriority?: ?string,
  /** referrer 策略。 */
  referrerPolicy?: ?string,
  /** 媒体查询。 */
  media?: ?string,
  /** 其余经校验可透传的 link 属性。 */
  [string]: mixed,
};
/** stylesheet 的标准化 props 与生命周期状态。 */
type StylesheetResource = {
  /** 用于最终构造 link/preload 的属性。 */
  props: StylesheetProps,
  /** 当前发送阶段，控制去重与边界依赖编码。 */
  state: StylesheetState,
};

/** 单个 Suspense 边界收集的样式依赖与阻塞图片信号。 */
export type HoistableState = {
  /** 边界引用的内联 style precedence 队列。 */
  styles: Set<StyleQueue>,
  /** 边界引用的外部 stylesheet 资源。 */
  stylesheets: Set<StylesheetResource>,
  /** 边界是否包含会阻塞揭示的图片。 */
  suspenseyImages: boolean,
};

/** 同一 precedence 下可连续追加的 style 与 stylesheet 集合。 */
export type StyleQueue = {
  /** 预编码的 precedence 值。 */
  precedence: Chunk | PrecomputedChunk,
  /** 尚未刷新的 CSS 规则 Chunk。 */
  rules: Array<Chunk | PrecomputedChunk>,
  /** 与规则对应、用于客户端去重的 href Chunk。 */
  hrefs: Array<Chunk | PrecomputedChunk>,
  /** 尚未在该优先级刷新完毕的 stylesheet。 */
  sheets: Map<string, StylesheetResource>,
};

/** 创建空的边界 hoistable 收集状态。 */
export function createHoistableState(): HoistableState {
  return {
    styles: new Set(),
    stylesheets: new Set(),
    suspenseyImages: false,
  };
}

/** 返回普通资源以 href 为基础的稳定去重键。 */
function getResourceKey(href: string): string {
  return href;
}

/**
 * 返回图片资源去重键；响应式图片以 srcSet+sizes 标识实际候选集合，否则使用 href。
 */
function getImageResourceKey(
  href: string,
  imageSrcSet?: ?string,
  imageSizes?: ?string,
): string {
  if (imageSrcSet) {
    return imageSrcSet + '\n' + (imageSizes || '');
  }
  return href;
}

/**
 * 当前请求首次出现href时先写资源去重身份，再尝试扣减Link头预算，足够才追加header，否则登记link Chunk并请求资源刷新。无请求时转交previousDispatcher；本层只对有请求的非空string href编码。
 */
function prefetchDNS(href: string) {
  const request = resolveRequest();
  if (!request) {
    // 异步上下文通常可从 AsyncLocalStorage 解析请求，非异步上下文还可尝试调用栈。
    // 两条路径都失败时转交上一层dispatcher，由该实现决定后续行为：渲染外调用可能是有意预热数据，不宜警告。
    previousDispatcher.D(/* prefetchDNS */ href);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);

  if (typeof href === 'string' && href) {
    const key = getResourceKey(href);
    if (!resumableState.dnsResources.hasOwnProperty(key)) {
      resumableState.dnsResources[key] = EXISTS;

      const headers = renderState.headers;
      let header;
      if (
        headers &&
        headers.remainingCapacity > 0 &&
        // 先构造响应头，才能判断是否落在容量上限内。
        ((header = getPrefetchDNSAsHeader(href)),
        // 无论是否装得下都扣减长度；一旦转负，后续资源快速跳过，
        // 避免在极小余量下反复构造必然失败的头。预渲染将来可改为更重视容量利用率的策略。
        (headers.remainingCapacity -= header.length + 2) >= 0)
      ) {
        // 记录为可重置项；预渲染若在 shell 延后，可正确恢复去重状态。
        renderState.resets.dns[key] = EXISTS;
        if (headers.preconnects) {
          headers.preconnects += ', ';
        }
        // $FlowFixMe[unsafe-addition]：header 已在 if 条件中赋值。
        headers.preconnects += header;
      } else {
        // 响应头容量不足，退回 link 元素编码。
        const resource: Resource = [];
        pushLinkImpl(resource, {href, rel: 'dns-prefetch'} as PreconnectProps);
        renderState.preconnects.add(resource);
      }
    }
    flushResources(request);
  }
}

/**
 * 按未指定、anonymous或use-credentials桶为当前请求去重连接提示，再以Link头预算选择header或link资源。无请求时转交previousDispatcher；新资源调用flushResources安排刷新，重复键直接返回而不再次刷新。
 */
function preconnect(href: string, crossOrigin: ?CrossOriginEnum) {
  const request = resolveRequest();
  if (!request) {
    // 异步上下文通常可从 AsyncLocalStorage 解析请求，非异步上下文还可尝试调用栈。
    // 两条路径都失败时转交上一层dispatcher，由该实现决定后续行为，允许渲染外有意预热。
    previousDispatcher.C(/* preconnect */ href, crossOrigin);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);

  if (typeof href === 'string' && href) {
    const bucket =
      crossOrigin === 'use-credentials'
        ? 'credentials'
        : typeof crossOrigin === 'string'
          ? 'anonymous'
          : 'default';
    const key = getResourceKey(href);
    if (!resumableState.connectResources[bucket].hasOwnProperty(key)) {
      resumableState.connectResources[bucket][key] = EXISTS;

      const headers = renderState.headers;
      let header;
      if (
        headers &&
        headers.remainingCapacity > 0 &&
        // 先构造响应头，才能判断是否落在容量上限内。
        ((header = getPreconnectAsHeader(href, crossOrigin)),
        // 无论是否装得下都扣减长度；一旦转负，后续资源快速跳过，
        // 避免在极小余量下反复构造必然失败的头。预渲染将来可采用不同策略。
        (headers.remainingCapacity -= header.length + 2) >= 0)
      ) {
        // 写入可重置状态；预渲染若在 shell 延后，可正确恢复去重记录。
        renderState.resets.connect[bucket][key] = EXISTS;
        if (headers.preconnects) {
          headers.preconnects += ', ';
        }
        // $FlowFixMe[unsafe-addition]：header 已在 if 条件中赋值。
        headers.preconnects += header;
      } else {
        const resource: Resource = [];
        pushLinkImpl(resource, {
          rel: 'preconnect',
          href,
          crossOrigin,
        } as PreconnectProps);
        renderState.preconnects.add(resource);
      }
    }
    flushResources(request);
  }
}

/**
 * 在当前请求登记普通preload，按as拆分资源表，图片键另含srcSet/sizes，style/script保留可被正式资源继承的凭据。依赖公开API先做类型筛选，此处请求路径主要检查href/as真值；图片可选高队列或Link头，font优先header，其它资源入各自Set/Map。首次登记后flushResources安排输出，重复身份返回；无请求交上一层dispatcher。
 */
function preload(href: string, as: string, options?: ?PreloadImplOptions) {
  const request = resolveRequest();
  if (!request) {
    // 无法从 AsyncLocalStorage 或调用栈解析请求时，转交上一层dispatcher，由该实现决定后续行为；
    // 渲染外 preload 可能是有意的数据预热。
    previousDispatcher.L(/* preload */ href, as, options);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);
  if (as && href) {
    switch (as) {
      case 'image': {
        let imageSrcSet, imageSizes, fetchPriority;
        if (options) {
          imageSrcSet = options.imageSrcSet;
          imageSizes = options.imageSizes;
          fetchPriority = options.fetchPriority;
        }
        const key = getImageResourceKey(href, imageSrcSet, imageSizes);
        if (resumableState.imageResources.hasOwnProperty(key)) {
          // 资源已登记，直接返回以保持去重。
          return;
        }
        resumableState.imageResources[key] = PRELOAD_NO_CREDS;

        const headers = renderState.headers;
        let header: string;
        if (
          headers &&
          headers.remainingCapacity > 0 &&
          // 浏览器目前不支持从 Link 响应头预加载响应式图片；存在 srcSet 时跳过头格式。
          typeof imageSrcSet !== 'string' &&
          // Link 响应头只承载显式高优先级图片。
          fetchPriority === 'high' &&
          // 先构造响应头，才能判断是否落在容量上限内。
          ((header = getPreloadAsHeader(href, as, options)),
          // 无论是否装得下都扣减长度；一旦转负，后续资源快速跳过，避免反复尝试必然失败的头。
          // 预渲染将来可采用更重视响应头容量利用率的策略。
          (headers.remainingCapacity -= header.length + 2) >= 0)
        ) {
          // shell 延后时该 preload 仍已通过响应头发送，记录到 resets 以免错误清除。
          renderState.resets.image[key] = PRELOAD_NO_CREDS;
          if (headers.highImagePreloads) {
            headers.highImagePreloads += ', ';
          }
          // $FlowFixMe[unsafe-addition]：header 已在 if 条件中赋值。
          headers.highImagePreloads += header;
        } else {
          // 无可用响应头时编码为 head 内元素。存在 imageSrcSet 时，浏览器可能无法从头选择正确候选；
          // 在测试充分验证前，即使头可用也保守采用元素形式。
          const resource = [] as Resource;
          pushLinkImpl(
            resource,
            Object.assign(
              {
                rel: 'preload',
                // Safari preload link 会忽略 imageSrcSet；存在 srcSet 时省略 href，避免加载错误图片。
                // 旧浏览器会失去该预加载，但其占比很小，接受此兼容性权衡。
                href: imageSrcSet ? undefined : href,
                as,
              } as PreloadAsProps,
              options,
            ),
          );
          if (fetchPriority === 'high') {
            renderState.highImagePreloads.add(resource);
          } else {
            renderState.bulkPreloads.add(resource);
            // 暂存资源；若随后真实 img 以更高优先级渲染，可将其晋升。
            renderState.preloads.images.set(key, resource);
          }
        }
        break;
      }
      case 'style': {
        const key = getResourceKey(href);
        if (resumableState.styleResources.hasOwnProperty(key)) {
          // 资源已登记，直接返回以保持去重。
          return;
        }
        const resource = [] as Resource;
        pushLinkImpl(
          resource,
          Object.assign({rel: 'preload', href, as} as PreloadAsProps, options),
        );
        resumableState.styleResources[key] =
          options &&
          (typeof options.crossOrigin === 'string' ||
            typeof options.integrity === 'string')
            ? [options.crossOrigin, options.integrity]
            : PRELOAD_NO_CREDS;
        renderState.preloads.stylesheets.set(key, resource);
        renderState.bulkPreloads.add(resource);
        break;
      }
      case 'script': {
        const key = getResourceKey(href);
        if (resumableState.scriptResources.hasOwnProperty(key)) {
          // 资源已登记，直接返回以保持去重。
          return;
        }
        const resource = [] as Resource;
        renderState.preloads.scripts.set(key, resource);
        renderState.bulkPreloads.add(resource);
        pushLinkImpl(
          resource,
          Object.assign({rel: 'preload', href, as} as PreloadAsProps, options),
        );
        resumableState.scriptResources[key] =
          options &&
          (typeof options.crossOrigin === 'string' ||
            typeof options.integrity === 'string')
            ? [options.crossOrigin, options.integrity]
            : PRELOAD_NO_CREDS;
        break;
      }
      default: {
        const key = getResourceKey(href);
        const hasAsType = resumableState.unknownResources.hasOwnProperty(as);
        let resources;
        if (hasAsType) {
          resources = resumableState.unknownResources[as];
          if (resources.hasOwnProperty(key)) {
            // 相同 as/href 已登记，直接返回以保持去重。
            return;
          }
        } else {
          resources = {} as ResumableState['unknownResources']['asType'];
          resumableState.unknownResources[as] = resources;
        }
        resources[key] = PRELOAD_NO_CREDS;

        const headers = renderState.headers;
        let header;
        if (
          headers &&
          headers.remainingCapacity > 0 &&
          as === 'font' &&
          // 先构造字体 preload 响应头，才能判断是否落在容量上限内。
          ((header = getPreloadAsHeader(href, as, options)),
          // 无论是否装得下都扣减长度；一旦转负，后续资源快速跳过，避免反复尝试必然失败的头。
          // 预渲染将来可采用更重视响应头容量利用率的策略。
          (headers.remainingCapacity -= header.length + 2) >= 0)
        ) {
          // shell 延后时该 preload 仍已发送，记录到 resets 防止恢复时丢失事实。
          renderState.resets.font[key] = PRELOAD_NO_CREDS;
          if (headers.fontPreloads) {
            headers.fontPreloads += ', ';
          }
          // $FlowFixMe[unsafe-addition]：header 已在 if 条件中赋值。
          headers.fontPreloads += header;
        } else {
          // 没有响应头容量，或资源不值得提升到头优先级，改为元素编码。
          const resource = [] as Resource;
          const props = Object.assign(
            {
              rel: 'preload',
              href,
              as,
            } as PreloadAsProps,
            options,
          );
          pushLinkImpl(resource, props);
          switch (as) {
            case 'font':
              renderState.fontPreloads.add(resource);
              break;
            // 有意 fallthrough：非字体资源统一进入 bulk 队列。
            default:
              renderState.bulkPreloads.add(resource);
          }
        }
      }
    }
    // 到达此处说明已创建新资源，通知请求尽快刷新。
    flushResources(request);
  }
}

/**
 * 在当前请求按模块script与其它as分别去重modulepreload，缺少字符串as时用script。它不写Link响应头，编码后进入bulk preload队列并调用flushResources；无请求交上一层dispatcher，重复键不重复编码。
 */
function preloadModule(
  href: string,
  options?: ?PreloadModuleImplOptions,
): void {
  const request = resolveRequest();
  if (!request) {
    // 无法从 AsyncLocalStorage 或调用栈解析请求时，转交上一层dispatcher，由该实现决定后续行为；
    // 渲染外调用可能是有意预热。
    previousDispatcher.m(/* preloadModule */ href, options);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);
  if (href) {
    const key = getResourceKey(href);
    const as =
      options && typeof options.as === 'string' ? options.as : 'script';

    let resource;
    switch (as) {
      case 'script': {
        if (resumableState.moduleScriptResources.hasOwnProperty(key)) {
          // 模块脚本资源已登记，直接返回以保持去重。
          return;
        }
        resource = [] as Resource;
        resumableState.moduleScriptResources[key] =
          options &&
          (typeof options.crossOrigin === 'string' ||
            typeof options.integrity === 'string')
            ? [options.crossOrigin, options.integrity]
            : PRELOAD_NO_CREDS;
        renderState.preloads.moduleScripts.set(key, resource);
        break;
      }
      default: {
        const hasAsType =
          resumableState.moduleUnknownResources.hasOwnProperty(as);
        let resources;
        if (hasAsType) {
          resources = resumableState.moduleUnknownResources[as];
          if (resources.hasOwnProperty(key)) {
            // 相同 as/href 已登记，直接返回以保持去重。
            return;
          }
        } else {
          resources = {} as ResumableState['moduleUnknownResources']['asType'];
          resumableState.moduleUnknownResources[as] = resources;
        }
        resource = [] as Resource;
        resources[key] = PRELOAD_NO_CREDS;
      }
    }

    pushLinkImpl(
      resource,
      Object.assign(
        {
          rel: 'modulepreload',
          href,
        } as PreloadModuleProps,
        options,
      ),
    );
    renderState.bulkPreloads.add(resource);
    // 到达此处说明已创建新资源，通知请求尽快刷新。
    flushResources(request);
  }
}

/**
 * 按href将正式stylesheet标记EXISTS并加入稳定precedence队列，默认precedence为default。若先前preload保存两项凭据则仅填目标缺失项；本次未发preload清空避免重复，先前已发则标PRELOADED。这里仅登记和安排flush，不等浏览器CSS加载；无请求交previousDispatcher。
 */
function preinitStyle(
  href: string,
  precedence: ?string,
  options?: ?PreinitStyleOptions,
): void {
  const request = resolveRequest();
  if (!request) {
    // 无法从 AsyncLocalStorage 或调用栈解析请求时，转交上一层dispatcher，由该实现决定后续行为。
    previousDispatcher.S(/* preinitStyle */ href, precedence, options);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);
  if (href) {
    precedence = precedence || 'default';
    const key = getResourceKey(href);

    let styleQueue = renderState.styles.get(precedence);
    const hasKey = resumableState.styleResources.hasOwnProperty(key);
    const resourceState = hasKey
      ? resumableState.styleResources[key]
      : undefined;
    if (resourceState !== EXISTS) {
      // 即将创建正式 stylesheet，先标记 EXISTS 阻止重复初始化。
      resumableState.styleResources[key] = EXISTS;

      // 首次遇到该 precedence 时创建对应 StyleQueue，维持稳定插入顺序。
      if (!styleQueue) {
        styleQueue = {
          precedence: stringToChunk(escapeTextForBrowser(precedence)),
          rules: [] as Array<Chunk | PrecomputedChunk>,
          hrefs: [] as Array<Chunk | PrecomputedChunk>,
          sheets: new Map() as Map<string, StylesheetResource>,
        };
        renderState.styles.set(precedence, styleQueue);
      }

      const resource = {
        state: PENDING,
        props: Object.assign(
          {
            rel: 'stylesheet',
            href,
            'data-precedence': precedence,
          } as StylesheetProps,
          options,
        ),
      };

      if (resourceState) {
        // resourceState 为真时代表 preload 状态；显式收窄以读取可继承凭据。
        const preloadState: Preloaded | PreloadedWithCredentials =
          resourceState;
        if (preloadState.length === 2) {
          adoptPreloadCredentials(resource.props, preloadState);
        }

        const preloadResource = renderState.preloads.stylesheets.get(key);
        if (preloadResource && preloadResource.length > 0) {
          // preload 由本次渲染创建且尚未刷新；清空其 Chunk，避免正式 stylesheet 之外重复输出。
          preloadResource.length = 0;
        } else {
          // preload 已在本次更早阶段或先前预渲染阶段刷新；把正式资源标记为 PRELOADED。
          resource.state = PRELOADED;
        }
      } else {
        // 无需再查 renderState 中的 preload：若存在，对应 resourceState 必然存在并已进入上方分支。
      }

      // 把新资源加入 precedence 队列；当前边界若引用它，会在后续收集依赖。
      styleQueue.sheets.set(key, resource);

      // 即使当前无渲染工作，也通知请求存在待刷新资源。
      flushResources(request);
    }
  }
}

/**
 * 按src去重异步经典script，先标EXISTS阻止重入，再继承先前preload的缺失凭据并清空尚未发的preload Chunk。编码正式脚本入scripts Set后flushResources安排输出；无请求交previousDispatcher，不启动或等待网络加载。
 */
function preinitScript(src: string, options?: ?PreinitScriptOptions): void {
  const request = resolveRequest();
  if (!request) {
    // 无法从 AsyncLocalStorage 或调用栈解析请求时，转交上一层dispatcher，由该实现决定后续行为。
    previousDispatcher.X(/* preinitScript */ src, options);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);
  if (src) {
    const key = getResourceKey(src);

    const hasKey = resumableState.scriptResources.hasOwnProperty(key);
    const resourceState = hasKey
      ? resumableState.scriptResources[key]
      : undefined;
    if (resourceState !== EXISTS) {
      // 即将创建正式脚本资源，先标记 EXISTS 阻止重复初始化。
      resumableState.scriptResources[key] = EXISTS;

      const props: ScriptProps = Object.assign(
        {
          src,
          async: true,
        } as ScriptProps,
        options,
      );
      if (resourceState) {
        // resourceState 为真时代表 preload 状态；显式收窄以读取可继承凭据。
        const preloadState: Preloaded | PreloadedWithCredentials =
          resourceState;
        if (preloadState.length === 2) {
          adoptPreloadCredentials(props, preloadState);
        }

        const preloadResource = renderState.preloads.scripts.get(key);
        if (preloadResource) {
          // preload 由本次渲染创建；正式脚本会更早输出，若 preload 尚未刷新则将其清空避免重复。
          preloadResource.length = 0;
        }
      }

      const resource: Resource = [];
      // 加入脚本刷新队列。
      renderState.scripts.add(resource);
      // 预先把脚本标签编码为 Chunk。
      pushScriptImpl(resource, props);
      // 即使当前无渲染工作，也通知请求存在待刷新资源。
      flushResources(request);
    }
    return;
  }
}

/**
 * 按模块资源表为src去重async type=module脚本，吸收modulepreload凭据并清空本次重复Chunk。与经典script使用独立身份表，但输出都进入scripts Set；flushResources仅安排服务器输出，无请求交previousDispatcher。
 */
function preinitModuleScript(
  src: string,
  options?: ?PreinitModuleScriptOptions,
): void {
  const request = resolveRequest();
  if (!request) {
    // 无法从 AsyncLocalStorage 或调用栈解析请求时，转交上一层dispatcher，由该实现决定后续行为。
    previousDispatcher.M(/* preinitModuleScript */ src, options);
    return;
  }
  const resumableState = getResumableState(request);
  const renderState = getRenderState(request);
  if (src) {
    const key = getResourceKey(src);
    const hasKey = resumableState.moduleScriptResources.hasOwnProperty(key);
    const resourceState = hasKey
      ? resumableState.moduleScriptResources[key]
      : undefined;
    if (resourceState !== EXISTS) {
      // 即将创建正式模块脚本，先标记 EXISTS 阻止重复初始化。
      resumableState.moduleScriptResources[key] = EXISTS;

      const props = Object.assign(
        {
          src,
          type: 'module',
          async: true,
        } as ModuleScriptProps,
        options,
      );
      if (resourceState) {
        // resourceState 为真时代表 preload 状态；显式收窄以读取可继承凭据。
        const preloadState: Preloaded | PreloadedWithCredentials =
          resourceState;
        if (preloadState.length === 2) {
          adoptPreloadCredentials(props, preloadState);
        }

        const preloadResource = renderState.preloads.moduleScripts.get(key);
        if (preloadResource) {
          // modulepreload 由本次渲染创建；正式脚本会更早输出，尚未刷新时清空以避免重复。
          preloadResource.length = 0;
        }
      }

      const resource: Resource = [];
      // 加入脚本刷新队列。
      renderState.scripts.add(resource);
      // 预先把模块脚本标签编码为 Chunk。
      pushScriptImpl(resource, props);
      // 即使当前无渲染工作，也通知请求存在待刷新资源。
      flushResources(request);
    }
    return;
  }
}

// 该函数只可在请求开始时调用，因为它假定模块尚未预加载；
// 若将来在其他阶段调用，必须显式检查既有 preload，不能依赖此假设。
/** 为 bootstrap script/module 建立专用 preload，并封锁其被 preinit 提前输出的键。 */
function preloadBootstrapScriptOrModule(
  resumableState: ResumableState,
  renderState: RenderState,
  href: string,
  props: PreloadProps,
): void {
  const key = getResourceKey(href);

  if (__DEV__) {
    if (
      resumableState.scriptResources.hasOwnProperty(key) ||
      resumableState.moduleScriptResources.hasOwnProperty(key)
    ) {
      // 用户态 preload 理论上不可能抢在该调用之前；若发生，说明内部时序假设失效，
      // 应重新设计策略，而不是要求用户不要自行预加载 bootstrap 脚本。
      console.error(
        'Internal React Error: React expected bootstrap script or module with src "%s" to not have been preloaded already. please file an issue',
        href,
      );
    }
  }

  // bootstrap href 绝不能再用于 preinit：能安全提前输出的脚本就不应属于 bootstrap；
  // 反之 bootstrap 必须保持原时序。占用经典/模块两张资源表的键，阻止后续提前初始化。
  resumableState.scriptResources[key] = EXISTS;
  resumableState.moduleScriptResources[key] = EXISTS;

  const resource: Resource = [];
  pushLinkImpl(resource, props);
  renderState.bootstrapScripts.add(resource);
}

/** 从内部已编码 Chunk 初始化外部运行时脚本，按 src 去重并加入刷新队列。 */
function internalPreinitScript(
  resumableState: ResumableState,
  renderState: RenderState,
  src: string,
  chunks: Array<Chunk | PrecomputedChunk>,
): void {
  const key = getResourceKey(src);
  if (!resumableState.scriptResources.hasOwnProperty(key)) {
    const resource: Resource = chunks;
    resumableState.scriptResources[key] = EXISTS;
    renderState.scripts.add(resource);
  }
  return;
}

/** 从 stylesheet props 投影出安全的 `as=style` preload 属性。 */
function preloadAsStylePropsFromProps(href: string, props: any): PreloadProps {
  return {
    rel: 'preload',
    as: 'style',
    href: href,
    crossOrigin: props.crossOrigin,
    fetchPriority: props.fetchPriority,
    integrity: props.integrity,
    media: props.media,
    hrefLang: props.hrefLang,
    referrerPolicy: props.referrerPolicy,
  };
}

/** 把 React 的 precedence 属性规范化为服务端使用的 data-precedence。 */
function stylesheetPropsFromRawProps(rawProps: any): StylesheetProps {
  return {
    ...rawProps,
    'data-precedence': rawProps.precedence,
    precedence: null,
  };
}

/** 若正式资源未显式提供凭据，则继承先前 preload 的 crossOrigin/integrity。 */
function adoptPreloadCredentials(
  target: StylesheetProps | ScriptProps | ModuleScriptProps,
  preloadState: PreloadedWithCredentials,
): void {
  if (target.crossOrigin == null) target.crossOrigin = preloadState[0];
  if (target.integrity == null) target.integrity = preloadState[1];
}

/** 构造经 URL 上下文转义的 dns-prefetch Link 响应头条目。 */
function getPrefetchDNSAsHeader(href: string): string {
  const escapedHref = escapeHrefForLinkHeaderURLContext(href);
  return `<${escapedHref}>; rel=dns-prefetch`;
}

/** 构造经 URL/引号参数转义的 preconnect Link 响应头条目。 */
function getPreconnectAsHeader(
  href: string,
  crossOrigin?: ?CrossOriginEnum,
): string {
  const escapedHref = escapeHrefForLinkHeaderURLContext(href);
  let value = `<${escapedHref}>; rel=preconnect`;
  if (typeof crossOrigin === 'string') {
    const escapedCrossOrigin = escapeStringForLinkHeaderQuotedParamValueContext(
      crossOrigin,
      'crossOrigin',
    );
    value += `; crossorigin="${escapedCrossOrigin}"`;
  }
  return value;
}

/** 从 href、as 与字符串选项构造安全的 preload Link 响应头条目。 */
function getPreloadAsHeader(
  href: string,
  as: string,
  params: ?PreloadImplOptions,
): string {
  const escapedHref = escapeHrefForLinkHeaderURLContext(href);
  const escapedAs = escapeStringForLinkHeaderQuotedParamValueContext(as, 'as');
  let value = `<${escapedHref}>; rel=preload; as="${escapedAs}"`;
  for (const paramName in params) {
    if (hasOwnProperty.call(params, paramName)) {
      // $FlowFixMe[invalid-computed-prop]
      const paramValue = params[paramName];
      if (typeof paramValue === 'string') {
        value += `; ${paramName.toLowerCase()}="${escapeStringForLinkHeaderQuotedParamValueContext(
          paramValue,
          paramName,
        )}"`;
      }
    }
  }
  return value;
}

/** 从 stylesheet 资源挑选允许的选项并构造 preload 响应头。 */
function getStylesheetPreloadAsHeader(stylesheet: StylesheetResource): string {
  const props = stylesheet.props;
  const preloadOptions: PreloadImplOptions = {
    crossOrigin: props.crossOrigin,
    integrity: props.integrity,
    nonce: props.nonce,
    type: props.type,
    fetchPriority: props.fetchPriority,
    referrerPolicy: props.referrerPolicy,
    media: props.media,
  };
  return getPreloadAsHeader(props.href, 'style', preloadOptions);
}

// 此转义仅适用于 Link 响应头 `<` 与 `>` 之间的 href；重点处理边界字符与换行，
// 不得复用于其他上下文。
/** 匹配 Link URL 上下文中的边界字符与换行。 */
const regexForHrefInLinkHeaderURLContext = /[<>\r\n]/g;
/** 把 href 转义为可安全放入 Link 响应头尖括号 URL 上下文的文本。 */
function escapeHrefForLinkHeaderURLContext(hrefInput: string): string {
  if (__DEV__) {
    checkAttributeStringCoercion(hrefInput, 'href');
  }
  const coercedHref = '' + hrefInput;
  return coercedHref.replace(
    regexForHrefInLinkHeaderURLContext,
    escapeHrefForLinkHeaderURLContextReplacer,
  );
}
/** 把 Link URL 上下文中的危险字符替换为百分号编码。 */
function escapeHrefForLinkHeaderURLContextReplacer(match: string): string {
  switch (match) {
    case '<':
      return '%3C';
    case '>':
      return '%3E';
    case '\n':
      return '%0A';
    case '\r':
      return '%0D';
    default: {
      // eslint-disable-next-line react-internal/prod-error-codes
      throw new Error(
        'escapeLinkHrefForHeaderContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React',
      );
    }
  }
}

// 此转义仅适用于 HTTP 头参数位置的双引号值，不得用于未加引号的值或其他上下文。
/** 匹配 Link 响应头引号参数中会破坏语法的字符。 */
const regexForLinkHeaderQuotedParamValueContext = /["';,\r\n]/g;
/** 把值转义为可安全放入 Link 响应头双引号参数的文本。 */
function escapeStringForLinkHeaderQuotedParamValueContext(
  value: string,
  name: string,
): string {
  if (__DEV__) {
    checkOptionStringCoercion(value, name);
  }
  const coerced = '' + value;
  return coerced.replace(
    regexForLinkHeaderQuotedParamValueContext,
    escapeStringForLinkHeaderQuotedParamValueContextReplacer,
  );
}
/** 把 Link 引号参数上下文中的危险字符替换为百分号编码。 */
function escapeStringForLinkHeaderQuotedParamValueContextReplacer(
  match: string,
): string {
  switch (match) {
    case '"':
      return '%22';
    case "'":
      return '%27';
    case ';':
      return '%3B';
    case ',':
      return '%2C';
    case '\n':
      return '%0A';
    case '\r':
      return '%0D';
    default: {
      // eslint-disable-next-line react-internal/prod-error-codes
      throw new Error(
        'escapeStringForLinkHeaderQuotedParamValueContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React',
      );
    }
  }
}

/** Set.forEach 回调：把子边界 style 队列合并进父 hoistable 状态。 */
function hoistStyleQueueDependency(
  this: HoistableState,
  styleQueue: StyleQueue,
) {
  this.styles.add(styleQueue);
}

/** Set.forEach 回调：把子边界 stylesheet 依赖合并进父状态。 */
function hoistStylesheetDependency(
  this: HoistableState,
  stylesheet: StylesheetResource,
) {
  this.stylesheets.add(stylesheet);
}

/** 合并父子边界的样式依赖，并向上传播阻塞揭示的图片信号。 */
export function hoistHoistables(
  parentState: HoistableState,
  childState: HoistableState,
): void {
  childState.styles.forEach(hoistStyleQueueDependency, parentState);
  childState.stylesheets.forEach(hoistStylesheetDependency, parentState);
  if (childState.suspenseyImages) {
    // 子边界内联后，其阻塞图片也会阻塞父边界。SuspenseList 某行含阻塞图片时，
    // 后续行本就不能更早展示，因此信号也应向上传播；即使实际常被 outline，该语义仍正确。
    parentState.suspenseyImages = true;
  }
}

/** 判断边界是否含需 outline/等待的 stylesheet 或 View Transition 阻塞图片。 */
export function hasSuspenseyContent(
  hoistableState: HoistableState,
  flushingInShell: boolean,
): boolean {
  if (flushingInShell) {
    // shell 刷新时，带 precedence 的 stylesheet 已在阻塞绘制的 head 中输出，
    // 仅为 CSS outline 没有收益；但 View Transition 揭示依赖的阻塞图片仍必须触发 outline。
    return hoistableState.suspenseyImages;
  }
  return hoistableState.stylesheets.size > 0 || hoistableState.suspenseyImages;
}

// 渲染与预渲染会在不同阶段调用本函数，但响应头只实际发出一次，后续调用忽略。
// shellComplete 决定响应头后是否马上有包含 stylesheet 的刷新：预渲染在 shell 内 postpone 时为 false；
// 常规渲染若 shell 中有任意挂起、并在 shell 完成前调用，也会是 false。
/**
 * 汇总连接、字体、高图片的Link片段，并在shellComplete=false时按precedence尝试补stylesheet preload。每条先扣UTF-16预算，超出即停止且不回补；成功stylesheet的凭据另写resets，避免postpone重置后重复提示。先把renderState.headers置null再调用onHeaders，故回调抛错也不重入；没有片段仍调用空对象作为该次header收集结束。
 */
export function emitEarlyPreloads(
  renderState: RenderState,
  resumableState: ResumableState,
  shellComplete: boolean,
): void {
  const onHeaders = renderState.onHeaders;
  if (onHeaders) {
    const headers = renderState.headers;
    if (headers) {
      // 即使 onHeaders 抛错也不能重入；调用前先丢弃 headers 状态，保证至多一次。
      renderState.headers = null;

      let linkHeader = headers.preconnects;
      if (headers.fontPreloads) {
        if (linkHeader) {
          linkHeader += ', ';
        }
        linkHeader += headers.fontPreloads;
      }
      if (headers.highImagePreloads) {
        if (linkHeader) {
          linkHeader += ', ';
        }
        linkHeader += headers.highImagePreloads;
      }

      if (!shellComplete) {
        // 使用原始迭代器以便容量耗尽时立即停止。双写数组可提高遍历效率，
        // 但会增加内存与写入成本；该路径每请求只运行一次，当前实现足够。
        const queueIter = renderState.styles.values();
        outer: for (
          let queueStep = queueIter.next();
          headers.remainingCapacity > 0 && !queueStep.done;
          queueStep = queueIter.next()
        ) {
          const sheets = queueStep.value.sheets;
          const sheetIter = sheets.values();
          for (
            let sheetStep = sheetIter.next();
            headers.remainingCapacity > 0 && !sheetStep.done;
            sheetStep = sheetIter.next()
          ) {
            const sheet = sheetStep.value;
            const props = sheet.props;
            const key = getResourceKey(props.href);

            const header = getStylesheetPreloadAsHeader(sheet);
            // 直接扣减容量，避免继续检查后续头；一个超长头可能让队列提前结束，
            // 即使较短的后续头原本能放下。将来可让预渲染采用更重视装填率的策略。
            if ((headers.remainingCapacity -= header.length + 2) >= 0) {
              renderState.resets.style[key] = PRELOAD_NO_CREDS;
              if (linkHeader) {
                linkHeader += ', ';
              }
              linkHeader += header;

              // resumableState 已记录资源存在，但预渲染在 shell postpone 后会重置该状态；
              // resets 必须保留 stylesheet 已预加载及其凭据的事实。
              renderState.resets.style[key] =
                typeof props.crossOrigin === 'string' ||
                typeof props.integrity === 'string'
                  ? [props.crossOrigin, props.integrity]
                  : PRELOAD_NO_CREDS;
            } else {
              break outer;
            }
          }
        }
      }
      if (linkHeader) {
        onHeaders({
          Link: linkHeader,
        });
      } else {
        // 即使没有头也调用空对象；用户可能把该回调视为“React 不再提供响应头”的完成信号。
        onHeaders({});
      }
      return;
    }
  }
}

/** 服务端暴露给 useFormStatus/Transition 的状态类型别名。 */
export type TransitionStatus = FormStatus;
/** 没有待定表单提交或过渡时的共享默认状态。 */
export const NotPendingTransition: TransitionStatus = NotPending;
