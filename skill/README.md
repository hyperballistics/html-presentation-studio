# HTML Studio Skill 配置

本目录维护把 HTML Studio 发行包包装成可复用 Codex Skill 的规则。它不是运行时代码，也不是当前演示内容；只有构建、分享或配置 Skill 时才读取。

如果只是把工作区交给另一个 Harness 运行，不需要构建或安装 Skill；使用 [跨 Harness 部署](../agents/deployment.md)。

## 文件职责

| 文件 | 作用 | 读取时机 |
|---|---|---|
| [`SKILL.template.md`](SKILL.template.md) | 第一层入口：触发边界、核心不变量和任务路由 | 构建 Skill 时复制并改名为 `SKILL.md` |
| [`openai.template.yaml`](openai.template.yaml) | Codex UI 元数据与自动/显式调用策略 | 构建 Skill 时复制并改名为 `agents/openai.yaml` |
| [`SHARING.template.md`](SHARING.template.md) | Skill 配置、调用、渐进披露、打包与验收规则 | 维护或分享 Skill 本身时 |
| [`references/new-workspace.template.md`](references/new-workspace.template.md) | 从模板创建任务自有工作区 | 只有新工作区任务触发 |
| [`references/operations.template.md`](references/operations.template.md) | 命令与故障处理补充 | 目标工作区自身文档不足时 |
| [`references/verification.template.md`](references/verification.template.md) | 浏览器与导出视觉验收 | UI、布局或导出需要人工/浏览器检查时 |

## 构建原则

1. **模板化**：配置只写相对路径、通用占位符和契约，不写本机路径、当前项目名、会话状态或运行记录。
2. **渐进披露**：`SKILL.md` 保持短小；细节放到 `references/`，并按任务类型逐个读取。
3. **发行物为资产**：HTML Studio 发行文件放在 Skill 的 `assets/` 下，作为可复制模板，不作为自动加载上下文。
4. **目标工作区自治**：Skill 只负责路由和初始化；编辑、导出和写回遵循目标工作区自己的 `AGENTS.md` 与协议。
5. **单写者**：不要在维护源内运行或编辑用户的演示内容；先复制到任务自有目录。

## 构建流程

```text
html-presentation-studio/
├── SKILL.md
├── SHARING.md
├── agents/openai.yaml
├── references/*.md
└── assets/html-presentation-studio-template/
```

1. 创建上述目录。
2. 将本目录中的模板文件复制到对应位置并去掉 `.template` 后缀。
3. 从干净的 HTML Studio 发行文件生成 `assets/html-presentation-studio-template/`。排除 `.runtime/`、`.agent-state/`、`dist/`、`.DS_Store`、导出件和本机状态。
4. 保留字体与许可证；保留 `templates/` 初始化样板；保留工具与工作台源码。
5. 校验 Skill frontmatter、`openai.yaml` 和相对路径。
6. 复制 `assets/` 模板到临时目录，运行 `npm run check` 和 `npm test`。
7. 涉及 UI 改动或视觉交付时，启动本地服务并按目标任务的验收要求检查浏览器渲染。

## 推荐验收

- Skill 配置校验：frontmatter 有唯一 `name`、有效 `description`，无未替换占位符。
- 调用策略：`allow_implicit_invocation: true`，且支持 `$html-presentation-studio` 显式调用。
- 模板自测：临时副本通过 `npm run check` 与 `npm test`。
- 可移植性：配置和分享文档不含用户主目录、机器名、本机端口承诺、私有项目名或本地会话 ID。
- 分层报告：配置校验、结构/功能测试、浏览器视觉检查、人工视觉验收分别记录。
