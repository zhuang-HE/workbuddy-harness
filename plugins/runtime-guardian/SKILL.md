# runtime-guardian 运行时守护者

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-4 (P0)  
> **维度**: D7-Security  
> **创建时间**: 2026-05-12  
> **触发词**: 安全扫描、运行时监控、命令检查、异常检测、guardian、security、runtime

## 功能概述
实时工具调用监控，检测12种危险命令模式，文件访问控制，行为异常检测。

## 运行模式
| 模式 | 说明 |
|------|------|
| observe | 仅记录日志，不阻断 |
| enforce | 阻断critical违规 |
| adaptive | 根据风险动态调整 |

## 检测规则（12种）
| 模式 | 等级 |
|------|------|
| rm -rf / | critical |
| curl \| sh | critical |
| mkfs.* | critical |
| dd if= | critical |
| > /dev/sd* | critical |
| wget ... /etc/ | critical |
| :(){ :\|:& };: | critical |
| chmod 777 | warning |
| sudo | warning |
| git push --force | warning |
| npm publish | warning |
| pip install | info |

## 文件访问黑名单
/etc/passwd, /etc/shadow, /etc/sudoers, ~/.ssh/, ~/.aws/, .env, credentials.json, secrets.yaml, id_rsa, *.pem

## CLI命令
```bash
node runtime-guardian.js scan "rm -rf /"
node runtime-guardian.js alerts
node runtime-guardian.js mode observe
node runtime-guardian.js report
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：12种危险命令、3种运行模式、文件访问控制 |
