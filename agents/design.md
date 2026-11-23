# 默认设计

下列色板、字体及其用途是包内默认规范，不绑定某个示例的版式或内容。复用时只以包内主题值和字体资产为准，无需访问父工作区或外部设计稿。

- 页外 `#F2F3F5`；白色内容画布 `#FFFFFF`；主标题 `#111111`，正文 `#1A1A1A`、导语 `#5C6066`，小标题 `#0B2545`。
- 品牌蓝 `#065FA9`；红 `#AE0D1B` 只作重点/页标。组件文字 `#173B59`、边界 `#C9DDEB`；浅蓝卡片 `#F2F7FB`、强调带 `#DCEBF8`。
- CSS 把 **Source Sans 3** 放在 **思源黑体 SC（Source Han Sans SC）** 前面，让拉丁字母和数字先命中前者、简体中文落到后者。模板默认使用混排，不用等宽替代英文字体。用 400/700 建立层次。本包只附正常字形，斜体由浏览器合成。
- 设计值在 `workbench/model.mjs` 的 `THEME`，工作台操作界面在 `workbench/style.css` 采用相同角色。新增模板优先用主题值，区域靠留白、层次与少量分隔区分，不重复描边。

## 字体分发

字体为 Adobe 发布的开放字体，未做修改。`workbench/fonts/` 各自保留版权及 SIL OFL 1.1 许可；如替换字体，应同时替换许可证并更新校验清单。上游：[Source Han Sans](https://github.com/adobe-fonts/source-han-sans)、[Source Sans](https://github.com/adobe-fonts/source-sans)。

| 文件 | SHA-256 |
|---|---|
| `SourceHanSansSC-VF.ttf.woff2` | `cfec773cdc2ea964de8713471c6fd20774bc40617f5567f92efeeccaca6604b0` |
| `SourceSans3VF-Upright.ttf.woff2` | `5f16566f7a40d39b339ad26be151fa5a1ab1f0c2574c7a2e619765584a1acbd8` |

实体 HTML 用包内相对路径加载字体；导出的单文件把字体和许可证内嵌，约 19 MB，不访问 CDN。
