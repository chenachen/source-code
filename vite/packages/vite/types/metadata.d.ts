/** 构建资源附带的直接静态资源与 CSS 依赖集合。 */
export interface AssetMetadata {
  /** 当前产物引用、需要写入 manifest 的静态资源文件名集合。 */
  importedAssets: Set<string>
  /** 当前产物引用、需要注入或写入 manifest 的 CSS 文件名集合。 */
  importedCss: Set<string>
}

/** JS chunk 的资源依赖及 Vite 内部模块元数据。 */
export interface ChunkMetadata {
  /** 当前 chunk 直接或经 CSS 引用的静态资源文件名集合。 */
  importedAssets: Set<string>
  /** 当前 chunk 对应的已生成 CSS sidecar 文件名集合。 */
  importedCss: Set<string>
  /**
   * renderChunk 阶段保留的模块表，供兼容构建钩子读取。
   * @internal
   */
  __modules: any
}

/** 插件可写入 `meta.vite`、供 Vite 构建插件消费的模块级元数据。 */
export interface CustomPluginOptionsVite {
  /**
   * 若当前模块是 CSS Rolldown/Rollup 模块，可把它绑定到导入者的某个导出；当该
   * 导出被 tree-shake 时，对应 CSS 也可一并删除。
   *
   * importerId 必须静态导入此 CSS 模块，否则无法建立可靠的存活关系。
   *
   * 例如 CSS id 为 `/src/App.vue?vue&type=style&lang.css` 时：
   * ```js
   * cssScopeTo: ['/src/App.vue', 'default']
   * ```
   */
  cssScopeTo?: readonly [importerId: string, exportName: string | undefined]

  /** @deprecated 自 Vite 6.1 起已无效果。 */
  lang?: string
}

// 通过模块增强把 Vite 元数据挂到 Rolldown 产物与插件自定义选项上。
declare module 'rolldown' {
  /** Vite 对 Rolldown 输出资源增加的依赖元数据。 */
  export interface OutputAsset {
    /** Vite 构建流水线登记的静态资源与 CSS 依赖。 */
    viteMetadata?: AssetMetadata
  }

  /** Vite 对 renderChunk 阶段 chunk 增加的依赖和模块元数据。 */
  export interface RenderedChunk {
    /** Vite 构建流水线登记的 chunk 依赖及内部模块表。 */
    viteMetadata?: ChunkMetadata
  }
  /** Vite 对最终输出 chunk 增加的依赖和模块元数据。 */
  export interface OutputChunk {
    /** Vite 构建流水线登记的 chunk 依赖及内部模块表。 */
    viteMetadata?: ChunkMetadata
  }

  /** Rolldown 模块元数据中的 Vite 扩展命名空间。 */
  export interface CustomPluginOptions {
    /** 由插件提供、供 Vite 构建阶段读取的可选模块元数据。 */
    vite?: CustomPluginOptionsVite
  }
}
