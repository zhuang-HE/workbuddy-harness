# runtime-guardian 运行时守护者

> **Skill 类型**: 系统插件
> **版本**: 1.1.0 (规则扩充)
> **优先级**: P4-4 (P0)
> **维度**: D7-Security
> **创建时间**: 2026-05-12
> **触发词**: 安全扫描、运行时监控、命令检查、异常检测、guardian、security、runtime

## 功能概述
实时工具调用监控，检测29种危险命令模式（12→29），文件访问控制，行为异常检测。

## 运行模式
| 模式 | 说明 |
|------|------|
| observe | 仅记录日志，不阻断 |
| enforce | 阻断critical违规 |
| adaptive | 根据风险动态调整 |

## 检测规则（29种→25目标+超额完成）

### P0 极高危（立即阻断）
| 模式 | 说明 | 分类 |
|------|------|------|
| rm -rf / | 删除根目录 | 文件系统 |
| rm -rf /* | 删除全部文件 | 文件系统 |
| curl ... \| sh | 远程脚本执行 | 远程执行 |
| wget ... \| sh | 远程脚本下载执行 | 远程执行 |
| :(){ :\|:& };: | Fork Bomb | 资源耗尽 |
| mkfs.* | 格式化磁盘 | 文件系统 |
| dd if=...of=/dev/* | 磁盘直接写入 | 文件系统 |
| > /dev/sd* | 写入块设备 | 文件系统 |
| shutdown/init 0/halt | 系统关机命令 | 系统控制 |
| eval $($... | 动态代码执行 | 代码注入 |
| exec rm | 强制删除执行 | 文件系统 |

### P1 高危（需确认）
| 模式 | 说明 | 分类 |
|------|------|------|
| chmod 777 | 不安全权限设置 | 权限 |
| sudo | 提权操作 | 权限 |
| chmod -R 777 | 递归777权限 | 权限 |
| git push --force | Git强制推送 | 版本控制 |
| git push -f | Git快捷强制推送 | 版本控制 |
| npm publish | NPM发布 | 发布 |
| pip install --user | 用户级pip安装 | 依赖 |
| composer global | Composer全局安装 | 依赖 |
| > /etc/* | 覆盖系统配置 | 文件系统 |
| rm -rf ./ | 当前目录递归删除 | 文件系统 |
| find ... -delete | find删除操作 | 文件系统 |
| docker run --privileged | Docker特权模式 | 容器 |

### P2 中危（记录）
| 模式 | 说明 | 分类 |
|------|------|------|
| npm i -g | NPM全局安装 | 依赖 |
| pip install | pip安装包 | 依赖 |
| kill -9 | 强制终止进程 | 进程 |
| pkill | 批量终止进程 | 进程 |
| curl ... .sh/.py/.rb | 下载脚本 | 下载 |
| nc -l | 网络监听 | 网络 |

## 文件访问黑名单
/etc/passwd, /etc/shadow, /etc/sudoers, ~/.ssh/, ~/.aws/, ~/.gnupg/, .env, credentials.json, secrets.yaml, id_rsa, *.pem, C:\Windows\System32\

## CLI命令
```bash
node runtime-guardian.js scan "rm -rf /"
node runtime-guardian.js alerts
node runtime-guardian.js mode observe
node runtime-guardian.js report
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：12种危险命令、3种运行模式、文件访问控制 |
| 2026-05-14 | 1.1.0 | 扩充至29种危险命令：P0×11 + P1×12 + P2×6，新增分类标签 |
