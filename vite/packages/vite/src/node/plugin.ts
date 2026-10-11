import type {
  CustomPluginOptions,
  ImportKind,
  LoadResult,
  MinimalPluginContext,
  ModuleType,
  ModuleTypeFilter,
  ObjectHook,
  PluginContext,
  PluginContextMeta,
  ResolveIdResult,
  Plugin as RolldownPlugin,
  TransformPluginContext,
  TransformResult,
} from 'rolldown'
import type {
  ConfigEnv,
  EnvironmentOptions,
  ResolvedConfig,
  UserConfig,
} from './config'
import type { ServerHook } from './server'
import type { BuildAppHook } from './build'
import type { IndexHtmlTransform } from './plugins/html'
import type { EnvironmentModuleNode } from './server/moduleGraph'
import type { ModuleNode } from './server/mixedModuleGraph'
import type { HmrContext, HotUpdateOptions } from './server/hmr'
import type { DevEnvironment } from './server/environment'
import type { Environment } from './environment'
import type { PartialEnvironment } from './baseEnvironment'
import type { PreviewServerHook } from './preview'
import { arraify, asyncFlatten } from './utils'
import type { StringFilter } from './plugins/pluginFilter'

/**
 * Vite 插件在 Rolldown/Rollup 插件接口上增加配置、开发服务器、Environment 和 HMR
 * 能力。有效的 Vite 插件也是有效的打包器插件；反向则不一定成立，因为未打包的开发
 * 服务器没有 output 阶段。只要插件不强耦合 bundle 与 output 钩子，通常可直接复用。
 *
 * 默认插件同时用于 serve 和 build。非打包开发容器执行模块与初始化钩子，关闭时也执行
 * closeBundle，但没有 generateBundle/writeBundle 等产物阶段。bundled dev 则使用 Rolldown。
 *
 * 插件可在工厂参数或 `apply`/`config` 的 {@link ConfigEnv.command} 中区分 serve/build。
 * 全局钩子（config、configResolved、configureServer 等）没有当前 Environment；模块级
 * 钩子可从 `this.environment` 访问 dev、build 或 scan 环境，并用
 * `this.environment.mode === 'dev'` 守卫开发专属 API。
 *
 * @see https://vite.dev/guide/api-plugin.html
 */

/** Vite 注入 Rolldown 插件上下文的当前 Environment。 */
export interface PluginContextExtension {
  /** 当前钩子所属的 dev、build 或 scan Environment。 */
  environment: Environment
}

/** Vite 注入 Rolldown `this.meta` 的元信息。 */
export interface PluginContextMetaExtension {
  /** 当前 Vite 包版本。 */
  viteVersion: string
}

/** config/configEnvironment 钩子的最小上下文；尚无 watchMode 与 Environment。 */
export interface ConfigPluginContext extends Omit<
  MinimalPluginContext,
  'meta' | 'environment'
> {
  /** 配置阶段不含 watchMode 的插件元信息。 */
  meta: Omit<PluginContextMeta, 'watchMode'>
}

/** 全局插件钩子使用的最小上下文，不暴露尚无明确归属的 Environment。 */
export interface MinimalPluginContextWithoutEnvironment extends Omit<
  MinimalPluginContext,
  'environment'
> {}

/** 扩充 Rolldown 上下文类型，声明 Vite 在运行时注入的 environment 与 viteVersion 字段。 */
declare module 'rolldown' {
  /** Vite 扩充后的最小插件上下文。 */
  export interface MinimalPluginContext extends PluginContextExtension {}
  /** Vite 扩充后的插件元信息。 */
  export interface PluginContextMeta extends PluginContextMetaExtension {}
}

/**
 * Vite 插件定义。
 *
 * 插件分为应用级插件与 Environment 插件。应用级插件参与 config、server 等全局生命
 * 周期；`applyToEnvironment` 可以为每个已解析 Environment 保留当前插件，或返回一组
 * 新插件实例。配置解析在 configResolved 后用 PartialEnvironment 派生这些实例，此时可
 * 读取环境配置，开发服务器/Builder 的运行时实例尚未建立。派生插件用于模块生命周期，
 * 不应再声明已经执行过或由顶层列表调度的 config、configResolved、configureServer 等钩子。
 */
export interface Plugin<A = any> extends RolldownPlugin<A> {
  /**
   * 为当前 Dev Environment 自定义热更新传播。
   *
   * 返回筛选后的模块可缩小更新范围（例如 Vue SFC 只更新变化区块）；返回空数组表示插件
   * 自行通过 `environment.hot.send()` 发送更新；不返回值则沿用默认模块集合。
   */
  hotUpdate?: ObjectHook<
    (
      this: MinimalPluginContext & {
        /** 当前 hotUpdate 钩子所属的开发 Environment。 */
        environment: DevEnvironment
      },
      options: HotUpdateOptions,
    ) =>
      | Array<EnvironmentModuleNode>
      | void
      | Promise<Array<EnvironmentModuleNode> | void>
  >

  /**
   * 解析模块 ID。相较 Rolldown，Vite 额外传入旧 `ssr`、依赖扫描 `scan` 与 hook filter。
   */
  resolveId?: ObjectHook<
    (
      this: PluginContext,
      source: string,
      importer: string | undefined,
      options: {
        /** 解析请求来自静态导入、动态导入或其他 Rolldown 入口的类别。 */
        kind?: ImportKind
        /** 插件间透传的自定义解析元数据。 */
        custom?: CustomPluginOptions
        /** 旧 API 中标记服务端消费方的兼容字段。 */
        ssr?: boolean | undefined
        /** 是否由依赖扫描器发起。 @internal */
        scan?: boolean | undefined
        /** 当前 source 是否是入口。 */
        isEntry: boolean
      },
    ) => Promise<ResolveIdResult> | ResolveIdResult,
    {
      /** 调用 handler 前按原始 ID 执行的声明式过滤器。 */
      filter?: {
        /** 允许或排除的模块 ID 模式。 */
        id?: StringFilter<RegExp>
      }
    }
  >
  /** 加载已解析模块；filter 可让 PluginContainer 在调用 handler 前按 ID 跳过。 */
  load?: ObjectHook<
    (
      this: PluginContext,
      id: string,
      options?: {
        /** 旧 API 中标记服务端消费方的兼容字段。 */
        ssr?: boolean | undefined
      },
    ) => Promise<LoadResult> | LoadResult,
    {
      /** 调用 load handler 前按规范 ID 过滤。 */
      filter?: {
        /** 允许或排除的规范模块 ID。 */
        id?: StringFilter
      }
    }
  >
  /**
   * 转换模块源码。filter 可同时按 ID、源码内容和 moduleType 过滤；所有条件都满足才调用
   * handler，从而避免插件内部重复做廉价前置判断（#19602）。
   */
  transform?: ObjectHook<
    (
      this: TransformPluginContext,
      code: string,
      id: string,
      options?: {
        /** 前一插件确定的当前模块类型。 */
        moduleType: ModuleType
        /** 旧 API 中标记服务端消费方的兼容字段。 */
        ssr?: boolean | undefined
      },
    ) => Promise<TransformResult> | TransformResult,
    {
      /** transform handler 的声明式前置筛选。 */
      filter?: {
        /** 按规范模块 ID 筛选。 */
        id?: StringFilter
        /** 按当前源码内容筛选。 */
        code?: StringFilter
        /** 按前一阶段确定的模块类型筛选。 */
        moduleType?: ModuleTypeFilter
      }
    }
  >
  /**
   * 在 `vite build --app` 时允许多个 Environment 共享同一插件实例。
   *
   * 为兼容旧行为，默认仍为每个环境重建插件；也可用 `builder.sharedPlugins` 全局开启。
   * @experimental
   */
  sharedDuringBuild?: boolean
  /**
   * 当前插件在非打包开发阶段也参与非 client Environment 的 buildStart/buildEnd。
   * 默认只参与 client；其他环境启动或关闭自身容器时才触发，不会在此处主动启动它们。
   * @experimental
   */
  perEnvironmentStartEndDuringDev?: boolean
  /**
   * 当前插件在开发阶段也接收非 client Environment 的 watchChange。
   * 默认只参与 client；服务器把文件事件分发到各容器，由容器检查此标志。
   * @experimental
   */
  perEnvironmentWatchChangeDuringDev?: boolean
  /**
   * 设置插件在整体流水线中的层级；单个钩子的对象形式 `order` 仍会在该 hook 内二次排序。
   *
   * 整体顺序：alias → 用户 pre → Vite core → 用户 normal → build → 用户 post →
   * build post。最终几个服务器分析插件固定在所有插件之后。
   */
  enforce?: 'pre' | 'post'
  /** 只在 serve/build 或自定义配置条件满足时启用整个插件。 */
  apply?:
    | 'serve'
    | 'build'
    | ((this: void, config: UserConfig, env: ConfigEnv) => boolean)
  /**
   * 决定插件在某个 Environment 中是否启用。
   *
   * 返回 `true` 保留当前顶层插件，falsy 排除它，返回 PluginOption 则用环境专属插件替换。
   * 未声明时默认在全部环境启用（#18544）。
   * @experimental
   */
  applyToEnvironment?: (
    environment: PartialEnvironment,
  ) => boolean | Promise<boolean> | PluginOption
  /**
   * 在配置解析前修改顶层 Vite 配置。可原地修改，也可返回深度合并的局部对象。
   *
   * 用户插件列表在该钩子前已经确定，所以此处新增 `plugins` 不会生效；类型也主动排除
   * 返回值中的 plugins。
   */
  config?: ObjectHook<
    (
      this: ConfigPluginContext,
      config: UserConfig,
      env: ConfigEnv,
    ) =>
      | Omit<UserConfig, 'plugins'>
      | null
      | void
      | Promise<Omit<UserConfig, 'plugins'> | null | void>
  >
  /**
   * 在单个 Environment 最终解析前修改其配置。可原地修改，也可返回局部对象深度合并。
   *
   * 该钩子对每个环境调用，收到的配置已继承顶层默认环境值。环境专属变化应放在这里，
   * `config` 钩子只修改所有环境共享的顶层默认值。
   */
  configEnvironment?: ObjectHook<
    (
      this: ConfigPluginContext,
      name: string,
      config: EnvironmentOptions,
      env: ConfigEnv & {
        /** 当前是否为 SSR 环境且旧 `ssr.target` 为 `webworker`；仅供兼容。 */
        isSsrTargetWebworker?: boolean
      },
    ) =>
      | EnvironmentOptions
      | null
      | void
      | Promise<EnvironmentOptions | null | void>
  >
  /** 读取并保存最终 ResolvedConfig；此全局钩子没有当前 Environment。 */
  configResolved?: ObjectHook<
    (
      this: MinimalPluginContextWithoutEnvironment,
      config: ResolvedConfig,
    ) => void | Promise<void>
  >
  /**
   * 配置开发服务器。钩子收到 {@link ViteDevServer}，可保存引用供其他钩子使用。
   *
   * 各插件在内部中间件注册前串行执行；返回的 post hook 会在内部中间件注册后执行。
   */
  configureServer?: ObjectHook<ServerHook>
  /**
   * 配置产物预览服务器。钩子收到 {@link PreviewServer}，可保存引用供其他钩子使用。
   *
   * CORS/Host 校验先挂载，插件钩子随后串行执行；返回的 post hook 在代理、静态服务和
   * HTML fallback 之后执行，早于最终 HTML/404 中间件。
   */
  configurePreviewServer?: ObjectHook<PreviewServerHook>
  /**
   * 转换入口 HTML。钩子接收：
   *
   * - html：当前 HTML 字符串。
   * - ctx：公开路径、磁盘文件名，以及 serve 时的 server 或 build 时的 bundle/chunk。
   *
   * 可返回转换后的字符串，也可返回注入 `<head>`/`<body>` 的标签描述。
   *
   * 默认在 Vite 内部 HTML 转换后执行；需提前执行时使用
   * `{ order: 'pre', handler: hook }`。
   */
  transformIndexHtml?: IndexHtmlTransform
  /** 构建应用中的多个 Environment。 @experimental */
  buildApp?: ObjectHook<BuildAppHook>
  /**
   * 旧应用级 HMR 自定义钩子。
   *
   * 返回模块列表可缩小更新范围；返回空数组表示插件自行用 `server.ws.send()` 发消息；
   * 不返回值则沿用默认集合。新插件优先使用每个 Environment 的 `hotUpdate`。
   */
  handleHotUpdate?: ObjectHook<
    (
      this: MinimalPluginContextWithoutEnvironment,
      ctx: HmrContext,
    ) => Array<ModuleNode> | void | Promise<Array<ModuleNode> | void>
  >

  /**
   * Rolldown 尚未支持该钩子；这里只为插件类型兼容保留，运行时是 no-op。
   *
   * @deprecated 钩子本身并未弃用；标记只用于提示当前不会执行。
   */
  shouldTransformCachedModule?: ObjectHook<
    (
      this: PluginContext,
      options: {
        /** 已缓存的转换代码。 */
        code: string
        /** 已缓存模块的规范 ID。 */
        id: string
        /** 各插件阶段合并后的模块元数据。 */
        meta: CustomPluginOptions
        /** 当前缓存结果的 tree-shaking 副作用语义。 */
        moduleSideEffects: boolean | 'no-treeshake'
      },
    ) => boolean | null | void
  >
}

/** 从函数形式或 ObjectHook 中提取实际 handler 类型。 */
export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T

/** 已由类型系统保证指定 hook 存在的插件。 */
export type PluginWithRequiredHook<K extends keyof Plugin> = Plugin & {
  [P in K]: NonNullable<Plugin[P]>
}

/** 同步值或异步值。 */
type Thenable<T> = T | Promise<T>

/** 插件数组中会在展平后被过滤掉的条件值。 */
export type FalsyPlugin = false | null | undefined

/**
 * 用户配置接受的递归插件输入：插件、Promise、嵌套数组或条件 falsy 值。
 * 仅含 name 的对象用于兼容 Rolldown/Rollup 插件声明。
 */
export type PluginOption = Thenable<
  | Plugin
  | {
      /** 仅声明名称的 Rolldown/Rollup 兼容插件。 */
      name: string
    }
  | FalsyPlugin
  | PluginOption[]
>

/**
 * 从顶层插件列表派生某个 Environment 的最终插件。
 *
 * `applyToEnvironment` 返回 true 时复用原插件，falsy 时排除，返回 PluginOption 时异步
 * 展平替换插件。未声明该钩子的顶层插件默认保留（#18544）。
 */
export async function resolveEnvironmentPlugins(
  environment: PartialEnvironment,
): Promise<Plugin[]> {
  const environmentPlugins: Plugin[] = []
  for (const plugin of environment.getTopLevelConfig().plugins) {
    if (plugin.applyToEnvironment) {
      const applied = await plugin.applyToEnvironment(environment)
      if (!applied) {
        continue
      }
      if (applied !== true) {
        environmentPlugins.push(
          ...((await asyncFlatten(arraify(applied))).filter(
            Boolean,
          ) as Plugin[]),
        )
        continue
      }
    }
    environmentPlugins.push(plugin)
  }
  return environmentPlugins
}

/**
 * 创建只通过 `applyToEnvironment` 为各环境提供插件的轻量应用级占位插件。
 * 适合让工厂在 Environment 已解析后再读取环境配置并创建独立缓存。
 *
 * @experimental
 */
export function perEnvironmentPlugin(
  name: string,
  applyToEnvironment: (
    environment: PartialEnvironment,
  ) => boolean | Promise<boolean> | PluginOption,
): Plugin {
  return {
    name,
    applyToEnvironment,
  }
}
