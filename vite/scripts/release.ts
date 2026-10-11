import { generateChangelog, release } from '@vitejs/release-scripts'
import colors from 'picocolors'
import { logRecentCommits, updateTemplateVersions } from './releaseUtils'

release({
  repo: 'vite',
  packages: ['vite', 'create-vite', 'plugin-legacy'],
  /** Vite 使用 v 前缀；其余 workspace 包使用包名@版本作为发布 tag。 */
  toTag: (pkg, version) =>
    pkg === 'vite' ? `v${version}` : `${pkg}@${version}`,
  /** 在发布前展示该包当前版本 tag 之后的路径限定提交。 */
  logChangelog: (pkg) => logRecentCommits(pkg),
  /** create-vite 先更新模板的 Vite 版本，再按包目录和对应 tag 前缀生成 changelog。 */
  generateChangelog: async (pkgName) => {
    if (pkgName === 'create-vite') await updateTemplateVersions()

    console.log(colors.cyan('\nGenerating changelog...'))

    await generateChangelog({
      /** 将当前发布包映射到 workspace 的 packages 子目录。 */
      getPkgDir: () => `packages/${pkgName}`,
      tagPrefix: pkgName === 'vite' ? undefined : `${pkgName}@`,
    })
  },
})
