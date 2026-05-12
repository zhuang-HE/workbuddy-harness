# task-orchestrator 任务编排器

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-1 (P0)  
> **维度**: D5-Orchestration  
> **创建时间**: 2026-05-12  
> **触发词**: 任务编排、任务分解、依赖管理、流水线、任务调度、orchestrator、task decomposition

## 功能概述
将复杂目标分解为原子任务，管理依赖关系，支持7种工作流模式，实现任务流水线执行。

## 核心功能
| 功能 | 说明 |
|------|------|
| 目标分解 | NLP关键词 + 模板匹配，自动识别任务类型 |
| 依赖管理 | DAG构建、拓扑排序、循环检测 |
| 并行分析 | 识别可并行执行的子任务组 |
| 关键路径 | 计算项目最长依赖链 |
| 流水线执行 | 串行/并行/扇出/扇入/条件/重试 |
| 进度追踪 | 实时状态、完成率 |

## 内置任务模板
| 模板 | 子任务 |
|------|--------|
| code-implementation | 需求分析 → 代码实现 → 测试验证 → 文档更新 |
| data-analysis | 数据收集 → 数据清洗 → 分析计算 → 报告生成 |
| deployment | 环境检查 → 构建打包 → 部署执行 → 健康检查 |
| bug-fix | 问题复现 → 根因分析 → 修复实施 → 回归测试 |

## 工作流模式
| 模式 | 说明 |
|------|------|
| SEQUENTIAL | A → B → C 串行 |
| PARALLEL | A, B, C 同时执行 |
| FAN_OUT | A → [B, C, D] |
| FAN_IN | [A, B, C] → D |
| MAP_REDUCE | 并行处理后汇总 |
| CONDITIONAL | 条件分支 |
| RETRY | 失败重试 |

## CLI命令
```bash
node task-orchestrator.js decompose "创建用户认证系统"
node task-orchestrator.js task list
node task-orchestrator.js execute my-plan
node task-orchestrator.js status <execId>
node task-orchestrator.js report <execId>
node task-orchestrator.js visualize <execId>
node task-orchestrator.js stats
```

## 数据存储
```
~/.workbuddy/task-orchestrator/
├── tasks/
├── executions/
├── pipelines/
└── reports/
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：目标分解、依赖图、7种工作流 |
