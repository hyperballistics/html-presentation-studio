# 本地服务与命令行工具

## 用途

实现工作区读写、演示维护、Agent 交接、上下文及导出。

## 主要内容

[本地服务](serve.mjs)、[工作区读写](workspace.mjs)、[导出入口](export.mjs)、[结构检查](check.mjs)和[测试](workspace.test.mjs)。命令入口见 [package.json](../package.json)。

## 维护边界

修改工具后运行 `npm run check` 和 `npm test`，保留版本校验和备份契约。
