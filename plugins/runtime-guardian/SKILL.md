# runtime-guardian 运行时守护者

> **Skill 类型**: 系统插件  
> **版本**: 2.0.0 (引擎集成 + Windows 覆盖)  
> **优先级**: P4-4 (P0)  
> **维度**: D7-Security  
> **创建时间**: 2026-05-12  
> **更新时间**: 2026-05-17  
> **触发词**: 安全扫描、运行时监控、命令检查、异常检测、guardian、security、runtime

## 功能概述
实时工具调用监控，检测 42 种危险命令模式（覆盖 Unix + Windows），文件访问控制（glob 支持），行为异常检测（5 维），持久化告警存储，三模式运行。

## v2.0 新增
- **Windows 危险命令**: format, diskpart, del /F /S, rd /S /Q, reg delete, taskkill, icacls, Set-ExecutionPolicy, net user /add, Remove-Item -Recurse -Force
- **持久化告警**: 告警写入 JSON 文件，进程重启不丢失
- **增强异常检测**: 5 个维度（频率/错误率/拦截率/工具多样性/模式偏离）
- **Glob 路径黑名单**: 支持 `*` 通配符匹配（如 `~/.workbuddy/skills/*/credentials*`）
- **引擎集成**: 通过 `harness guardian` CLI 及 Hook Runner 的 harness action 调用

## 运行模式
| 模式 | 说明 |
|------|------|
| observe | 仅记录日志，不阻断（默认） |
| enforce | 阻断 P0 critical 违规 |
| adaptive | 根据风险动态调整 |

## 检测规则 (42 种)

### P0 极高危 (18 种，立即阻断)
包含原有 11 种 Unix + 新增 7 种 Windows：format, diskpart, del /F /S, rd /S /Q, reg delete HK, shutdown /s, Remove-Item -Recurse -Force

### P1 高危 (16 种，需确认)  
包含原有 12 种 + 新增 4 种：icacls /grant, reg add HK*Run, net user /add, Set-ExecutionPolicy Unrestricted

### P2 中危 (8 种，记录)
包含原有 6 种 + 新增 2 种：taskkill /F, Invoke-Expression

## CLI 命令
```bash
node runtime-guardian/index.js scan "rm -rf /" command     # 扫描命令
node runtime-guardian/index.js scan "/etc/passwd" file     # 检查文件路径
node runtime-guardian/index.js alerts                       # 查看活跃告警
node runtime-guardian/index.js alerts resolve <id>          # 解决告警
node runtime-guardian/index.js mode observe|enforce         # 设置模式
node runtime-guardian/index.js report                       # 生成安全报告
node runtime-guardian/index.js stats                        # 总体统计

# 通过 Harness Engine 调用
node engine/index.js guardian scan "del /F /S /Q C:\\"
node engine/index.js guardian stats
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：12种危险命令、3种运行模式 |
| 2026-05-14 | 1.1.0 | 扩充至29种危险命令 |
| 2026-05-17 | 2.0.0 | Windows覆盖、持久化告警、增强异常检测、引擎集成 |
