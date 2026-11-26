# 本地服务与命令行工具

## 用途

实现工作区读写、演示维护、Agent 交接、上下文及导出。

## 主要内容

命令入口见 [package.json](../package.json)。

| 文件 | 说明 |
|---|---|
| [`README.md`](README.md) | 索引本地服务、命令行工具和测试。 |
| [`agent.mjs`](agent.mjs) | 签发单对象编辑请求，审阅或按明确选项应用 Agent 提案。 |
| [`browser.test.mjs`](browser.test.mjs) | 在临时双页工作区对复制、框选、写回与冲突恢复做 Chromium 回归测试。 |
| [`check.mjs`](check.mjs) | 校验清单、叙事索引、页面模型、静态投影和字体文件。 |
| [`context-cli.mjs`](context-cli.mjs) | 提供索引检查、同步和逐页叙事复核命令。 |
| [`context.mjs`](context.mjs) | 从已写回源及叙事文档生成页面事实索引，比较逐页复核指纹。 |
| [`export-files.mjs`](export-files.mjs) | 管理导出文件与目录的安全落盘，并为导出嵌入字体资源。 |
| [`export.mjs`](export.mjs) | 从已写回的源按指定范围导出 HTML 或 PDF。 |
| [`new-page.mjs`](new-page.mjs) | 通过命令行创建并登记页面，同步更新叙事索引。 |
| [`outline.mjs`](outline.mjs) | 校验大纲版本，更新分节、页面编排及对应的清单和叙事索引。 |
| [`pdf.mjs`](pdf.mjs) | 调用本机 Chromium 将按序渲染的页面合成为 PDF。 |
| [`seed.mjs`](seed.mjs) | 从内置示例模型生成初始开场页，已有文件会阻止覆盖。 |
| [`serve.mjs`](serve.mjs) | 启动本机工作台服务，提供静态资源及编辑、同步与导出接口。 |
| [`storage.mjs`](storage.mjs) | 提供文件状态读取、原子发布和工作区写锁。 |
| [`storyline.mjs`](storyline.mjs) | 解析叙事表，核对页 ID 和清单顺序。 |
| [`version.mjs`](version.mjs) | 创建、列出和验证具名检查点，并校验当前版本后恢复单页。 |
| [`workspace.mjs`](workspace.mjs) | 加载工作区和页面，管理版本校验、历史备份、写回及编辑请求。 |
| [`workspace.test.mjs`](workspace.test.mjs) | 测试模型、写回、导出、大纲和上下文同步行为。 |

## 维护边界

修改工具后运行 `npm run check` 和 `npm test`，保留版本校验和备份契约。复制、框选或写回流程变更时，另跑 [浏览器回归](../README.md#可选运行浏览器回归开发者)。
