# multi-agent-orchestrator 多Agent编排器

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-3 (P0)  
> **维度**: D9-MultiAgent  
> **创建时间**: 2026-05-12  
> **触发词**: 多Agent、团队协作、任务分配、Agent编排、multi-agent、orchestration

## 功能概述
多Agent团队协作框架，支持5种Agent角色、任务分解分配、依赖管理、结果聚合和通信协议。

## Agent角色
| 角色 | 职责 | 模板 |
|------|------|------|
| Leader | 任务分解与分配 | architect |
| Executor | 执行具体任务 | coder, analyst, tester |
| Reviewer | 审核检查结果 | reviewer |
| Coordinator | 协调冲突 | - |
| Observer | 监控进度 | - |

## 内置团队模板
| 模板 | 成员 | 用途 |
|------|------|------|
| code-team | architect + coder + reviewer | 代码开发 |
| research-team | analyst × 2 + reviewer | 深度研究 |
| qa-team | tester + reviewer | 质量保证 |

## 聚合策略
| 策略 | 说明 |
|------|------|
| merge | 合并所有产出 |
| voting | 投票选最优 |
| pipeline | 串联传递 |
| review_loop | 生成+审核+修改循环 |

## CLI命令
```bash
node multi-agent-orchestrator.js agent list
node multi-agent-orchestrator.js team list
node multi-agent-orchestrator.js team create code-team
node multi-agent-orchestrator.js orchestrate "创建用户API"
node multi-agent-orchestrator.js status <orchId>
node multi-agent-orchestrator.js report <orchId>
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：5种Agent角色、3个团队模板、通信协议 |
