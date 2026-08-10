// 这是从 Chokidar 3.6.0 内联的兼容声明：发布产物已打包 chokidar，为避免要求用户
// 额外安装其类型依赖，Vite 在公共 ServerOptions 中引用这份快照。它不是 Vite
// 文件监听器实现；阅读 watcher 原理时应转到 server/index 与 watcher 调用点。

// https://github.com/paulmillr/chokidar/blob/3.6.0/types/index.d.ts
// MIT Licensed https://github.com/paulmillr/chokidar/blob/3.6.0/LICENSE

/// <reference types="node" />

import type * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import type { Matcher } from './anymatch'

export class FSWatcher extends EventEmitter implements fs.FSWatcher {
  options: WatchOptions

  /**
   * 使用可选 WatchOptions 创建 FSWatcher。
   */
  constructor(options?: WatchOptions)

  /**
   * 要求 Node 事件循环在 watcher 活跃期间保持运行；重复调用不产生额外效果。
   */
  ref(): this

  /**
   * 让活跃 watcher 不再阻止 Node 事件循环退出。若没有其他任务，进程可能在回调触发
   * 前结束；重复调用不产生额外效果。
   */
  unref(): this

  /**
   * 增加要监听的文件、目录或 glob，可传单个字符串或数组。
   */
  add(paths: string | ReadonlyArray<string>): this

  /**
   * 停止监听指定文件、目录或 glob，可传单个字符串或数组。
   */
  unwatch(paths: string | ReadonlyArray<string>): this

  /**
   * 返回当前监听路径表。键为目录（未设置 cwd 时是绝对路径），值为该目录包含的
   * 已监听项名称数组。
   */
  getWatched(): {
    [directory: string]: string[]
  }

  /**
   * 移除所有被监听文件的 listener 并关闭 watcher。
   */
  close(): Promise<void>

  on(
    event: 'add' | 'addDir' | 'change',
    listener: (path: string, stats?: fs.Stats) => void,
  ): this

  on(
    event: 'all',
    listener: (
      eventName: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir',
      path: string,
      stats?: fs.Stats,
    ) => void,
  ): this

  /**
   * 监听过程发生错误。
   */
  on(event: 'error', listener: (error: Error) => void): this

  /**
   * 暴露 Node 原生 fs.FSWatcher 事件。
   */
  on(
    event: 'raw',
    listener: (eventName: string, path: string, details: any) => void,
  ): this

  /**
   * 初次文件扫描完成时触发。
   */
  on(event: 'ready', listener: () => void): this

  on(event: 'unlink' | 'unlinkDir', listener: (path: string) => void): this

  on(event: string, listener: (...args: any[]) => void): this
}

export interface WatchOptions {
  /**
   * 是否在文件监听期间保持进程运行。fsevents 下设为 false 后，ready 之后不再发出
   * 事件，即使进程因其他任务仍存活。
   */
  persistent?: boolean

  /**
   * 与 anymatch 兼容的忽略规则。匹配完整相对/绝对路径而非仅文件名；若函数接受
   * 两个参数，每个路径会调用两次：先只传路径，再传路径与对应 fs.Stats。
   * @see https://github.com/micromatch/anymatch
   * @see https://nodejs.org/api/fs.html#fs_class_fs_stats
   */
  ignored?: Matcher

  /**
   * 设为 false 时，初次扫描在 ready 前发现的匹配路径也会发出 add/addDir。
   */
  ignoreInitial?: boolean

  /**
   * 设为 false 时只监听符号链接本身，不跟随目标并沿链接路径冒泡事件。
   */
  followSymlinks?: boolean

  /**
   * 监听路径的基准目录；事件发出的路径会相对此目录。
   */
  cwd?: string

  /**
   * 设为 true 后，watch/add 收到的字符串即使形似 glob 也按字面路径处理。
   *
   * @default false
   */
  disableGlobbing?: boolean

  /**
   * 是否使用轮询实现 fs.watchFile，而不是 fs.watch。轮询 CPU 占用高，但网络文件
   * 系统等非标准环境通常需要开启；macOS 显式开启会覆盖 useFsEvents 默认值。
   */
  usePolling?: boolean

  /**
   * 可用时是否使用 fsevents。显式 true 且实现可用时优先于 usePolling；macOS 上
   * 显式 false 会使 usePolling 默认变为 true。
   */
  useFsEvents?: boolean

  /**
   * 是否保证 add/addDir/change 事件总是提供 fs.Stats；底层事件没有 stats 时会额外
   * 查询，适合业务必须依赖文件状态的场景。
   * @see https://nodejs.org/api/fs.html#fs_class_fs_stats
   */
  alwaysStat?: boolean

  /**
   * 限制递归遍历的子目录层数。
   */
  depth?: number

  /**
   * 普通文件系统轮询间隔。
   */
  interval?: number

  /**
   * 二进制文件的轮询间隔；二进制扩展名由 binary-extensions 清单定义。
   * @see https://github.com/sindresorhus/binary-extensions/blob/master/binary-extensions.json
   */
  binaryInterval?: number

  /**
   * 是否尽可能监听无读取权限的文件。设为 true 时，EPERM/EACCES 监听失败会静默忽略。
   */
  ignorePermissionErrors?: boolean

  /**
   * 过滤编辑器原子写入产生的伪 unlink/add：文件删除后 100ms 内重新出现会合并为
   * change。可传毫秒数覆盖窗口；useFsEvents/usePolling 均为 false 时默认开启。
   */
  atomic?: boolean | number

  /**
   * 等待文件写入完成后再发事件；可用对象调整稳定窗口与轮询间隔。
   */
  awaitWriteFinish?: AwaitWriteFinishOptions | boolean
}

export interface AwaitWriteFinishOptions {
  /**
   * 文件大小保持不变多久后才发出事件，单位毫秒。
   */
  stabilityThreshold?: number

  /**
   * 检查文件大小的轮询间隔。
   */
  pollInterval?: number
}

/**
 * 创建并返回 FSWatcher 实例。
 */
export function watch(
  paths: string | ReadonlyArray<string>,
  options?: WatchOptions,
): FSWatcher
