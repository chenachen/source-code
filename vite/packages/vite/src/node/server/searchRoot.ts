import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { isFileReadable } from '../utils'

// 可明确标识 monorepo 边界的根文件。`.git`、Rush、Nx 等候选项没有启用，
// 避免仅因版本库或工具配置存在就把 Vite 文件访问边界扩大过多：
// https://github.com/vitejs/vite/issues/2820#issuecomment-812495079
const ROOT_FILES = [
  // '.git',

  // https://pnpm.io/workspaces/
  'pnpm-workspace.yaml',

  // https://rushjs.io/pages/advanced/config_files/
  // 'rush.json',

  // https://nx.dev/latest/react/getting-started/nx-setup
  // 'workspace.json',
  // 'nx.json',

  // https://github.com/lerna/lerna#lernajson
  'lerna.json',
]

/**
 * 判断 package.json 是否声明 npm/Yarn 兼容的 workspaces 字段。
 * @see https://docs.npmjs.com/cli/v7/using-npm/workspaces#installing-workspaces
 * @see https://classic.yarnpkg.com/en/docs/workspaces/#toc-how-to-use-it
 */
function hasWorkspacePackageJSON(root: string): boolean {
  const path = join(root, 'package.json')
  if (!isFileReadable(path)) {
    return false
  }
  try {
    const content = JSON.parse(fs.readFileSync(path, 'utf-8')) || {}
    return !!content.workspaces
  } catch {
    return false
  }
}

/**
 * 判断目录是否是 Deno workspace；JSONC 仅在内容同时是合法 JSON 时识别。
 * @see https://docs.deno.com/runtime/fundamentals/workspaces/
 */
function hasWorkspaceDenoJSON(root: string): boolean {
  for (const name of ['deno.json', 'deno.jsonc']) {
    const path = join(root, name)
    if (!isFileReadable(path)) {
      continue
    }
    try {
      const content = JSON.parse(fs.readFileSync(path, 'utf-8')) || {}
      if (content.workspace) return true
    } catch {
      // 完整 JSONC 支持需要额外解析器；探测失败只表示不把此目录视为 workspace。
    }
  }
  return false
}

/** 是否存在 ROOT_FILES 中任一显式 workspace 标记。 */
function hasRootFile(root: string): boolean {
  return ROOT_FILES.some((file) => fs.existsSync(join(root, file)))
}

/** package.json 存在性检查，不要求其内容可解析。 */
function hasPackageJSON(root: string) {
  const path = join(root, 'package.json')
  return fs.existsSync(path)
}

/**
 * 从当前目录向上查找最近的 package.json，并以初始目录作为兜底。
 *
 * 该结果是“最近包根”，不一定是 monorepo workspace 根。
 */
export function searchForPackageRoot(
  current: string,
  root: string = current,
): string {
  if (hasPackageJSON(current)) return current

  const dir = dirname(current)
  // 到达文件系统根仍未找到时，保留传入的兜底根目录。
  if (!dir || dir === current) return root

  return searchForPackageRoot(dir, root)
}

/**
 * 从当前目录向上查找最近的 workspace 根。
 *
 * pnpm/lerna 根文件、package.json workspaces 与 Deno workspace 都可命中；若
 * 一直未命中，则退回最近包根。该结果常用于推导开发服务器默认 fs.allow 边界。
 */
export function searchForWorkspaceRoot(
  current: string,
  root: string = searchForPackageRoot(current),
): string {
  if (hasRootFile(current)) return current
  if (hasWorkspacePackageJSON(current)) return current
  if (hasWorkspaceDenoJSON(current)) return current

  const dir = dirname(current)
  // 到达文件系统根仍未命中 workspace 标记时，返回最近包根兜底。
  if (!dir || dir === current) return root

  return searchForWorkspaceRoot(dir, root)
}
