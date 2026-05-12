# skill-analyzer 技能分析器

> **版本**: 1.0.0 | **优先级**: P4-11 (P2) | **维度**: D3-Skills  
> **触发词**: 技能分析、质量评分、依赖图、死技能、skill analyzer

## 功能
在53+Skills生态基础上，增加质量评分、依赖分析、使用热力图、死技能检测。

- **质量评分(0-100)**: 触发词(20)+描述(10)+版本(5)+参考文档(8)+脚本(5)+文件大小(7)+复杂度(5)+更新时效(10)
- **依赖图谱**: 扫描SKILL.md references字段，构建依赖DAG，检测循环依赖
- **使用热力图**: hot/warm/cold/dead 四级活跃度
- **死技能检测**: 60天未使用自动标记

## CLI
```bash
node skill-analyzer.js scan          # 扫描技能目录
node skill-analyzer.js score         # 质量评分排序
node skill-analyzer.js dead          # 死技能列表
node skill-analyzer.js deps [name]   # 依赖关系
node skill-analyzer.js cycles        # 循环依赖检测
node skill-analyzer.js report        # 完整报告
```
