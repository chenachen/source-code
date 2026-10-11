import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import util from 'node:util'
import type { SpawnOptions } from 'node:child_process'
import spawn from 'cross-spawn'
import mri from 'mri'
import * as prompts from '@clack/prompts'
import { determineAgent } from '@vercel/detect-agent'

/** 从颜色 Proxy 取得本 CLI 使用的终端样式函数，供菜单与帮助输出共用。 */
const {
  blue,
  blueBright,
  cyan,
  green,
  greenBright,
  magenta,
  red,
  redBright,
  reset,
  underline,
  yellow,
} = createColors()

/** 按 mri 解析目录与模板/覆盖/立即运行/交互/linter 开关；未提供布尔开关保留 undefined，供 init 选择默认值。 */
const argv = mri<{
  /** 模板名称，对应内置目录或 FRAMEWORKS 的外部创建命令。 */
  template?: string
  /** 打印帮助并退出初始化流程。 */
  help?: boolean
  /** 非空目录直接清理开关；未启用时由交互选择或非交互取消。 */
  overwrite?: boolean
  /** 是否在生成后安装依赖并启动 dev；undefined 时交互询问，非交互默认关闭。 */
  immediate?: boolean
  /** 显式覆盖是否交互；未提供时使用 stdin.isTTY。 */
  interactive?: boolean
  /** 仅 React 模板可用，选择 ESLint 替换默认 Oxlint。 */
  eslint?: boolean
}>(process.argv.slice(2), {
  boolean: ['help', 'overwrite', 'immediate', 'interactive', 'eslint'],
  alias: { h: 'help', t: 'template', i: 'immediate' },
  string: ['template'],
})
/** CLI 启动时的工作目录，供目标 root 与完成提示的相对路径计算。 */
const cwd = process.cwd()

/** CLI 帮助原文，模板列表使用终端颜色函数生成；只有 --help 路径输出。 */
// prettier-ignore
const helpMessage = `\
Usage: create-vite [OPTION]... [DIRECTORY]

Create a new Vite project in JavaScript or TypeScript.
When running in TTY, the CLI will start in interactive mode.

Options:
  -t, --template NAME                   use a specific template
  -i, --immediate / --no-immediate      install dependencies and start dev
  --eslint / --no-eslint                use ESLint instead of Oxlint (only for React templates)
  --overwrite                           remove existing files if target directory is not empty
  --interactive / --no-interactive      force interactive / non-interactive mode
  -h, --help                            display this help message

Available templates:
${yellow    ('vanilla-ts          vanilla'       )}
${green     ('vue-ts              vue'           )}
${cyan      ('react-ts            react'         )}
${cyan      ('react-compiler-ts   react-compiler')}
${magenta   ('preact-ts           preact'        )}
${redBright ('lit-ts              lit'           )}
${red       ('svelte-ts           svelte'        )}
${blue      ('solid-ts            solid'         )}
${blueBright('qwik-ts             qwik'          )}`

/** 终端样式包装函数，输入原文并返回格式化字符串。 */
type ColorFunc = (str: string) => string
/** 框架选择项及其可生成或委托的模板变体。 */
type Framework = {
  /** 框架内部选择值。 */
  name: string
  /** 交互菜单显示名称。 */
  display: string
  /** 菜单显示名称使用的颜色函数。 */
  color: ColorFunc
  /** 该框架下可选择的模板变体。 */
  variants: FrameworkVariant[]
}
/** 模板变体；有 customCommand 时委托外部脚手架，否则复制本包 template-name 目录。 */
type FrameworkVariant = {
  /** 命令行 template 值与内部选择值。 */
  name: string
  /** 变体菜单标签。 */
  display: string
  /** 额外显示在菜单标签中的项目网址。 */
  link?: `https://${string}`
  /** 菜单标签的终端颜色函数。 */
  color: ColorFunc
  /** 以 npm 语法记录的外部创建命令；执行前适配包管理器并按独立参数替换 TARGET_DIR。 */
  customCommand?: string
}

/** 交互框架/变体目录，兼含内置模板和外部脚手架命令。 */
const FRAMEWORKS: Framework[] = [
  {
    name: 'vanilla',
    display: 'Vanilla',
    color: yellow,
    variants: [
      {
        name: 'vanilla-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'vanilla',
        display: 'JavaScript',
        color: yellow,
      },
    ],
  },
  {
    name: 'vue',
    display: 'Vue',
    color: green,
    variants: [
      {
        name: 'vue-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'vue',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'custom-create-vue',
        display: 'Official Vue Starter ↗',
        color: green,
        customCommand: 'npm create vue@latest TARGET_DIR',
      },
      {
        name: 'custom-nuxt',
        display: 'Nuxt ↗',
        link: 'https://nuxt.com',
        color: greenBright,
        customCommand: 'npm exec nuxi init TARGET_DIR',
      },
      {
        name: 'custom-vike-vue',
        display: 'Vike ↗',
        link: 'https://vike.dev',
        color: greenBright,
        customCommand: 'npm create -- vike@latest --vue TARGET_DIR',
      },
    ],
  },
  {
    name: 'react',
    display: 'React',
    color: cyan,
    variants: [
      {
        name: 'react-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'react-compiler-ts',
        display: 'TypeScript + React Compiler',
        color: blue,
      },
      {
        name: 'react',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'react-compiler',
        display: 'JavaScript + React Compiler',
        color: yellow,
      },
      {
        name: 'rsc',
        display: 'RSC',
        color: magenta,
        customCommand:
          'npm exec tiged vitejs/vite-plugin-react/packages/plugin-rsc/examples/starter TARGET_DIR',
      },
      {
        name: 'custom-react-router',
        display: 'React Router v7 ↗',
        link: 'https://reactrouter.com',
        color: cyan,
        customCommand: 'npm create react-router@latest TARGET_DIR',
      },
      {
        name: 'custom-tanstack-router-react',
        display: 'TanStack Router ↗',
        link: 'https://tanstack.com/router',
        color: cyan,
        customCommand:
          'npm exec -- @tanstack/cli@latest create TARGET_DIR --framework react --interactive',
      },
      {
        name: 'redwoodsdk-standard',
        display: 'RedwoodSDK ↗',
        link: 'https://rwsdk.com',
        color: cyan,
        customCommand: 'npm create rwsdk@latest TARGET_DIR',
      },
      {
        name: 'custom-vike-react',
        display: 'Vike ↗',
        link: 'https://vike.dev',
        color: cyan,
        customCommand: 'npm create -- vike@latest --react TARGET_DIR',
      },
    ],
  },
  {
    name: 'preact',
    display: 'Preact',
    color: magenta,
    variants: [
      {
        name: 'preact-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'preact',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'custom-create-preact',
        display: 'Official Preact Starter ↗',
        color: magenta,
        customCommand: 'npm create preact@latest TARGET_DIR',
      },
    ],
  },
  {
    name: 'lit',
    display: 'Lit',
    color: redBright,
    variants: [
      {
        name: 'lit-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'lit',
        display: 'JavaScript',
        color: yellow,
      },
    ],
  },
  {
    name: 'svelte',
    display: 'Svelte',
    color: red,
    variants: [
      {
        name: 'svelte-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'svelte',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'custom-svelte-kit',
        display: 'SvelteKit ↗',
        color: red,
        customCommand: 'npm exec sv create TARGET_DIR',
      },
    ],
  },
  {
    name: 'solid',
    display: 'Solid',
    color: blue,
    variants: [
      {
        name: 'solid-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'solid',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'custom-tanstack-router-solid',
        display: 'TanStack Router ↗',
        link: 'https://tanstack.com/router',
        color: cyan,
        customCommand:
          'npm exec -- @tanstack/cli@latest create TARGET_DIR --framework solid --interactive',
      },
      {
        name: 'custom-vike-solid',
        display: 'Vike ↗',
        link: 'https://vike.dev',
        color: cyan,
        customCommand: 'npm create -- vike@latest --solid TARGET_DIR',
      },
    ],
  },
  {
    name: 'ember',
    display: 'Ember',
    color: redBright,
    variants: [
      {
        name: 'ember-app-ts',
        display: 'TypeScript ↗',
        color: blueBright,
        customCommand:
          'npm exec -- ember-cli@latest new TARGET_DIR --typescript',
      },
      {
        name: 'ember-app',
        display: 'JavaScript ↗',
        color: redBright,
        customCommand: 'npm exec -- ember-cli@latest new TARGET_DIR',
      },
    ],
  },
  {
    name: 'qwik',
    display: 'Qwik',
    color: blueBright,
    variants: [
      {
        name: 'qwik-ts',
        display: 'TypeScript',
        color: blueBright,
      },
      {
        name: 'qwik',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'custom-qwik-city',
        display: 'QwikCity ↗',
        color: blueBright,
        customCommand: 'npm create qwik@latest empty TARGET_DIR',
      },
    ],
  },
  {
    name: 'angular',
    display: 'Angular',
    color: red,
    variants: [
      {
        name: 'custom-angular',
        display: 'Angular ↗',
        color: red,
        customCommand: 'npm exec @angular/cli@latest new TARGET_DIR',
      },
      {
        name: 'custom-analog',
        display: 'Analog ↗',
        color: yellow,
        customCommand: 'npm create analog@latest TARGET_DIR',
      },
    ],
  },
  {
    name: 'marko',
    display: 'Marko',
    color: magenta,
    variants: [
      {
        name: 'marko-run',
        display: 'Marko Run ↗',
        color: magenta,
        customCommand: 'npm create -- marko@latest --name TARGET_DIR',
      },
    ],
  },
  {
    name: 'others',
    display: 'Others',
    color: reset,
    variants: [
      {
        name: 'create-vite-extra',
        display: 'Extra Vite Starters ↗',
        color: reset,
        customCommand: 'npm create vite-extra@latest TARGET_DIR',
      },
      {
        name: 'create-electron-vite',
        display: 'Electron ↗',
        color: reset,
        customCommand: 'npm create electron-vite@latest TARGET_DIR',
      },
    ],
  },
]

/** 框架目录展平后的合法 template 名称，供命令行参数校验使用。 */
const TEMPLATES = FRAMEWORKS.map((f) => f.variants.map((v) => v.name)).reduce(
  (a, b) => a.concat(b),
  [],
)

/** 复制模板时需要恢复点号前缀的文件名映射。 */
const renameFiles: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
  '_oxlintrc.json': '.oxlintrc.json',
}

/** 未给目录时交互默认值或非交互目标目录。 */
const defaultTargetDir = 'vite-project'

/** 同步执行命令；非零正退出码原样退出，spawn 错误打印后退出 1，调用者提供 cwd/stdio。 */
function run([command, ...args]: string[], options?: SpawnOptions) {
  const { status, error } = spawn.sync(command, args, options)
  if (status != null && status > 0) {
    process.exit(status)
  }

  if (error) {
    console.error(`\n${command} ${args.join(' ')} error!`)
    console.error(error)
    process.exit(1)
  }
}

/** 在目标目录执行包管理器安装命令；CLI 测试环境仅打印跳过提示。 */
function install(root: string, agent: string) {
  if (process.env._VITE_TEST_CLI) {
    prompts.log.step(
      `Installing dependencies with ${agent}... (skipped in test)`,
    )
    return
  }
  prompts.log.step(`Installing dependencies with ${agent}...`)
  run(getInstallCommand(agent), {
    stdio: 'inherit',
    cwd: root,
  })
}

/** 在目标目录运行 dev 脚本；CLI 测试环境不启动长驻服务器。 */
function start(root: string, agent: string) {
  if (process.env._VITE_TEST_CLI) {
    prompts.log.step('Starting dev server... (skipped in test)')
    return
  }
  prompts.log.step('Starting dev server...')
  run(getRunCommand(agent, 'dev'), {
    stdio: 'inherit',
    cwd: root,
  })
}

/**
 * 完成 CLI 初始化：帮助/交互选择、非空目录处理、包名与模板选择、外部委托或复制内置模板，再可选安装启动。
 * 非交互缺省 vanilla-ts 且不立即运行；非空目标未启用 overwrite 时取消。所有交互取消立即返回，外部命令分支退出进程且不进入内置模板目录创建。
 */
async function init() {
  const argTargetDir = argv._[0]
    ? formatTargetDir(String(argv._[0]))
    : undefined
  const argTemplate = argv.template
  const argOverwrite = argv.overwrite
  const argImmediate = argv.immediate
  const argInteractive = argv.interactive
  const argEslint = argv.eslint

  const help = argv.help
  if (help) {
    console.log(helpMessage)
    return
  }

  const interactive = argInteractive ?? process.stdin.isTTY

  // 代理环境中仍启用交互时，提示一次性非交互命令。
  const { isAgent } = await determineAgent()
  if (isAgent && interactive) {
    console.log(
      '\nTo create in one go, run: create-vite <DIRECTORY> --no-interactive --template <TEMPLATE>\n',
    )
  }

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)
  /** 统一输出交互或目录处理取消提示。 */
  const cancel = () => prompts.cancel('Operation cancelled')

  // 1. 确定项目名与目标目录。
  let targetDir = argTargetDir
  if (!targetDir) {
    if (interactive) {
      const projectName = await prompts.text({
        message: 'Project name:',
        defaultValue: defaultTargetDir,
        placeholder: defaultTargetDir,
        /** 项目目录提示的校验器；空值可采用默认值，非空输入经路径清理后必须仍有字符。 */
        validate: (value) => {
          return !value || formatTargetDir(value).length > 0
            ? undefined
            : 'Invalid project name'
        },
      })
      if (prompts.isCancel(projectName)) return cancel()
      targetDir = formatTargetDir(projectName)
    } else {
      targetDir = defaultTargetDir
    }
  }

  // 2. 目标存在且非空时，处理覆盖、忽略或取消。
  if (fs.existsSync(targetDir) && !isEmpty(targetDir)) {
    let overwrite: 'yes' | 'no' | 'ignore' | undefined = argOverwrite
      ? 'yes'
      : undefined
    if (!overwrite) {
      if (interactive) {
        const res = await prompts.select({
          message:
            (targetDir === '.'
              ? 'Current directory'
              : `Target directory "${targetDir}"`) +
            ` is not empty. Please choose how to proceed:`,
          options: [
            {
              label: 'Cancel operation',
              value: 'no',
            },
            {
              label: 'Remove existing files and continue',
              value: 'yes',
            },
            {
              label: 'Ignore files and continue',
              value: 'ignore',
            },
          ],
        })
        if (prompts.isCancel(res)) return cancel()
        overwrite = res
      } else {
        overwrite = 'no'
      }
    }

    switch (overwrite) {
      case 'yes':
        emptyDir(targetDir)
        break
      case 'no':
        cancel()
        return
    }
  }

  // 3. 从目标目录生成并校验包名。
  let packageName = path.basename(path.resolve(targetDir))
  if (!isValidPackageName(packageName)) {
    if (interactive) {
      const packageNameResult = await prompts.text({
        message: 'Package name:',
        defaultValue: toValidPackageName(packageName),
        placeholder: toValidPackageName(packageName),
        /** 仅对非空包名校验 npm 名称正则，失败返回交互错误提示。 */
        validate(dir) {
          if (dir && !isValidPackageName(dir)) {
            return 'Invalid package.json name'
          }
        },
      })
      if (prompts.isCancel(packageNameResult)) return cancel()
      packageName = packageNameResult
    } else {
      packageName = toValidPackageName(packageName)
    }
  }

  // 4. 选择框架与模板变体。
  let template = argTemplate
  let hasInvalidArgTemplate = false
  if (argTemplate && !TEMPLATES.includes(argTemplate)) {
    template = undefined
    hasInvalidArgTemplate = true
  }
  if (!template) {
    if (interactive) {
      const framework = await prompts.select({
        message: hasInvalidArgTemplate
          ? `"${argTemplate}" isn't a valid template. Please choose from below: `
          : 'Select a framework:',
        options: FRAMEWORKS.map((framework) => {
          const frameworkColor = framework.color
          return {
            label: frameworkColor(framework.display || framework.name),
            value: framework,
          }
        }),
      })
      if (prompts.isCancel(framework)) return cancel()

      const variant = await prompts.select({
        message: 'Select a variant:',
        options: framework.variants.map((variant) => {
          const command = variant.customCommand
            ? getFullCustomCommand(variant.customCommand, pkgInfo).replace(
                / TARGET_DIR$/,
                '',
              )
            : undefined
          return {
            label: getLabel(variant),
            value: variant.name,
            hint: command,
          }
        }),
      })
      if (prompts.isCancel(variant)) return cancel()

      template = variant
    } else {
      template = 'vanilla-ts'
    }
  }

  const pkgManager = pkgInfo ? pkgInfo.name : 'npm'

  const root = path.join(cwd, targetDir)
  // React Compiler 变体复用普通 React 模板，复制后另做配置。
  let isReactCompiler = false
  if (template.includes('react-compiler')) {
    isReactCompiler = true
    template = template.replace('-compiler', '')
  }

  const { customCommand } =
    FRAMEWORKS.flatMap((f) => f.variants).find((v) => v.name === template) ?? {}

  if (customCommand) {
    const fullCustomCommand = getFullCustomCommand(customCommand, pkgInfo)

    const [command, ...args] = fullCustomCommand.split(' ')
    // 先拆命令，再按独立参数替换目标目录，保留目录中的空格。
    const replacedArgs = args.map((arg) =>
      arg.replace('TARGET_DIR', () => targetDir),
    )
    const { status } = spawn.sync(command, replacedArgs, {
      stdio: 'inherit',
    })
    process.exit(status ?? 0)
  }

  // 5. 仅 React 模板可选择用 ESLint 替换 Oxlint。
  const isReactTemplate = template === 'react' || template === 'react-ts'
  let eslint = argEslint
  if (!isReactTemplate && eslint) {
    prompts.log.warn(
      '`--eslint` is only supported for React templates and will be ignored',
    )
    eslint = false
  }
  if (isReactTemplate && eslint === undefined) {
    if (interactive) {
      const eslintResult = await prompts.select({
        message: 'Which linter to use?',
        options: [
          { label: 'Oxlint', value: false },
          { label: 'ESLint', value: true },
        ],
      })
      if (prompts.isCancel(eslintResult)) return cancel()
      eslint = eslintResult
    } else {
      eslint = false
    }
  }

  // 6. 确定是否生成后立即安装并启动。
  let immediate = argImmediate
  if (immediate === undefined) {
    if (interactive) {
      const immediateResult = await prompts.confirm({
        message: `Install with ${pkgManager} and start now?`,
      })
      if (prompts.isCancel(immediateResult)) return cancel()
      immediate = immediateResult
    } else {
      immediate = false
    }
  }

  // 外部脚手架分支已退出；这里只为内置模板创建目录。
  fs.mkdirSync(root, { recursive: true })
  prompts.log.step(`Scaffolding project in ${root}...`)

  const templateDir = path.resolve(
    fileURLToPath(import.meta.url),
    '../..',
    `template-${template}`,
  )

  /** 按 renameFiles 映射写入目标；非空 content 原样写入，index.html 另替换 title，其余路径复制模板文件或目录。 */
  const write = (file: string, content?: string) => {
    const targetPath = path.join(root, renameFiles[file] ?? file)
    if (content) {
      fs.writeFileSync(targetPath, content)
    } else if (file === 'index.html') {
      const templatePath = path.join(templateDir, file)
      const templateContent = fs.readFileSync(templatePath, 'utf-8')
      const updatedContent = templateContent.replace(
        /<title>.*?<\/title>/,
        `<title>${packageName}</title>`,
      )
      fs.writeFileSync(targetPath, updatedContent)
    } else {
      copy(path.join(templateDir, file), targetPath)
    }
  }

  const files = fs.readdirSync(templateDir)
  for (const file of files.filter((f) => f !== 'package.json')) {
    write(file)
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(templateDir, `package.json`), 'utf-8'),
  )

  pkg.name = packageName

  write('package.json', JSON.stringify(pkg, null, 2) + '\n')

  if (isReactCompiler) {
    setupReactCompiler(root, template.endsWith('-ts'))
  }

  if (eslint) {
    setupEslint(root, template.endsWith('-ts'))
  }

  if (immediate) {
    install(root, pkgManager)
    start(root, pkgManager)
  } else {
    let doneMessage = ''
    const cdProjectName = path.relative(cwd, root)
    doneMessage += `Done. Now run:\n`
    if (root !== cwd) {
      doneMessage += `\n  cd ${
        cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName
      }`
    }
    doneMessage += `\n  ${getInstallCommand(pkgManager).join(' ')}`
    doneMessage += `\n  ${getRunCommand(pkgManager, 'dev').join(' ')}`
    prompts.outro(doneMessage)
  }
}

/** 清理目录首尾空白、文件名禁用字符与尾部斜杠；保留中间路径层级供目标 root 使用。 */
function formatTargetDir(targetDir: string) {
  return targetDir
    .trim()
    .replace(/[<>:"\\|?*]/g, '')
    .replace(/\/+$/g, '')
}

/** stat 来源后分派递归目录复制或文件复制；文件系统错误直接传播。 */
function copy(src: string, dest: string) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    copyDir(src, dest)
  } else {
    fs.copyFileSync(src, dest)
  }
}

/** 按当前允许的 npm 名称正则校验普通或 scoped 名称，供交互提示和默认包名选择。 */
function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(
    projectName,
  )
}

/** 将目录名转换为默认包名：小写、空白转连字符，清理开头点/下划线及其他不允许字符。 */
function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-')
}

/** 递归创建目标目录并复制全部来源条目，复用 copy 对文件/目录的分派。 */
function copyDir(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    const destFile = path.resolve(destDir, file)
    copy(srcFile, destFile)
  }
}

/** 目标无条目或仅有 .git 时视作可直接生成，不触发非空目录询问。 */
function isEmpty(path: string) {
  const files = fs.readdirSync(path)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

/** 目标存在时递归删除除 .git 外的条目，保留仓库元数据。 */
function emptyDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return
  }
  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') {
      continue
    }
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
  }
}

/** 从 npm_config_user_agent 首段提取的包管理器名称与版本，不做额外格式校验。 */
interface PkgInfo {
  /** 首个 user-agent 段的斜杠前名称，供命令映射使用。 */
  name: string
  /** 首个 user-agent 段的斜杠后版本，供 Yarn 1.x 特殊分支使用。 */
  version: string
}

/** 读取 user-agent 首段的 name/version；未提供时返回 undefined，使调用者回退 npm。 */
function pkgFromUserAgent(userAgent: string | undefined): PkgInfo | undefined {
  if (!userAgent) return undefined
  const pkgSpec = userAgent.split(' ')[0]
  const pkgSpecArr = pkgSpec.split('/')
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  }
}

/** 在已生成 React 模板中加入 Babel/React Compiler 依赖，改写 Vite 插件列表并更新 README 对应段；TS 模板另加 Babel 类型包。 */
function setupReactCompiler(root: string, isTs: boolean) {
  // renovate: datasource=npm depName=@rolldown/plugin-babel
  const babelPluginVersion = '0.2.3'
  // renovate: datasource=npm depName=babel-plugin-react-compiler
  const reactCompilerPluginVersion = '1.0.0'
  // renovate: datasource=npm depName=@babel/core
  const babelCoreVersion = '7.29.7'
  // renovate: datasource=npm depName=@types/babel__core
  const typesBabelCoreVersion = '7.20.5'

  editFile(path.resolve(root, 'package.json'), (content) => {
    const asObject = JSON.parse(content)
    const devDepsEntries = Object.entries(asObject.devDependencies)
    devDepsEntries.push(['@rolldown/plugin-babel', `^${babelPluginVersion}`])
    devDepsEntries.push([
      'babel-plugin-react-compiler',
      `^${reactCompilerPluginVersion}`,
    ])
    devDepsEntries.push(['@babel/core', `^${babelCoreVersion}`])
    if (isTs) {
      devDepsEntries.push(['@types/babel__core', `^${typesBabelCoreVersion}`])
    }
    devDepsEntries.sort()
    asObject.devDependencies = Object.fromEntries(devDepsEntries)
    return JSON.stringify(asObject, null, 2) + '\n'
  })
  editFile(
    path.resolve(root, `vite.config.${isTs ? 'ts' : 'js'}`),
    (content) => {
      return content
        .replace(
          `import react from '@vitejs/plugin-react'`,
          `import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'`,
        )
        .replace(
          '  plugins: [react()],',
          `  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],`,
        )
    },
  )
  updateReactCompilerReadme(
    root,
    'The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.\n\nNote: This will impact Vite dev & build performances.',
  )
}

/** 把已生成 React 模板的 Oxlint 配置和依赖换成 ESLint，写对应 JS/TS flat config、更新 lint 脚本与 README；保留生成文本原文。 */
function setupEslint(root: string, isTs: boolean) {
  // renovate: datasource=npm depName=@eslint/js
  const eslintJsVersion = '10.0.1'
  // renovate: datasource=npm depName=eslint
  const eslintVersion = '10.8.0'
  // renovate: datasource=npm depName=eslint-plugin-react-hooks
  const eslintPluginReactHooksVersion = '7.1.1'
  // renovate: datasource=npm depName=eslint-plugin-react-refresh
  const eslintPluginReactRefreshVersion = '0.5.3'
  // renovate: datasource=npm depName=globals
  const globalsVersion = '17.8.0'
  // renovate: datasource=npm depName=typescript-eslint
  const typescriptEslintVersion = '8.65.0'

  const eslintConfigForTS = /* js */ `import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
`
  const eslintConfigForJS = /* js */ `import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
`

  fs.rmSync(path.resolve(root, '.oxlintrc.json'))

  const eslintConfig = isTs ? eslintConfigForTS : eslintConfigForJS
  fs.writeFileSync(path.resolve(root, 'eslint.config.js'), eslintConfig)

  editFile(path.resolve(root, 'package.json'), (content) => {
    const asObject = JSON.parse(content)
    const devDepsEntries = Object.entries(asObject.devDependencies).filter(
      ([name]) => name !== 'oxlint',
    )
    devDepsEntries.push(
      ['@eslint/js', `^${eslintJsVersion}`],
      ['eslint', `^${eslintVersion}`],
      ['eslint-plugin-react-hooks', `^${eslintPluginReactHooksVersion}`],
      ['eslint-plugin-react-refresh', `^${eslintPluginReactRefreshVersion}`],
      ['globals', `^${globalsVersion}`],
    )
    if (isTs) {
      devDepsEntries.push(['typescript-eslint', `^${typescriptEslintVersion}`])
    }
    devDepsEntries.sort()
    asObject.devDependencies = Object.fromEntries(devDepsEntries)
    asObject.scripts.lint = 'eslint .'
    return JSON.stringify(asObject, null, 2) + '\n'
  })

  editFile(path.resolve(root, 'README.md'), (content) => {
    content = content.replace(
      'with HMR and some Oxlint rules',
      'with HMR and some ESLint rules',
    )
    const headingIndex = content.indexOf(
      '## Expanding the Oxlint configuration',
    )
    if (headingIndex === -1) {
      console.warn('Could not update Oxlint section in README.md')
      return content
    }
    const eslintTypeAwareConfig = /* js */ `export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
`
    const eslintReactConfig = /* js */ `// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
`

    const eslintSection = isTs
      ? `## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

\`\`\`js
${eslintTypeAwareConfig}
\`\`\`

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

\`\`\`js
${eslintReactConfig}
\`\`\`
`
      : `## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [\`typescript-eslint\`](https://typescript-eslint.io) in your project.
`
    return content.slice(0, headingIndex) + eslintSection
  })
}

/** 定位 React Compiler 标题和下一个二级标题，只替换中间正文；结构不匹配时告警并保留内容。 */
function updateReactCompilerReadme(root: string, newBody: string) {
  editFile(path.resolve(root, `README.md`), (content) => {
    const h2Start = content.indexOf('## React Compiler')
    const bodyStart = content.indexOf('\n\n', h2Start)
    const compilerSectionEnd = content.indexOf('\n## ', bodyStart)
    if (h2Start === -1 || bodyStart === -1 || compilerSectionEnd === -1) {
      console.warn('Could not update compiler section in README.md')
      return content
    }
    return content.replace(
      content.slice(bodyStart + 2, compilerSectionEnd - 1),
      newBody,
    )
  })
}

/** 同步读取 UTF-8 文件，将 callback 返回的完整文本写回同一路径；回调和文件错误直接传播。 */
function editFile(file: string, callback: (content: string) => string) {
  const content = fs.readFileSync(file, 'utf-8')
  fs.writeFileSync(file, callback(content), 'utf-8')
}

/** 把保存的 npm create/exec 命令适配为当前包管理器；Yarn 1 去掉 @latest，bun/deno/pnpm 使用对应创建或执行入口。 */
function getFullCustomCommand(customCommand: string, pkgInfo?: PkgInfo) {
  const pkgManager = pkgInfo ? pkgInfo.name : 'npm'
  const isYarn1 = pkgManager === 'yarn' && pkgInfo?.version.startsWith('1.')

  return (
    customCommand
      .replace(/^npm create (?:-- )?/, () => {
        // bun create 使用自己的模板规则，改用 bun x 执行创建包。
        if (pkgManager === 'bun') {
          return 'bun x create-'
        }
        // Deno 用 run -A npm:create- 执行创建包并提供所需权限。
        if (pkgManager === 'deno') {
          return 'deno run -A npm:create-'
        }
        // pnpm 分支不保留 npm 的 -- 分隔形式。
        if (pkgManager === 'pnpm') {
          return 'pnpm create '
        }
        // 其余包管理器保留原 create 命令格式。
        return customCommand.startsWith('npm create -- ')
          ? `${pkgManager} create -- `
          : `${pkgManager} create `
      })
      // Yarn 1.x 的 create 命令不接受 @version，此分支去掉 @latest。
      .replace('@latest', () => (isYarn1 ? '' : '@latest'))
      .replace(/^npm exec (?:-- )?/, () => {
        // 按包管理器映射临时执行命令。
        if (pkgManager === 'pnpm') {
          // pnpm 分支不保留 npm 的 -- 分隔形式。
          return 'pnpm dlx '
        }
        if (pkgManager === 'yarn' && !isYarn1) {
          return 'yarn dlx '
        }
        if (pkgManager === 'bun') {
          return 'bun x '
        }
        if (pkgManager === 'deno') {
          return 'deno run -A npm:'
        }
        // Yarn 1.x 与其他自定义客户端仍使用原 npm exec 格式。
        return customCommand.startsWith('npm exec -- ')
          ? 'npm exec -- '
          : 'npm exec '
      })
  )
}

/** 给变体显示名着色，存在网址时附加下划线链接。 */
function getLabel(variant: FrameworkVariant) {
  const labelText = variant.display || variant.name
  let label = variant.color(labelText)
  const { link } = variant
  if (link) {
    label += ` ${underline(link)}`
  }
  return label
}

/** 生成安装命令参数；Yarn 使用裸命令，其他包管理器追加 install。 */
function getInstallCommand(agent: string) {
  if (agent === 'yarn') {
    return [agent]
  }
  return [agent, 'install']
}

/** 按包管理器生成脚本命令；Yarn/pnpm/bun 直接脚本名，Deno task，其余 run。 */
function getRunCommand(agent: string, script: string) {
  switch (agent) {
    case 'yarn':
    case 'pnpm':
    case 'bun':
      return [agent, script]
    case 'deno':
      return [agent, 'task', script]
    default:
      return [agent, 'run', script]
  }
}

/** util.styleText 接受的单个终端样式名称，排除样式数组形式。 */
type ColorName = Exclude<Parameters<typeof util.styleText>[0], any[]>

/** 通过 Proxy 按属性名惰性提供 util.styleText 包装函数，不预建全部颜色函数。 */
function createColors() {
  return new Proxy({} as Record<ColorName, ColorFunc>, {
    /** 把请求的样式属性转换为终端格式化函数，实际样式应用发生在返回函数调用时。 */
    get(_, prop: ColorName) {
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- our supported nodejs range supports `styleText` but in experimental state, which is fine
      return (str: string) => util.styleText(prop, str)
    },
  })
}

init().catch((e) => {
  console.error(e)
})
