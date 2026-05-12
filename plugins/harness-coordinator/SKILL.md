# harness-coordinator 统一协调器

> **版本**: 1.0.0 | **优先级**: P4-12 (P1) | **跨维度**  
> **触发词**: 协调、编排、统一入口、harness coordinator、orchestrate all

## 功能
串联所有11个Harness插件，提供统一任务处理入口和全维度健康报告。

- **processTask(goal)**: 自动走完 D1→D6→D5→D7→D3→D9→D2→D8 8层流水线
- **generateHealthReport()**: 9维度+12插件统一健康报告
- **getOverallMaturity()**: 实时成熟度计算
- **listDimensions()**: 维度清单

## CLI
```bash
node harness-coordinator.js process "创建用户认证系统"
node harness-coordinator.js health
node harness-coordinator.js maturity
```
