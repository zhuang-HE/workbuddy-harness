# fusion-router 融合智能路由器

> **版本**: 1.0.0 | **优先级**: P4-9 (P2) | **维度**: D6-Integration  
> **触发词**: 融合路由、任务分发、WB/HERMES路由、fusion router

## 功能
基于11个领域规则，自动分析任务描述，智能分发到 WorkBuddy 或 HERMES。

## 路由规则 (11领域)
| 领域 | 路由目标 | 示例 |
|------|---------|------|
| 量化金融 | WorkBuddy | 股票分析、K线、量化策略 |
| 数据分析 | WorkBuddy | Excel、CSV、统计分析 |
| 文档处理 | WorkBuddy | Word、PPT、PDF生成 |
| 代码审查 | WorkBuddy | 安全审计、漏洞检测 |
| 浏览器自动化 | HERMES | 打开网页、截图、爬虫 |
| 文件操作 | HERMES | 批量重命名、备份 |
| 系统管理 | HERMES | 进程管理、服务配置 |
| 大项目 | 协作 | 全栈项目、重构 |

## CLI
```bash
node fusion-router.js test           # 路由测试
node fusion-router.js route "分析股票" # 单任务路由
node fusion-router.js stats          # 分发统计
```
