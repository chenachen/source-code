/**
 * ModuleRunner 循环导入基准
 *
 * 创建不同规模的合成模块图，测量从入口可达的全部模块求值耗时。
 *
 * 运行：
 *   node packages/vite/scripts/benchCircularImport.ts
 *
 * 开启 CPU profiling：
 *   node --cpu-prof --cpu-prof-dir=./profiles packages/vite/scripts/benchCircularImport.ts
 */

import { createServer, createServerModuleRunner } from 'vite'

// ---------------------------------------------------------------------------
// 合成图生成
// ---------------------------------------------------------------------------

/** 控制合成图规模、随机边尝试次数与额外回边尝试次数的基准参数。 */
interface GraphConfig {
  /** 创建的虚拟模块数量。 */
  moduleCount: number
  /** 随机边目标密度；实际边数受去重和自环跳过影响。 */
  avgImports: number
  /** 额外回边尝试次数占模块数的比例，不等于实际环中模块比例。 */
  cycleFraction: number
}

/** 供虚拟模块插件生成导入语句的合成图。 */
interface SyntheticGraph {
  /** 模块 ID 到直接依赖 ID 列表的邻接表。 */
  edges: Map<string, string[]>
  /** 从图首模块开始的入口 ID。 */
  entry: string
}

/** 生成 benchmark 专用虚拟路径，索引与图中模块一一对应。 */
function moduleId(i: number): string {
  return `/bench/mod_${i}.js`
}

/** 先建可达全部模块的链，再按固定种子尝试交叉边和回边；重复边及自环跳过，实际密度不保证达到目标。 */
function generateGraph(config: GraphConfig): SyntheticGraph {
  const { moduleCount, avgImports, cycleFraction } = config
  const edges = new Map<string, string[]>()

  // 初始化所有模块的空依赖列表。
  for (let i = 0; i < moduleCount; i++) {
    edges.set(moduleId(i), [])
  }

  // 1. 各模块导入下一个模块，保证入口能到达全部模块。
  for (let i = 0; i < moduleCount - 1; i++) {
    edges.get(moduleId(i))!.push(moduleId(i + 1))
  }

  // 2. 按目标密度计算随机边尝试次数，也可能产生回边。
  const targetTotalEdges = moduleCount * avgImports
  const currentEdges = moduleCount - 1
  const extraEdges = Math.max(0, targetTotalEdges - currentEdges)

  // 固定随机种子，使同规模图可复现。
  let seed = 42
  /** 推进固定种子线性同余状态，返回归一化随机数以复现同一规模的图。 */
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff
    return seed / 0x7fffffff
  }

  for (let e = 0; e < extraEdges; e++) {
    const from = Math.floor(rand() * moduleCount)
    const to = Math.floor(rand() * moduleCount)
    if (from !== to) {
      const deps = edges.get(moduleId(from))!
      const target = moduleId(to)
      if (!deps.includes(target)) {
        deps.push(target)
      }
    }
  }

  // 3. 尝试添加后半模块到前半模块的回边。
  const cycleModules = Math.floor(moduleCount * cycleFraction)
  for (let c = 0; c < cycleModules; c++) {
    // 从后半选择来源模块，向前半选择目标。
    const from = Math.floor(moduleCount * 0.5 + rand() * moduleCount * 0.5)
    const to = Math.floor(rand() * moduleCount * 0.5)
    if (from < moduleCount && to < moduleCount && from !== to) {
      const deps = edges.get(moduleId(from))!
      const target = moduleId(to)
      if (!deps.includes(target)) {
        deps.push(target)
      }
    }
  }

  return { edges, entry: moduleId(0) }
}

// ---------------------------------------------------------------------------
// 虚拟模块插件（resolveId + load）
// ---------------------------------------------------------------------------

/** 基准插件专用模块路径前缀，与真实磁盘文件区分。 */
const BENCH_PREFIX = '/bench/'

/** 从合成图提供虚拟模块；各模块仅导入依赖绑定、不读取它们，避免循环求值的 TDZ 干扰遍历基准。 */
function createBenchPlugin(graph: SyntheticGraph) {
  return {
    name: 'bench-circular-import',

    /** 为 benchmark 路径加空字符前缀，阻止文件系统解析。 */
    resolveId(id: string) {
      if (id.startsWith(BENCH_PREFIX)) {
        // 空字符前缀阻止磁盘文件查找。
        return `\0${id}`
      }
    },

    /** 按邻接表生成静态 imports，并导出当前模块的直接依赖数量。 */
    load(id: string) {
      if (id.startsWith(`\0${BENCH_PREFIX}`)) {
        const realId = id.slice(1)
        const deps = graph.edges.get(realId)
        if (deps) {
          const lines = deps.map(
            (dep, i) => `import { value as __dep_${i}__ } from "${dep}";`,
          )
          lines.push(`export const value = ${deps.length};`)
          return lines.join('\n')
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 基准执行器
// ---------------------------------------------------------------------------

/** 一次 Runner 入口求值的规模与耗时结果，不含服务器创建时间。 */
interface BenchResult {
  /** 本次创建的模块总数。 */
  moduleCount: number
  /** 去重、跳过无效边之后邻接表中的实际边总数。 */
  edgeCount: number
  /** runner.import 入口到完成的 performance.now 差值，单位毫秒。 */
  timeMs: number
}

/** 创建无配置文件/扫描/HMR 的服务器与 SSR Runner，测量入口求值耗时；正常完成后依次关闭 Runner 和服务器。 */
async function runBenchmark(config: GraphConfig): Promise<BenchResult> {
  const graph = generateGraph(config)

  let edgeCount = 0
  for (const deps of graph.edges.values()) {
    edgeCount += deps.length
  }

  const server = await createServer({
    configFile: false,
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    root: import.meta.dirname,
    logLevel: 'error',
    server: {
      middlewareMode: true,
      ws: false,
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
    plugins: [createBenchPlugin(graph)],
  })

  const runner = createServerModuleRunner(server.environments.ssr, {
    hmr: false,
    sourcemapInterceptor: false,
  })

  const start = performance.now()
  await runner.import(graph.entry)
  const timeMs = performance.now() - start

  await runner.close()
  await server.close()

  return {
    moduleCount: config.moduleCount,
    edgeCount,
    timeMs,
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 先用小图预热，再逐个规模运行并打印模块数、实际边数与耗时；入口 catch 把失败输出到 console。 */
async function main() {
  console.log('=== Vite isCircularImport Benchmark ===\n')

  const scales = [100, 500, 1000, 2000, 5000]
  const results: BenchResult[] = []

  // 先运行一次小图用于 JIT 预热。
  await runBenchmark({ moduleCount: 100, avgImports: 3, cycleFraction: 0.05 })

  for (const n of scales) {
    const result = await runBenchmark({
      moduleCount: n,
      avgImports: 3,
      cycleFraction: 0.05,
    })
    results.push(result)

    console.log(`N=${n}:`)
    console.log(`  modules: ${result.moduleCount}, edges: ${result.edgeCount}`)
    console.log(`  time: ${result.timeMs.toFixed(1)}ms`)
    console.log()
  }
}

main().catch(console.error)
