import fs from 'node:fs'
import path from 'node:path'
import type { SyncOptions } from 'execa'
import { execaCommandSync } from 'execa'
import { afterEach, beforeAll, expect, test } from 'vitest'

/** CLI 包目录；子进程直接执行该目录的 Node 入口。 */
const CLI_PATH = path.join(import.meta.dirname, '..')

/** 每例创建的项目名；清理钩子移除其生成目录，避免文件跨例遗留。 */
const projectName = 'test-app'
/** 普通项目输出目录，位于当前测试目录内。 */
const genPath = path.join(import.meta.dirname, projectName)
/** 带 subfolder 的输出目录，用于核对嵌套路径提示与模板复制。 */
const genPathWithSubfolder = path.join(
  import.meta.dirname,
  'subfolder',
  projectName,
)

/** 执行 CLI 并返回 stdout/stderr；测试环境变量使安装和启动步骤仅输出提示，避免真实安装或常驻进程。 */
const run = (args: string[], options?: SyncOptions) => {
  return execaCommandSync(`node ${CLI_PATH} ${args.join(' ')}`, {
    env: { ...process.env, _VITE_TEST_CLI: 'true' },
    ...options,
  })
}

/** 在指定目标目录写入 package.json，触发非空目录处理分支。 */
const createNonEmptyDir = (overrideFolder?: string) => {
  const newNonEmptyFolder = overrideFolder || genPath
  fs.mkdirSync(newNonEmptyFolder, { recursive: true })

  const pkgJson = path.join(newNonEmptyFolder, 'package.json')
  fs.writeFileSync(pkgJson, '{ "foo": "bar" }')
}

/** 模板复制将下划线文件改为点文件；期望列表采用生成目录中的名字。 */
const fileNameMap: Record<string, string> = {
  _gitignore: '.gitignore',
  '_oxlintrc.json': '.oxlintrc.json',
}

/** Vue 模板顶层文件列表，按重命名规则排序后与输出目录逐项比对。 */
const templateFiles = fs
  .readdirSync(path.join(CLI_PATH, 'template-vue'))
  .map((filePath) => fileNameMap[filePath] ?? filePath)
  .sort()

/** React 模板顶层文件列表，用于核对嵌套项目生成是否完整。 */
const templateFilesReact = fs
  .readdirSync(path.join(CLI_PATH, 'template-react'))
  .map((filePath) => fileNameMap[filePath] ?? filePath)
  .sort()

/** 删除普通和嵌套项目输出；首例前和每例后均调用，隔离文件系统状态。 */
const clearAnyPreviousFolders = () => {
  if (fs.existsSync(genPath)) {
    fs.rmSync(genPath, { recursive: true, force: true })
  }
  if (fs.existsSync(genPathWithSubfolder)) {
    fs.rmSync(genPathWithSubfolder, { recursive: true, force: true })
  }
}

beforeAll(() => clearAnyPreviousFolders())
afterEach(() => clearAnyPreviousFolders())

/** 未提供目录名时以交互模式执行 CLI，stdout 应询问 Project name，验证命名提示入口。 */
test('prompts for the project name if none supplied', () => {
  const { stdout } = run(['--interactive'])
  expect(stdout).toContain('Project name:')
})

/** 目标是已创建的空当前目录且未指定框架；执行 . --interactive 后应询问框架，避免把当前目录当成已选模板。 */
test('prompts for the framework if none supplied when target dir is current directory', () => {
  fs.mkdirSync(genPath, { recursive: true })
  const { stdout } = run(['.', '--interactive'], { cwd: genPath })
  expect(stdout).toContain('Select a framework:')
})

/** 只传项目名和交互模式，未选模板；CLI 应继续询问框架。 */
test('prompts for the framework if none supplied', () => {
  const { stdout } = run([projectName, '--interactive'])
  expect(stdout).toContain('Select a framework:')
})

/** 传入 --template 却没有值；CLI 应回退到框架选择提示。 */
test('prompts for the framework on not supplying a value for --template', () => {
  const { stdout } = run([projectName, '--interactive', '--template'])
  expect(stdout).toContain('Select a framework:')
})

/** 模板参数为不存在的 unknown；CLI 应说明模板无效并提示重新选择。 */
test('prompts for the framework on supplying an invalid template', () => {
  const { stdout } = run([
    projectName,
    '--interactive',
    '--template',
    'unknown',
  ])
  expect(stdout).toContain(
    `"unknown" isn't a valid template. Please choose from below:`,
  )
})

/** 交互式选择 react-ts 且未给 linter 参数；CLI 应询问使用哪个 linter。 */
test('prompts to use ESLint for React templates in interactive mode', () => {
  const { stdout } = run([
    projectName,
    '--interactive',
    '--template',
    'react-ts',
  ])
  expect(stdout).toContain('Which linter to use?')
})

/** 预先在目标项目目录写入 package.json；交互创建同名项目应提示该目标非空。 */
test('asks to overwrite non-empty target directory', () => {
  createNonEmptyDir()
  const { stdout } = run([projectName, '--interactive'], {
    cwd: import.meta.dirname,
  })
  expect(stdout).toContain(`Target directory "${projectName}" is not empty.`)
})

/** 预先填充 subfolder/test-app；交互创建该嵌套路径应在警告中保留完整相对目录名。 */
test('asks to overwrite non-empty target directory with subfolder', () => {
  createNonEmptyDir(genPathWithSubfolder)
  const { stdout } = run([`subfolder/${projectName}`, '--interactive'], {
    cwd: import.meta.dirname,
  })
  expect(stdout).toContain(
    `Target directory "subfolder/${projectName}" is not empty.`,
  )
})

/** 当前目录已含 package.json；以 . 为目标时应使用 Current directory 的非空提示。 */
test('asks to overwrite non-empty current directory', () => {
  createNonEmptyDir()
  const { stdout } = run(['.', '--interactive'], { cwd: genPath })
  expect(stdout).toContain(`Current directory is not empty.`)
})

/** 在测试目录交互创建 Vue 项目并关闭立即安装；核对输出路径提示以及重命名后的全部模板顶层文件。 */
test('successfully scaffolds a project based on vue starter template', () => {
  const { stdout } = run(
    [
      projectName,
      '--interactive',
      '--no-immediate',
      '--template',
      'vue',
      '--no-rolldown',
    ],
    {
      cwd: import.meta.dirname,
    },
  )
  const generatedFiles = fs.readdirSync(genPath).sort()

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(templateFiles).toEqual(generatedFiles)
})

/** 以 subfolder/test-app 创建 React 项目并关闭 ESLint、立即安装；核对嵌套输出提示与标准 React 模板文件列表。 */
test('successfully scaffolds a project with subfolder based on react starter template', () => {
  const { stdout } = run(
    [
      `subfolder/${projectName}`,
      '--interactive',
      '--no-immediate',
      '--template',
      'react',
      '--no-eslint',
      '--no-rolldown',
    ],
    {
      cwd: import.meta.dirname,
    },
  )
  const generatedFiles = fs.readdirSync(genPathWithSubfolder).sort()

  expect(stdout).toContain(`Scaffolding project in ${genPathWithSubfolder}`)
  expect(templateFilesReact).toEqual(generatedFiles)
})

/** 选择 react-compiler-ts 创建项目；读取配置、依赖与 README，三处都应体现 React Compiler 启用。 */
test('successfully scaffolds a project based on react-compiler-ts starter template', () => {
  const { stdout } = run([projectName, '--template', 'react-compiler-ts'], {
    cwd: import.meta.dirname,
  })
  const configFile = fs.readFileSync(
    path.join(genPath, 'vite.config.ts'),
    'utf-8',
  )
  const packageJsonFile = fs.readFileSync(
    path.join(genPath, 'package.json'),
    'utf-8',
  )
  const readmeFile = fs.readFileSync(path.join(genPath, 'README.md'), 'utf-8')

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(configFile).toContain('reactCompilerPreset')
  expect(packageJsonFile).toContain('babel-plugin-react-compiler')
  expect(readmeFile).toContain('The React Compiler is enabled on this template')
})

/** 选择 react-ts 且不传 linter 参数；生成目录应只有 Oxlint 配置，依赖、lint 命令与 README 都采用 Oxlint。 */
test('scaffolds react-ts with Oxlint by default', () => {
  const { stdout } = run([projectName, '--template', 'react-ts'], {
    cwd: import.meta.dirname,
  })
  expect(stdout).toContain(`Scaffolding project in ${genPath}`)

  expect(fs.existsSync(path.join(genPath, '.oxlintrc.json'))).toBe(true)
  expect(fs.existsSync(path.join(genPath, 'eslint.config.js'))).toBe(false)

  const pkg = fs.readFileSync(path.join(genPath, 'package.json'), 'utf-8')
  expect(pkg).toContain('"oxlint"')
  expect(pkg).not.toContain('eslint')
  expect(pkg).toContain('"lint": "oxlint"')

  const readme = fs.readFileSync(path.join(genPath, 'README.md'), 'utf-8')
  expect(readme).toContain('Expanding the Oxlint configuration')
  expect(readme).not.toContain('ESLint')
})

/** 选择 React 并显式传 --eslint；输出应有 ESLint 配置与 lint 命令，且移除 Oxlint 配置和依赖。 */
test('scaffolds React template with ESLint when --eslint is passed', () => {
  const { stdout } = run([projectName, '--template', 'react', '--eslint'], {
    cwd: import.meta.dirname,
  })
  expect(stdout).toContain(`Scaffolding project in ${genPath}`)

  expect(fs.existsSync(path.join(genPath, 'eslint.config.js'))).toBe(true)
  expect(fs.existsSync(path.join(genPath, '.oxlintrc.json'))).toBe(false)

  const pkg = fs.readFileSync(path.join(genPath, 'package.json'), 'utf-8')
  expect(pkg).toContain('"eslint"')
  expect(pkg).not.toContain('oxlint')
  expect(pkg).toContain('"lint": "eslint ."')
})

/** 对 Vue 传入仅支持 React 的 --eslint；CLI 应警告后忽略参数，正常复制 Vue 模板且不出现缺失文件错误或 ESLint 配置。 */
test('ignores --eslint with a warning for non-React templates', () => {
  const { stdout, stderr } = run(
    [projectName, '--template', 'vue', '--eslint'],
    {
      cwd: import.meta.dirname,
    },
  )
  expect(stdout).toContain(
    '`--eslint` is only supported for React templates and will be ignored',
  )
  expect(stderr).not.toContain('ENOENT')

  const generatedFiles = fs.readdirSync(genPath).sort()
  expect(templateFiles).toEqual(generatedFiles)
  expect(fs.existsSync(path.join(genPath, 'eslint.config.js'))).toBe(false)
})

/** 用 -t vue 代替 --template；生成路径提示及文件列表应与标准 Vue 模板一致。 */
test('works with the -t alias', () => {
  const { stdout } = run(
    [
      projectName,
      '--interactive',
      '--no-immediate',
      '-t',
      'vue',
      '--no-rolldown',
    ],
    {
      cwd: import.meta.dirname,
    },
  )
  const generatedFiles = fs.readdirSync(genPath).sort()

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(templateFiles).toEqual(generatedFiles)
})

/** 当前目录非空但显式 --overwrite ignore；CLI 应跳过非空目录询问，本例只核对该提示未输出。 */
test('accepts command line override for --overwrite', () => {
  createNonEmptyDir()
  const { stdout } = run(['.', '--interactive', '--overwrite', 'ignore'], {
    cwd: genPath,
  })
  expect(stdout).not.toContain(`Current directory is not empty.`)
})

/** 从非空目录用项目名和 --no-interactive 创建；stdout 不询问项目名，并给出完成后的运行指引。 */
test('skip prompts when --no-interactive is passed', () => {
  createNonEmptyDir()
  const { stdout } = run([projectName, '--no-interactive'], { cwd: genPath })
  expect(stdout).not.toContain('Project name:')
  expect(stdout).toContain('Done. Now run:')
})

/** 只执行 --help；用法文本应列出 immediate、eslint、overwrite 和 help 参数。 */
test('return help usage how to use create-vite', () => {
  const { stdout } = run(['--help'], { cwd: import.meta.dirname })
  const message = 'Usage: create-vite [OPTION]... [DIRECTORY]'
  expect(stdout).toContain(message)
  expect(stdout).toContain('-i, --immediate / --no-immediate')
  expect(stdout).toContain('--eslint / --no-eslint')
  expect(stdout).toContain('--overwrite')
  expect(stdout).toContain('-h, --help')
})

/** 只执行短参数 -h；stdout 应包含 create-vite 的用法行。 */
test('return help usage how to use create-vite with -h alias', () => {
  const { stdout } = run(['-h'], { cwd: import.meta.dirname })
  const message = 'Usage: create-vite [OPTION]... [DIRECTORY]'
  expect(stdout).toContain(message)
})

/** 以 test-app 创建 React 项目；读取生成的 index.html，标题应替换为项目名，并输出生成目录提示。 */
test('sets index.html title to project name', () => {
  const { stdout } = run([projectName, '--template', 'react'], {
    cwd: import.meta.dirname,
  })

  const indexHtmlPath = path.join(genPath, 'index.html')
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf-8')

  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(indexHtmlContent).toContain(`<title>${projectName}</title>`)
})

/** 显式 --immediate 创建 Vue 项目；跳过安装询问并输出安装步骤，run 注入的测试环境只模拟该步骤。 */
test('accepts immediate flag', () => {
  const { stdout } = run([projectName, '--template', 'vue', '--immediate'], {
    cwd: import.meta.dirname,
  })
  expect(stdout).not.toContain('Install and start now?')
  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
  expect(stdout).toContain('Installing dependencies')
})

/** 显式 --no-immediate 创建 Vue 项目；仍生成项目，但不询问安装也不输出安装步骤。 */
test('accepts immediate flag and skips install prompt', () => {
  const { stdout } = run([projectName, '--template', 'vue', '--no-immediate'], {
    cwd: import.meta.dirname,
  })
  expect(stdout).not.toContain('Install and start now?')
  expect(stdout).not.toContain('Installing dependencies')
  expect(stdout).toContain(`Scaffolding project in ${genPath}`)
})
