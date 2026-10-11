import fs from 'node:fs'
import license from 'rollup-plugin-license'
import type { Dependency } from 'rollup-plugin-license'
import colors from 'picocolors'
import type { Plugin, PluginContext } from 'rollup'

/**
 * 为 Vite 自身发布包生成依赖许可证文档，并仅在文本变化时写入目标文件。
 * 复用 rollup-plugin-license 的依赖收集；附加段用于 create-vite 模板许可证，watch 模式跳过两个生成 hook。
 */
export default function licensePlugin(
  licenseFilePath: string,
  licenseTitle: string,
  packageName: string,
  additionalSection?: string,
): Plugin {
  const originalPlugin = license({
    /** 将收集到的依赖按名称与许可证文本归组，连同项目 MIT 文本生成发布许可证。 */
    thirdParty(dependencies) {
      // https://github.com/rollup/rollup/blob/master/build-plugins/generate-license-file.js
      // MIT Licensed https://github.com/rollup/rollup/blob/master/LICENSE-CORE.md
      const coreLicense = fs.readFileSync(
        new URL('../../LICENSE', import.meta.url),
        'utf-8',
      )

      const deps = sortDependencies(dependencies)
      const licenses = sortLicenses(
        new Set(
          dependencies.map((dep) => dep.license).filter(Boolean) as string[],
        ),
      )

      let dependencyLicenseTexts = ''
      for (let i = 0; i < deps.length; i++) {
        // 完全相同的许可证文本合并展示，splice 后回退索引避免漏掉相邻依赖。
        const licenseText = deps[i].licenseText
        const sameDeps = [deps[i]]
        if (licenseText) {
          for (let j = i + 1; j < deps.length; j++) {
            if (licenseText === deps[j].licenseText) {
              sameDeps.push(...deps.splice(j, 1))
              j--
            }
          }
        }

        let text = `## ${sameDeps.map((d) => d.name).join(', ')}\n`
        const depInfos = sameDeps.map((d) => getDependencyInformation(d))

        // 同组许可证标识和贡献者列表也相同时只展示一次，仓库地址仍逐包合并。
        if (
          depInfos.length > 1 &&
          depInfos.every(
            (info) =>
              info.license === depInfos[0].license &&
              info.names === depInfos[0].names,
          )
        ) {
          const { license, names } = depInfos[0]
          const repositoryText = depInfos
            .map((info) => info.repository)
            .filter(Boolean)
            .join(', ')

          if (license) text += `License: ${license}\n`
          if (names) text += `By: ${names}\n`
          if (repositoryText) text += `Repositories: ${repositoryText}\n`
        }
        // 其余情况逐包展示元信息，正文仍共享。
        else {
          for (let j = 0; j < depInfos.length; j++) {
            const { license, names, repository } = depInfos[j]

            if (license) text += `License: ${license}\n`
            if (names) text += `By: ${names}\n`
            if (repository) text += `Repository: ${repository}\n`
            if (j !== depInfos.length - 1) text += '\n'
          }
        }

        if (licenseText) {
          text +=
            '\n' +
            licenseText
              .trim()
              .replace(/\r\n|\r/g, '\n')
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n') +
            '\n'
        }

        if (i !== deps.length - 1) {
          text += '\n---------------------------------------\n\n'
        }

        dependencyLicenseTexts += text
      }

      const licenseText =
        `# ${licenseTitle}\n` +
        `${packageName} is released under the MIT license:\n\n` +
        coreLicense +
        `\n` +
        (additionalSection || '') +
        `# Licenses of bundled dependencies\n` +
        `The published ${packageName} artifact additionally contains code with the following licenses:\n` +
        `${licenses.join(', ')}\n\n` +
        `# Bundled dependencies:\n` +
        dependencyLicenseTexts

      const existingLicenseText = fs.readFileSync(licenseFilePath, 'utf-8')
      if (existingLicenseText !== licenseText) {
        fs.writeFileSync(licenseFilePath, licenseText)
        console.warn(
          colors.yellow(
            '\nLICENSE.md updated. You should commit the updated file.\n',
          ),
        )
      }
    },
  })
  // watch 输出跳过许可证收集/生成，普通输出保持原插件上下文与参数。
  for (const hook of ['renderChunk', 'generateBundle'] as const) {
    const originalHook = originalPlugin[hook]!
    /** watch 模式直接退出；普通构建以原 PluginContext 转发到被包装的 hook。 */
    originalPlugin[hook] = function (this: PluginContext, ...args: unknown[]) {
      if (this.meta.watchMode) return
      return (originalHook as Function).apply(this, args)
    }
  }
  return originalPlugin
}

/** 原地按包名排序依赖数组，稳定许可证文档的包展示顺序。 */
function sortDependencies(dependencies: Dependency[]) {
  return dependencies.sort(({ name: nameA }, { name: nameB }) => {
    return nameA! > nameB! ? 1 : nameB! > nameA! ? -1 : 0
  })
}

/** 将已去重的许可证标识分为普通项和括号表达式，各自排序后把括号表达式放在末尾。 */
function sortLicenses(licenses: Set<string>) {
  let withParenthesis: string[] = []
  let noParenthesis: string[] = []
  licenses.forEach((license) => {
    if (license[0] === '(') {
      withParenthesis.push(license)
    } else {
      noParenthesis.push(license)
    }
  })
  withParenthesis = withParenthesis.sort()
  noParenthesis = noParenthesis.sort()
  return [...noParenthesis, ...withParenthesis]
}

/** 用于许可证文档分组比较和展示的包元信息。 */
interface DependencyInfo {
  /** package.json 提供的许可证标识或表达式。 */
  license?: string
  /** author、maintainers 和 contributors 的姓名去重后连接结果。 */
  names?: string
  /** 规范化为网页 URL 的仓库地址。 */
  repository?: string
}

/** 提取许可证、去重贡献者姓名和仓库地址；未提供的元信息不写入结果。 */
function getDependencyInformation(dep: Dependency): DependencyInfo {
  const info: DependencyInfo = {}
  const { license, author, maintainers, contributors, repository } = dep

  if (license) {
    info.license = license
  }

  const names = new Set<string>()
  for (const person of [author, ...maintainers, ...contributors]) {
    const name = typeof person === 'string' ? person : person?.name
    if (name) {
      names.add(name)
    }
  }
  if (names.size > 0) {
    info.names = Array.from(names).join(', ')
  }

  if (repository) {
    info.repository = normalizeGitUrl(
      typeof repository === 'string' ? repository : repository.url,
    )
  }

  return info
}

/** 将 Git/SSH 和 GitHub 等简写地址转换为文档链接，去掉 git+、.git 与 SSH 用户名前缀。 */
function normalizeGitUrl(url: string): string {
  url = url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/(^|\/)[^/]+?@/, '$1') // 删除 SSH 地址的 user@。
    .replace(/(\.[^.]+?):/, '$1/') // 把 .com: 路径分隔形式转换为 .com/。
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\//, 'https://')
  if (url.startsWith('github:')) {
    return `https://github.com/${url.slice(7)}`
  } else if (url.startsWith('gitlab:')) {
    return `https://gitlab.com/${url.slice(7)}`
  } else if (url.startsWith('bitbucket:')) {
    return `https://bitbucket.org/${url.slice(10)}`
  } else if (!url.includes(':') && url.split('/').length === 2) {
    return `https://github.com/${url}`
  } else {
    return url.includes('://') ? url : `https://${url}`
  }
}
