# HTML Studio 项目入口

在本包根目录工作，遵循[本包宪法](CONSTITUTION.md)。只使用本包规则与路径，不依赖父项目、模型厂商或全局配置。

| 任务 | 最小读集 |
|---|---|
| 打开、编辑、播放审阅或导出 | [README](README.md) |
| 单对象 Agent 交接 | [协议](agents/protocol.md) → 指定的 `.runtime/requests/<id>.json`；回执已含目标对象，不预读整页或源码 |
| 某页内容或叙事 | [叙事索引](STORYLINE.md) → [清单](deck.manifest.json) → 目标页；仅在需要分节意图时读对应 `section.md` |
| 跨页交接、规格或叙事新鲜度 | [上下文同步](README.md#写回后的-agent-上下文) → 工具栏「同步上下文」或 `npm run context -- check` / `sync` → `.runtime/context/PAGE-FACTS.md`；待复核时只核对相关实体与叙事 |
| 初始化或复用本包 | [复用步骤与模板](README.md#复用于下一个项目)；模板不是当前项目事实 |
| 打包或部署到其他 Harness | [跨 Harness 部署](agents/deployment.md) → 按需读[客户端入口](agents/protocol.md) |
| 构建、分享或配置 Codex Skill | [Skill 索引](skill/README.md) → 对应配置文件；只做发行与校验，不把本机路径写进规则 |
| 主题或结构开发 | 主题先读[设计标准](agents/design.md)；结构先定位 [模型与渲染器](workbench/model.mjs)，再按需求读取调用处 |

- `deck.manifest.json`、`STORYLINE.md` 与 `sections/` 指向当前内容；发行包的初始内容是可运行示例，不是项目规则。`templates/` 仅供初始化，不作为当前索引或任务上下文。
- 页实体内的 `slide-model` 是唯一内容维护源；展示 DOM 由模型渲染，不单独手改。浏览器草稿与导出都不是写回；结构开发前确认没有未处理的草稿，不绕过源版本检查。
- 单对象交接只返回目标对象的 JSON 提案，不自行写回、不执行外部命令、不调用其他 Agent。提案与其他项目的编辑请求不可互换。
- 保持包内默认色板与字体；不引入 CDN、全局插件或云端写回。
- 修改模型、页面或工具后运行 `npm run check` 和 `npm test`；影响 UI/布局时另做浏览器检查。结构、功能与人工视觉验收分别报告。
