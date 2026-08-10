import colors from 'picocolors'
import { createDebugger, getHash } from '../utils'
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from '../../shared/utils'
import type { DevEnvironment } from '../server/environment'
import { devToScanEnvironment } from './scan'
import {
  addManuallyIncludedOptimizeDeps,
  addOptimizedDepInfo,
  createIsOptimizedDepFile,
  createIsOptimizedDepUrl,
  depsFromOptimizedDepInfo,
  depsLogString,
  discoverProjectDependencies,
  extractExportsData,
  getOptimizedDepPath,
  initDepsOptimizerMetadata,
  loadCachedDepOptimizationMetadata,
  optimizeExplicitEnvironmentDeps,
  runOptimizeDeps,
  toDiscoveredDependencies,
} from './index'
import type {
  DepOptimizationMetadata,
  DepOptimizationResult,
  DepsOptimizer,
  OptimizedDepInfo,
} from './index'

/** `DEBUG=vite:deps` 启用优化调度状态日志。 */
const debug = createDebugger('vite:deps')

/** 运行期发现首个缺失依赖后等待同批请求继续登记的去抖窗口。 */
const debounceMs = 100

/**
 * 创建开发态自动依赖优化器：并行运行 scanner 与真实模块 crawl，按批处理新依赖，比较输出稳定性，
 * 决定保留 browserHash、丢弃中间结果或提交并 full reload。
 */
export function createDepsOptimizer(
  environment: DevEnvironment,
): DepsOptimizer {
  const { logger } = environment
  const sessionTimestamp = Date.now().toString()

  let debounceProcessingHandle: NodeJS.Timeout | undefined

  let closed = false

  const options = environment.config.optimizeDeps

  const { noDiscovery, holdUntilCrawlEnd } = options

  let metadata: DepOptimizationMetadata = initDepsOptimizerMetadata(
    environment,
    sessionTimestamp,
  )

  const depsOptimizer: DepsOptimizer = {
    init,
    metadata,
    registerMissingImport,
    run: () => debouncedProcessing(0),
    isOptimizedDepFile: createIsOptimizedDepFile(environment),
    isOptimizedDepUrl: createIsOptimizedDepUrl(environment),
    getOptimizedDepId: (depInfo: OptimizedDepInfo) =>
      `${depInfo.file}?v=${depInfo.browserHash}`,
    close,
    options,
  }

  /** 当前处理批次建立后是否又发现新依赖。 */
  let newDepsDiscovered = false

  let newDepsToLog: string[] = []
  let newDepsToLogHandle: NodeJS.Timeout | undefined
  /** 合并短时间内的新依赖日志，避免每发现一个依赖就刷新终端。 */
  const logNewlyDiscoveredDeps = () => {
    if (newDepsToLog.length) {
      const dependencyLabel =
        newDepsToLog.length === 1 ? 'dependency' : 'dependencies'
      logger.info(
        colors.green(
          `${dependencyLabel} optimized: ${depsLogString(newDepsToLog)}`,
        ),
        {
          timestamp: true,
        },
      )
      newDepsToLog = []
    }
  }

  let discoveredDepsWhileScanning: string[] = []
  /** 提示用户把 scanner 期间的运行时漏项加入 include，以减少未来重跑。 */
  const logOptimizeDepsIncludeSuggestion = (reason: string) => {
    if (discoveredDepsWhileScanning.length) {
      logger.info(
        colors.magenta(
          `tip: consider adding ${depsLogString(
            discoveredDepsWhileScanning,
          )} to optimizeDeps.include to ${reason}`,
        ) +
          colors.dim(
            `\n  See https://vite.dev/guide/dep-pre-bundling.html#customizing-the-behavior`,
          ),
        {
          timestamp: true,
        },
      )
      discoveredDepsWhileScanning = []
    }
  }

  // 每批 discovered 依赖共享一个 processing Promise；只有包含它的某轮结果提交后才 resolve。
  let depOptimizationProcessing = promiseWithResolvers<void>()
  let depOptimizationProcessingQueue: PromiseWithResolvers<void>[] = []
  /** 成功发布后放行所有被丢弃批次遗留的优化文件请求。 */
  const resolveEnqueuedProcessingPromises = () => {
    // 一次成功提交会放行当前及此前因结果被丢弃而延迟的所有批次请求。
    for (const processing of depOptimizationProcessingQueue) {
      processing.resolve()
    }
    depOptimizationProcessingQueue = []
  }

  let enqueuedRerun: (() => void) | undefined
  let currentlyProcessing = false

  let firstRunCalled = false
  let warnAboutMissedDependencies = false

  // 冷启动先等首个请求的静态 import crawl，尽量一次收齐依赖；热启动/首轮后改用普通 debounce。
  let waitingForCrawlEnd = false

  let optimizationResult:
    | {
        /** 取消当前 Rolldown 预构建并清理 processing 目录。 */
        cancel: () => Promise<void>
        /** 当前预构建完成后的可提交结果。 */
        result: Promise<DepOptimizationResult>
      }
    | undefined

  let discover:
    | {
        /** 取消首轮依赖 scanner。 */
        cancel: () => Promise<void>
        /** scanner 发现的依赖 ID 到入口路径映射。 */
        result: Promise<Record<string, string>>
      }
    | undefined

  /** 关闭 scanner、后台优化和所有等待任务；不让取消异常阻塞其他收尾。 */
  async function close() {
    closed = true
    await Promise.allSettled([
      discover?.cancel(),
      depsOptimizer.scanProcessing,
      optimizationResult?.cancel(),
    ])
  }

  let initState: 'idle' | 'initializing' | 'initialized' = 'idle'
  /**
   * 幂等初始化：先尝试磁盘缓存；冷启动登记 include、开始等待 crawl，并按 noDiscovery 决定直接
   * 优化还是后台 scanner + 首轮优化。
   */
  async function init() {
    if (initState !== 'idle') return
    initState = 'initializing'

    const cachedMetadata = await loadCachedDepOptimizationMetadata(environment)

    firstRunCalled = !!cachedMetadata

    metadata = depsOptimizer.metadata =
      cachedMetadata || initDepsOptimizerMetadata(environment, sessionTimestamp)

    if (!cachedMetadata) {
      waitingForCrawlEnd = true

      // 静态 crawl 结束前保持 processing，避免过早发出可能立即过期的优化 URL。
      currentlyProcessing = true

      // include 在 scanner 前即可解析，先成为 discovered 并绑定首批 processing Promise。

      const manuallyIncludedDeps: Record<string, string> = {}
      await addManuallyIncludedOptimizeDeps(environment, manuallyIncludedDeps)

      const manuallyIncludedDepsInfo = toDiscoveredDependencies(
        environment,
        manuallyIncludedDeps,
        sessionTimestamp,
      )

      for (const depInfo of Object.values(manuallyIncludedDepsInfo)) {
        addOptimizedDepInfo(metadata, 'discovered', {
          ...depInfo,
          processing: depOptimizationProcessing.promise,
        })
        newDepsDiscovered = true
      }

      environment.waitForRequestsIdle().then(onCrawlEnd)

      if (noDiscovery) {
        // noDiscovery 只信任 include，无需 scanner/crawl 等待，立即首轮优化。
        runOptimizer()
      } else {
        // scanner 只服务开发冷启动；以后台任务运行，避免阻塞高优先级 server 初始化。
        depsOptimizer.scanProcessing = new Promise((resolve) => {
          // async IIFE 进入 microtask 后执行，不占住初始化同步主链。
          ;(async () => {
            try {
              debug?.(colors.green(`scanning for dependencies...`))

              const scanTimer = setTimeout(() => {
                logger.info('[optimizer] scanning dependencies...', {
                  timestamp: true,
                })
              }, 1000)

              let deps: Record<string, string>
              try {
                discover = discoverProjectDependencies(
                  devToScanEnvironment(environment),
                )
                deps = await discover.result
                discover = undefined
              } catch (e) {
                environment.logger.error(
                  colors.red(
                    '(!) Failed to run dependency scan. ' +
                      'Skipping dependency pre-bundling. ' +
                      e.stack,
                  ),
                )
                return
              } finally {
                clearTimeout(scanTimer)
              }

              const manuallyIncluded = Object.keys(manuallyIncludedDepsInfo)
              discoveredDepsWhileScanning.push(
                ...Object.keys(metadata.discovered).filter(
                  (dep) => !deps[dep] && !manuallyIncluded.includes(dep),
                ),
              )

              // scanner 结果立即加入 discovered：preAlias 需要它命中 alias 后复用优化 URL，旧 CJS
              // externalization heuristic 也依赖这份列表。
              for (const id of Object.keys(deps)) {
                if (!metadata.discovered[id]) {
                  addMissingDep(id, deps[id])
                }
              }

              const knownDeps = prepareKnownDeps()
              startNextDiscoveredBatch()

              // scanner 完成后立刻在后台构建首轮候选结果，与浏览器静态 crawl 继续并行。
              optimizationResult = runOptimizeDeps(environment, knownDeps)

              // holdUntilCrawlEnd=true 时保留候选结果，crawl 结束再判断是否完整。
              if (!holdUntilCrawlEnd) {
                // false 时 scanner 完成即尝试发布；若随后 crawl 补依赖并改变 common chunks，可能需要
                // full reload，换取浏览器更早并行请求的速度。
                optimizationResult.result.then((result) => {
                  // 若 crawl 已结束，onCrawlEnd 已取得该候选结果，本回调不重复消费。
                  if (!waitingForCrawlEnd) return

                  optimizationResult = undefined // 标记候选结果的所有权已转交 runOptimizer。

                  runOptimizer(result)
                })
              }
            } catch (e) {
              logger.error(e.stack || e.message)
            } finally {
              resolve()
              depsOptimizer.scanProcessing = undefined
            }
          })()
        })
      }
    }
    initState = 'initialized'
  }

  /** 封存当前 discovered 批次的 processing Promise，并为后续新发现依赖创建下一批。 */
  function startNextDiscoveredBatch() {
    newDepsDiscovered = false

    // 当前批次加入等待队列，直到某次包含它的重跑成功提交。
    depOptimizationProcessingQueue.push(depOptimizationProcessing)

    // 此后发现的依赖归入下一批 Promise。
    depOptimizationProcessing = promiseWithResolvers()
  }

  /** 合并 optimized + discovered 快照，去掉运行控制 Promise，作为下一轮完整重打包输入。 */
  function prepareKnownDeps() {
    const knownDeps: Record<string, OptimizedDepInfo> = {}
    // 克隆对象；新一轮会修改 fileHash/browserHash，不能提前污染当前已提交元数据。
    const metadata = depsOptimizer.metadata!
    for (const dep of Object.keys(metadata.optimized)) {
      knownDeps[dep] = { ...metadata.optimized[dep] }
    }
    for (const dep of Object.keys(metadata.discovered)) {
      // processing 只属于请求等待，不是打包输入。
      const { processing, ...info } = metadata.discovered[dep]
      knownDeps[dep] = info
    }
    return knownDeps
  }

  /**
   * 串行消费一轮候选结果或重打包全部已知依赖。比较 interop/hash/fileHash 决定能否无 reload 提交；
   * 失败保持旧 metadata 并清空 discovered，让请求链重新发现。
   */
  async function runOptimizer(preRunResult?: DepOptimizationResult) {
    const isRerun = firstRunCalled
    firstRunCalled = true

    // 清除当前排队句柄，保证同一时刻只执行一个 runOptimizer。
    enqueuedRerun = undefined

    // 当前批次已开始，取消尚未触发的 debounce timer。
    if (debounceProcessingHandle) clearTimeout(debounceProcessingHandle)

    if (closed) {
      currentlyProcessing = false
      depOptimizationProcessing.resolve()
      resolveEnqueuedProcessingPromises()
      return
    }

    currentlyProcessing = true

    try {
      let processingResult: DepOptimizationResult
      if (preRunResult) {
        processingResult = preRunResult
      } else {
        const knownDeps = prepareKnownDeps()
        startNextDiscoveredBatch()

        optimizationResult = runOptimizeDeps(environment, knownDeps)
        processingResult = await optimizationResult.result
        optimizationResult = undefined
      }

      if (closed) {
        currentlyProcessing = false
        processingResult.cancel()
        resolveEnqueuedProcessingPromises()
        return
      }

      const newData = processingResult.metadata

      const needsInteropMismatch = findInteropMismatches(
        metadata.discovered,
        newData.optimized,
      )

      // interop 形状、主 hash 或任一旧入口的 import chunk 图变化时，浏览器现有模块引用可能失效，
      // 必须 reload；fileHash 全稳定则可无感加入新入口。
      const needsReload =
        needsInteropMismatch.length > 0 ||
        metadata.hash !== newData.hash ||
        Object.keys(metadata.optimized).some((dep) => {
          return (
            metadata.optimized[dep].fileHash !== newData.optimized[dep].fileHash
          )
        })

      /** 发布目录、合并提交期间新增依赖、稳定 hash，并原位补全等待中的 discovered 对象。 */
      const commitProcessing = async () => {
        await processingResult.commit()

        // 打包期间新发现但未包含的依赖继续留在 discovered，交给下一轮。
        for (const id in metadata.discovered) {
          if (!newData.optimized[id]) {
            addOptimizedDepInfo(newData, 'discovered', metadata.discovered[id])
          }
        }

        // 不 reload 时必须保留浏览器已经使用的 URL 版本，不能无故制造同模块第二引用。
        if (!needsReload) {
          newData.browserHash = metadata.browserHash
          for (const dep in newData.chunks) {
            newData.chunks[dep].browserHash = metadata.browserHash
          }
          for (const dep in newData.optimized) {
            newData.optimized[dep].browserHash = (
              metadata.optimized[dep] || metadata.discovered[dep]
            ).browserHash
          }
        }

        // 原位补全旧 discovered 对象，让持有其引用并等待 processing 的请求能看到最终 hash/interop。
        for (const o in newData.optimized) {
          const discovered = metadata.discovered[o]
          if (discovered) {
            const optimized = newData.optimized[o]
            discovered.browserHash = optimized.browserHash
            discovered.fileHash = optimized.fileHash
            discovered.needsInterop = optimized.needsInterop
            discovered.processing = undefined
          }
        }

        if (isRerun) {
          newDepsToLog.push(
            ...Object.keys(newData.optimized).filter(
              (dep) => !metadata.optimized[dep],
            ),
          )
        }

        metadata = depsOptimizer.metadata = newData
        resolveEnqueuedProcessingPromises()
      }

      if (!needsReload) {
        await commitProcessing()

        if (!debug) {
          if (newDepsToLogHandle) clearTimeout(newDepsToLogHandle)
          newDepsToLogHandle = setTimeout(() => {
            newDepsToLogHandle = undefined
            logNewlyDiscoveredDeps()
            if (warnAboutMissedDependencies) {
              logOptimizeDepsIncludeSuggestion('speed up cold start')
              warnAboutMissedDependencies = false
            }
          }, 2 * debounceMs)
        } else {
          debug(
            colors.green(
              !isRerun
                ? `dependencies optimized`
                : `optimized dependencies unchanged`,
            ),
          )
        }
      } else {
        if (newDepsDiscovered) {
          // 本轮会 reload 且又出现新依赖：丢弃当前候选，直接下一轮，避免连续 reload；processing
          // Promise 继续等待真正包含该批依赖的提交。
          processingResult.cancel()

          debug?.(
            colors.green(
              `delaying reload as new dependencies have been found...`,
            ),
          )
        } else {
          await commitProcessing()

          if (!debug) {
            if (newDepsToLogHandle) clearTimeout(newDepsToLogHandle)
            newDepsToLogHandle = undefined
            logNewlyDiscoveredDeps()
            if (warnAboutMissedDependencies) {
              logOptimizeDepsIncludeSuggestion(
                'avoid a full page reload during cold start',
              )
              warnAboutMissedDependencies = false
            }
          }

          logger.info(
            colors.green(`optimized dependencies changed. reloading`),
            {
              timestamp: true,
            },
          )
          if (needsInteropMismatch.length > 0) {
            logger.warn(
              `Mixed ESM and CJS detected in ${colors.yellow(
                needsInteropMismatch.join(', '),
              )}, add ${
                needsInteropMismatch.length === 1 ? 'it' : 'them'
              } to optimizeDeps.needsInterop to speed up cold start`,
              {
                timestamp: true,
              },
            )
          }

          fullReload()
        }
      }
    } catch (e) {
      logger.error(
        colors.red(`error while updating dependencies:\n${e.stack}`),
        { timestamp: true, error: e },
      )
      resolveEnqueuedProcessingPromises()

      // 保持已提交 optimized 元数据，只清待处理项；后续真实请求会重新发现并登记。
      metadata.discovered = {}
    }

    currentlyProcessing = false
    // @ts-expect-error 等待异步任务期间 `debouncedProcessing` 可能设置 `enqueuedRerun`。
    enqueuedRerun?.()
  }

  /** 先清所有 transform 缓存中的旧优化 URL，再广播 full reload。 */
  function fullReload() {
    environment.moduleGraph.invalidateAll()

    environment.hot.send({
      type: 'full-reload',
      path: '*',
    })
  }

  /** debounce 收集结束后重打包旧 + 新依赖；若上一轮仍在执行，由 enqueuedRerun 串行接续。 */
  function rerun() {
    const deps = Object.keys(metadata.discovered)
    const depsString = depsLogString(deps)
    debug?.(colors.green(`new dependencies found: ${depsString}`))
    runOptimizer()
  }

  /** 给尚未打包的依赖生成基于“已知 + 当前 missing + session”的临时唯一 browserHash。 */
  function getDiscoveredBrowserHash(
    hash: string,
    deps: Record<string, string>,
    missing: Record<string, string>,
  ) {
    return getHash(
      hash + JSON.stringify(deps) + JSON.stringify(missing) + sessionTimestamp,
    )
  }

  /**
   * Import Analysis/resolve 运行期登记 scanner 未发现依赖。已知 optimized/chunk/discovered 直接复用；
   * 新项预计算输出 URL，并在初始化/crawl 安全后触发去抖重跑。
   */
  function registerMissingImport(
    id: string,
    resolved: string,
  ): OptimizedDepInfo {
    const optimized = metadata.optimized[id]
    if (optimized) {
      return optimized
    }
    const chunk = metadata.chunks[id]
    if (chunk) {
      return chunk
    }
    let missing = metadata.discovered[id]
    if (missing) {
      // 已登记到某个 processing 批次，下一轮会处理，无需重复触发。
      return missing
    }

    missing = addMissingDep(id, resolved)

    // 首轮前先让 Vite eager crawl 用户静态图，尽量一次收齐 missing；否则浏览器刚拿到优化 URL 就
    // 可能因 common chunk 变化过期并 reload。

    // createServer 与 listen 之间也可主动 transform，导致 init 前发现依赖；此时启动优化会与 init
    // 重置 metadata 竞态并在 commitProcessing 崩溃，因此必须等 initialized。
    if (initState === 'initialized' && !waitingForCrawlEnd) {
      // 去抖一小段时间，让同批模块请求继续登记依赖后再整体重跑。
      debouncedProcessing()
    }

    // 输出路径/hash 可在打包前确定并返回；真正读取由 processing Promise 阻塞。
    return missing
  }

  /** 创建 discovered 元数据并绑定当前 processing 批次。 */
  function addMissingDep(id: string, resolved: string) {
    newDepsDiscovered = true

    return addOptimizedDepInfo(metadata, 'discovered', {
      id,
      file: getOptimizedDepPath(environment, id),
      src: resolved,
      // 临时 hash 唯一对应当前 known+missing；若重跑未改变旧产物，该 hash 会保留且无需 reload。
      browserHash: getDiscoveredBrowserHash(
        metadata.hash,
        depsFromOptimizedDepInfo(metadata.optimized),
        depsFromOptimizedDepInfo(metadata.discovered),
      ),
      // 服务此预构建文件前必须等待它所属批次提交。
      processing: depOptimizationProcessing.promise,
      exportsData: extractExportsData(environment, resolved),
    })
  }

  /** 重置去抖 timer；到期后若当前空闲立即 rerun，否则挂到当前 runOptimizer 尾部。 */
  function debouncedProcessing(timeout = debounceMs) {
    enqueuedRerun = undefined
    if (debounceProcessingHandle) clearTimeout(debounceProcessingHandle)
    if (newDepsToLogHandle) clearTimeout(newDepsToLogHandle)
    newDepsToLogHandle = undefined
    debounceProcessingHandle = setTimeout(() => {
      debounceProcessingHandle = undefined
      enqueuedRerun = rerun
      if (!currentlyProcessing) {
        enqueuedRerun()
      }
    }, timeout)
  }

  /**
   * 首个请求触发的静态 imports 全部 crawl 后调用一次；若浏览器很快请求，部分动态 import 也可能
   * 已登记。比较 scanner 候选与真实 crawl，决定采用、丢弃重跑或普通补跑。
   */
  async function onCrawlEnd() {
    // 此后不再持有首轮，所有新依赖使用普通 debounce。
    waitingForCrawlEnd = false

    debug?.(colors.green(`static imports crawl ended`))
    if (closed) {
      return
    }

    // 等后台 scan+optimize；多数情况下真实 crawl 结束时它已经完成。
    await depsOptimizer.scanProcessing

    if (optimizationResult && !options.noDiscovery) {
      // hold 策略在此首次消费 scanner 候选；非 hold 若 scanner 比 crawl 更晚完成也走同一比较。
      const afterScanResult = optimizationResult.result
      optimizationResult = undefined // 标记候选结果由本函数接管。

      const result = await afterScanResult
      currentlyProcessing = false

      const crawlDeps = Object.keys(metadata.discovered)
      const scanDeps = Object.keys(result.metadata.optimized)

      if (scanDeps.length === 0 && crawlDeps.length === 0) {
        debug?.(
          colors.green(
            `no dependencies found by the scanner or crawling static imports`,
          ),
        )
        // 零依赖结果仍提交元数据，下次 lockfile/config 未变即可跳过 scanner。
        startNextDiscoveredBatch()
        runOptimizer(result)
        return
      }

      const needsInteropMismatch = findInteropMismatches(
        metadata.discovered,
        result.metadata.optimized,
      )
      const scannerMissedDeps = crawlDeps.some((dep) => !scanDeps.includes(dep))
      const outdatedResult =
        needsInteropMismatch.length > 0 || scannerMissedDeps

      if (outdatedResult) {
        // scanner 漏依赖/interop 预测不一致：丢弃候选并合并两边全集后重跑，避免首屏 reload。
        result.cancel()

        // 将 scanner 独有依赖补入 crawl discovered，下一轮输入取两者并集。
        for (const dep of scanDeps) {
          if (!crawlDeps.includes(dep)) {
            addMissingDep(dep, result.metadata.optimized[dep].src!)
          }
        }
        if (scannerMissedDeps) {
          debug?.(
            colors.yellow(
              `new dependencies were found while crawling that weren't detected by the scanner`,
            ),
          )
        }
        debug?.(colors.green(`re-running optimizer`))
        debouncedProcessing(0)
      } else {
        debug?.(
          colors.green(
            `using post-scan optimizer result, the scanner found every used dependency`,
          ),
        )
        startNextDiscoveredBatch()
        runOptimizer(result)
      }
    } else if (!holdUntilCrawlEnd) {
      // 非 hold 已提前发布 scanner 结果；crawl 又发现依赖时普通重跑，若旧 fileHash 稳定仍可免 reload。
      if (newDepsDiscovered) {
        debug?.(
          colors.green(
            `new dependencies were found while crawling static imports, re-running optimizer`,
          ),
        )
        warnAboutMissedDependencies = true
        debouncedProcessing(0)
      }
    } else {
      const crawlDeps = Object.keys(metadata.discovered)
      currentlyProcessing = false

      if (crawlDeps.length === 0) {
        debug?.(
          colors.green(
            `no dependencies found while crawling the static imports`,
          ),
        )
        firstRunCalled = true
      }

      // 即使没有依赖也排首轮，写入空元数据供下次冷启动复用。
      debouncedProcessing(0)
    }
  }

  return depsOptimizer
}

/**
 * 为 noDiscovery/显式 server Environment 创建阻塞式优化器：无 scanner/运行期 missing 注册，init
 * 直接完成 include 优化后服务器才继续。
 */
export function createExplicitDepsOptimizer(
  environment: DevEnvironment,
): DepsOptimizer {
  const depsOptimizer = {
    metadata: initDepsOptimizerMetadata(environment),
    isOptimizedDepFile: createIsOptimizedDepFile(environment),
    isOptimizedDepUrl: createIsOptimizedDepUrl(environment),
    getOptimizedDepId: (depInfo: OptimizedDepInfo) =>
      `${depInfo.file}?v=${depInfo.browserHash}`,

    registerMissingImport: () => {
      throw new Error(
        `Vite Internal Error: registerMissingImport is not supported in dev ${environment.name}`,
      )
    },
    init,
    // dev SSR 无 scanner，优化器在启动前已阻塞完成，run 无需操作。
    run: () => {},

    close: async () => {},
    options: environment.config.optimizeDeps,
  }

  let inited = false
  /** 幂等执行显式 include 优化，并用最终元数据替换初始空快照。 */
  async function init() {
    if (inited) return
    inited = true

    depsOptimizer.metadata = await optimizeExplicitEnvironmentDeps(environment)
  }

  return depsOptimizer
}

/** 比较发现阶段预测与打包后最终 needsInterop；混合 ESM/CJS 不一致会改变 import 改写。 */
function findInteropMismatches(
  discovered: Record<string, OptimizedDepInfo>,
  optimized: Record<string, OptimizedDepInfo>,
) {
  const needsInteropMismatch = []
  for (const dep in discovered) {
    const discoveredDepInfo = discovered[dep]
    if (discoveredDepInfo.needsInterop === undefined) continue

    const depInfo = optimized[dep]
    if (!depInfo) continue

    if (depInfo.needsInterop !== discoveredDepInfo.needsInterop) {
      // 通常只发生在混合 ESM/CJS 且未显式列入 optimizeDeps.needsInterop 的依赖。
      needsInteropMismatch.push(dep)
      debug?.(colors.cyan(`needsInterop mismatch detected for ${dep}`))
    }
  }
  return needsInteropMismatch
}
