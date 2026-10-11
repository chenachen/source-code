import fs from 'node:fs/promises'
import path from 'node:path'
import colors from 'picocolors'
import type { Options as ExecaOptions, ResultPromise } from 'execa'
import { execa } from 'execa'

/** 执行发布辅助命令，默认继承 stdio；显式 opts 可覆盖输出方式，返回 Execa 的进程 Promise。 */
function run<EO extends ExecaOptions>(
  bin: string,
  args: string[],
  opts?: EO,
): ResultPromise<
  EO & (keyof EO extends 'stdio' ? object : { stdio: 'inherit' })
> {
  return execa(bin, args, { stdio: 'inherit', ...opts }) as any
}

/** 按包当前 package.json 版本计算 tag：vite 用 v 前缀，其他包用包名@版本。 */
export async function getLatestTag(pkgName: string): Promise<string> {
  const pkgJson = JSON.parse(
    await fs.readFile(`packages/${pkgName}/package.json`, 'utf-8'),
  )
  const version = pkgJson.version
  return pkgName === 'vite' ? `v${version}` : `${pkgName}@${version}`
}

/** 解析当前版本 tag 的提交 SHA，打印该点到 HEAD 之间只影响包目录的提交；Git 失败继续拒绝。 */
export async function logRecentCommits(pkgName: string): Promise<void> {
  const tag = await getLatestTag(pkgName)
  if (!tag) return
  const sha = await run('git', ['rev-list', '-n', '1', tag], {
    stdio: 'pipe',
  }).then((res) => res.stdout.trim())
  console.log(
    colors.bold(
      `\n${colors.blue(`i`)} Commits of ${colors.green(
        pkgName,
      )} since ${colors.green(tag)} ${colors.gray(`(${sha.slice(0, 5)})`)}`,
    ),
  )
  await run(
    'git',
    [
      '--no-pager',
      'log',
      `${sha}..HEAD`,
      '--oneline',
      '--',
      `packages/${pkgName}`,
    ],
    { stdio: 'inherit' },
  )
  console.log()
}

/**
 * 将 create-vite 的所有 template-* 包中 Vite 依赖更新为当前 Vite 版本的 ^ 范围。
 * 含 beta、alpha 或 rc 的版本字符串直接跳过；其他版本按目录枚举顺序写回带末尾换行的 JSON。
 */
export async function updateTemplateVersions(): Promise<void> {
  const vitePkgJson = JSON.parse(
    await fs.readFile('packages/vite/package.json', 'utf-8'),
  )
  const viteVersion = vitePkgJson.version
  if (/beta|alpha|rc/.test(viteVersion)) return

  const dir = 'packages/create-vite'
  const templates = (await fs.readdir(dir)).filter((dir) =>
    dir.startsWith('template-'),
  )
  for (const template of templates) {
    const pkgPath = path.join(dir, template, `package.json`)
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
    pkg.devDependencies.vite = `^` + viteVersion
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
}
