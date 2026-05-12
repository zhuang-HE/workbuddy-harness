# eval-framework 评测框架

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-2 (P0)  
> **维度**: D8-Evaluation  
> **创建时间**: 2026-05-12  
> **触发词**: 评测、评估、基准测试、A/B测试、回归检测、evaluation、benchmark、评分

## 功能概述
五维Agent评测体系，支持基准测试、A/B对比、回归检测和趋势分析。

## 五维评测模型
| 维度 | 权重 | 指标 |
|------|------|------|
| 准确性 | 30% | 任务完成率、关键词匹配 |
| 效率 | 25% | 响应时间、Token效率 |
| 安全性 | 20% | 危险输出检测 |
| 稳定性 | 15% | 结果一致性 |
| 可维护性 | 10% | 输出格式、可读性 |

## 功能列表
| 功能 | 说明 |
|------|------|
| 评测套件 | 内置smoke-suite，可自定义 |
| A/B对比 | 双模型并行评测 |
| 回归检测 | 对比基线检测>5%退化 |
| 趋势分析 | 跟踪性能变化 |

## CLI命令
```bash
node eval-framework.js suite list
node eval-framework.js run smoke-suite
node eval-framework.js ab-test smoke-suite
node eval-framework.js results
node eval-framework.js baseline save
node eval-framework.js report <resultId>
node eval-framework.js stats
```

## 数据存储
```
~/.workbuddy/eval-framework/
├── results/
├── benchmarks/
├── baselines/
└── reports/
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：五维评测、A/B测试、回归检测 |
