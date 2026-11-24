# 浏览器编辑与审阅工作台

## 用途

提供本地编辑、演示审阅及导出界面。

## 主要内容

离线字体和许可证见[字体资产](fonts/)。

| 文件 | 说明 |
|---|---|
| [`README.md`](README.md) | 索引浏览器工作台的入口、交互模块和字体资源。 |
| [`app.mjs`](app.mjs) | 管理浏览器端编辑、草稿、审阅、写回和导出交互。 |
| [`index.html`](index.html) | 定义工作台界面结构、控件和对话框。 |
| [`model.mjs`](model.mjs) | 定义演示模型、规格与主题，校验内容并生成 HTML 和 PDF 渲染源。 |
| [`selection.mjs`](selection.mjs) | 计算框选、选区边界、批量变换和页面适配。 |
| [`style.css`](style.css) | 定义工具栏、面板、画布、审阅和响应式布局样式。 |

## 维护边界

按[项目说明](../README.md)用 `npm start` 启动，视觉改动遵循[设计标准](../agents/design.md)并进行浏览器验收。
