#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs');

class RuntimeGuardian {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'runtime-guardian');
    this.mode = options.mode || 'observe';
    this.alerts = [];
    this.activeSessions = new Map();
    this.blockedCount = 0;
    this.totalChecks = 0;
    this.persistPath = path.join(this.configDir, 'alerts-store.json');

    this.AlertLevel = { INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'critical' };
    this.Mode = { OBSERVE: 'observe', ENFORCE: 'enforce', ADAPTIVE: 'adaptive' };

    this._initDangerPatterns();
    this._initBlacklist();
    this._ensureConfigDir();
    this._loadAlerts();
  }

  _initDangerPatterns() {
    this.DANGEROUS_COMMANDS = [
      { pattern: /rm\s+-rf\s+\//, level: 'critical', desc: 'P0 删除根目录 (Unix)', category: '文件系统' },
      { pattern: /rm\s+-rf\s+\/\*/, level: 'critical', desc: 'P0 删除全部文件 (Unix)', category: '文件系统' },
      { pattern: /del\s+\/[FSQ]\s+\/[A-Z]:\\/, level: 'critical', desc: 'P0 强制删除磁盘 (Win)', category: '文件系统' },
      { pattern: /rd\s+\/[SQ]\s+[A-Z]:\\/, level: 'critical', desc: 'P0 递归删除目录树 (Win)', category: '文件系统' },
      { pattern: /format\s+[A-Z]:(?!.*\/\?)/, level: 'critical', desc: 'P0 格式化磁盘 (Win)', category: '文件系统' },
      { pattern: /diskpart/, level: 'critical', desc: 'P0 磁盘分区工具 (Win)', category: '文件系统' },
      { pattern: /curl.*\|.*(ba)?sh/, level: 'critical', desc: 'P0 远程脚本执行 (Unix)', category: '远程执行' },
      { pattern: /wget.*\|.*(ba)?sh/, level: 'critical', desc: 'P0 远程脚本下载执行 (Unix)', category: '远程执行' },
      { pattern: /Invoke-Expression.*curl/, level: 'critical', desc: 'P0 远程脚本执行 (Win)', category: '远程执行' },
      { pattern: /:\(\)\s*\{ :\|:& \};:/, level: 'critical', desc: 'P0 Fork Bomb', category: '资源耗尽' },
      { pattern: /mkfs\./, level: 'critical', desc: 'P0 格式化磁盘 (Unix)', category: '文件系统' },
      { pattern: /dd\s+if=.*of=\/dev\//, level: 'critical', desc: 'P0 磁盘直接写入', category: '文件系统' },
      { pattern: />\s*\/dev\/sd[a-z]/, level: 'critical', desc: 'P0 写入块设备', category: '文件系统' },
      { pattern: /shutdown|init\s+0|halt/, level: 'critical', desc: 'P0 系统关机命令 (Unix)', category: '系统控制' },
      { pattern: /shutdown\s+\/[srf]/, level: 'critical', desc: 'P0 系统关机 (Win)', category: '系统控制' },
      { pattern: /eval\s*\(\s*\$/, level: 'critical', desc: 'P0 动态代码执行', category: '代码注入' },
      { pattern: /exec\s+rm/, level: 'critical', desc: 'P0 强制删除执行', category: '文件系统' },
      { pattern: /reg\s+delete\s+HK/, level: 'critical', desc: 'P0 删除注册表项 (Win)', category: '系统控制' },
      { pattern: /reg\s+add\s+HK.*Run/, level: 'warning', desc: 'P1 添加启动项注册表 (Win)', category: '系统控制' },
      { pattern: /chmod\s+777/, level: 'warning', desc: 'P1 不安全权限设置', category: '权限' },
      { pattern: /sudo\s+/, level: 'warning', desc: 'P1 提权操作', category: '权限' },
      { pattern: /chmod\s+-R\s+777/, level: 'warning', desc: 'P1 递归777权限', category: '权限' },
      { pattern: /icacls.*\/grant.*F/, level: 'warning', desc: 'P1 全权限授予 (Win)', category: '权限' },
      { pattern: /git\s+push\s+--force/, level: 'warning', desc: 'P1 Git强制推送', category: '版本控制' },
      { pattern: /git\s+push\s+-f/, level: 'warning', desc: 'P1 Git快捷强制推送', category: '版本控制' },
      { pattern: /npm\s+publish/, level: 'warning', desc: 'P1 NPM发布', category: '发布' },
      { pattern: /pip\s+install\s+--user/, level: 'warning', desc: 'P1 用户级pip安装', category: '依赖' },
      { pattern: /composer\s+global/, level: 'warning', desc: 'P1 Composer全局安装', category: '依赖' },
      { pattern: />\s*\/etc\//, level: 'warning', desc: 'P1 覆盖系统配置', category: '文件系统' },
      { pattern: /rm\s+rf\s+\./, level: 'warning', desc: 'P1 当前目录递归删除', category: '文件系统' },
      { pattern: /find.*-delete/, level: 'warning', desc: 'P1 find删除操作', category: '文件系统' },
      { pattern: /docker\s+run\s+--privileged/, level: 'warning', desc: 'P1 Docker特权模式', category: '容器' },
      { pattern: /npm\s+i\s+-g/, level: 'info', desc: 'P2 NPM全局安装', category: '依赖' },
      { pattern: /pip\s+install/, level: 'info', desc: 'P2 pip安装包', category: '依赖' },
      { pattern: /kill\s+-9/, level: 'info', desc: 'P2 强制终止进程', category: '进程' },
      { pattern: /taskkill\s+\/[Ff]/, level: 'info', desc: 'P2 强制终止进程 (Win)', category: '进程' },
      { pattern: /pkill/, level: 'info', desc: 'P2 批量终止进程', category: '进程' },
      { pattern: /curl\s+https?:\/\/.*\.(sh|py|rb)/, level: 'info', desc: 'P2 下载脚本', category: '下载' },
      { pattern: /nc\s+-l\s+/, level: 'info', desc: 'P2 网络监听', category: '网络' },
      { pattern: /net\s+user\s+.*\s+\/add/, level: 'warning', desc: 'P1 添加系统用户 (Win)', category: '系统控制' },
      { pattern: /Set-ExecutionPolicy\s+Unrestricted/, level: 'warning', desc: 'P1 放宽执行策略 (Win)', category: '系统控制' },
      { pattern: /Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:/, level: 'critical', desc: 'P0 强制递归删除 (Win)', category: '文件系统' }
    ];
  }

  _initBlacklist() {
    this.BLACKLIST_PATHS = [
      '/etc/passwd', '/etc/shadow', '/etc/sudoers', '/etc/ssh/',
      '~/.ssh/', '~/.aws/', '~/.gnupg/', '~/.config/gh/hosts.yml',
      '.env', 'credentials.json', 'secrets.yaml', 'id_rsa', '*.pem', '*.key',
      '~/.workbuddy/skills/*/credentials*', '~/.workbuddy/tokens*',
      'C:\\Windows\\System32\\config\\', 'C:\\Windows\\registry\\',
      'C:\\Users\\*\\AppData\\Roaming\\CodeBuddy\\*\\tokens*',
      'AppData\\Roaming\\npm\\npmrc'
    ];
  }

  _ensureConfigDir() {
    ['alerts', 'sessions', 'reports'].forEach(sub => {
      const d = path.join(this.configDir, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _persistAlerts() {
    try { fs.writeFileSync(this.persistPath, JSON.stringify(this.alerts, null, 2)); } catch (e) {}
  }

  _loadAlerts() {
    try { if (fs.existsSync(this.persistPath)) this.alerts = JSON.parse(fs.readFileSync(this.persistPath, 'utf8')); }
    catch (e) { this.alerts = []; }
  }

  preToolCheck(toolName, args) {
    this.totalChecks++;
    const violations = [];
    const cmd = typeof args === 'string' ? args : (args?.command || args?.file_path || '');

    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const cmdResult = this.scanCommand(cmd);
      violations.push(...cmdResult.matches.map(m => ({
        type: 'dangerous_command', level: m.level, message: m.desc, matched: m.matched
      })));
    }

    if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
      const fileResult = this.checkFilePath(cmd, toolName.toLowerCase());
      if (!fileResult.allowed) {
        violations.push({ type: 'restricted_path', level: 'warning', message: fileResult.reason, path: cmd });
      }
    }

    const criticals = violations.filter(v => v.level === 'critical');
    const blocked = this.mode === 'enforce' ? criticals.length > 0 : false;

    if (blocked) {
      this.blockedCount++;
      this.raiseAlert({ level: 'critical', type: 'blocked_command', message: `Blocked: ${toolName}`, sessionId: 'system', detail: cmd });
    } else if (violations.length > 0 && this.mode !== 'observe') {
      this.raiseAlert({ level: 'warning', type: 'suspicious_command', message: `Warning: ${toolName}`, sessionId: 'system', detail: cmd });
    }

    return { safe: !blocked, violations, blocked, mode: this.mode };
  }

  scanCommand(command) {
    if (!command) return { safe: true, matches: [] };
    const matches = [];
    for (const rule of this.DANGEROUS_COMMANDS) {
      if (rule.pattern.test(command)) {
        matches.push({ level: rule.level, desc: rule.desc, category: rule.category, matched: command.substring(0, 120) });
      }
    }
    return { safe: matches.filter(m => m.level === 'critical').length === 0, matches };
  }

  checkFilePath(filePath, operation = 'read') {
    if (!filePath) return { allowed: true, reason: '' };
    const checkPath = filePath.replace(/\\/g, '/');
    for (const bp of this.BLACKLIST_PATHS) {
      const clean = bp.replace('~', os.homedir()).replace(/\\/g, '/');
      if (bp.includes('*')) {
        const regex = new RegExp('^' + clean.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        if (regex.test(checkPath)) return { allowed: false, reason: `Path matches blacklist: ${bp}`, operation };
      } else if (checkPath.includes(clean)) {
        return { allowed: false, reason: `Path in blacklist: ${bp}`, operation };
      }
    }
    return { allowed: true, reason: '', operation };
  }

  startSession(sessionId) {
    this.activeSessions.set(sessionId, {
      id: sessionId, calls: [], startedAt: new Date().toISOString(), errorCount: 0, totalCalls: 0, blockedCalls: 0
    });
  }

  recordCall(sessionId, call) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    session.calls.push({ ...call, timestamp: Date.now() });
    session.totalCalls++;
    if (!call.success) session.errorCount++;
    if (call.blocked) session.blockedCalls = (session.blockedCalls || 0) + 1;
    if (session.calls.length > 500) session.calls = session.calls.slice(-500);
  }

  endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) session.endedAt = new Date().toISOString();
    return session;
  }

  getSessionStats(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;
    const tools = {};
    session.calls.forEach(c => { tools[c.tool] = (tools[c.tool] || 0) + 1; });
    return {
      totalCalls: session.totalCalls, uniqueTools: Object.keys(tools).length,
      errorRate: session.totalCalls > 0 ? (session.errorCount / session.totalCalls * 100).toFixed(1) : '0.0',
      blockedRate: session.totalCalls > 0 ? ((session.blockedCalls || 0) / session.totalCalls * 100).toFixed(1) : '0.0',
      tools
    };
  }

  detectAnomaly(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return { anomaly: false, score: 0, details: [] };
    const details = [];
    let score = 0;

    if (session.calls.length > 0) {
      const elapsed = (Date.now() - session.calls[0].timestamp) / 60000;
      const cpm = elapsed > 0 ? session.calls.length / elapsed : 0;
      if (cpm > 30) { details.push({ type: 'rapid_calls', severity: 'critical', cpm: cpm.toFixed(1) }); score += 40; }
      else if (cpm > 20) { details.push({ type: 'rapid_calls', severity: 'warning', cpm: cpm.toFixed(1) }); score += 20; }
    }

    const errorRate = session.totalCalls > 0 ? session.errorCount / session.totalCalls : 0;
    if (errorRate > 0.5) { details.push({ type: 'high_error', severity: 'critical', rate: (errorRate*100).toFixed(0)+'%' }); score += 40; }
    else if (errorRate > 0.3) { details.push({ type: 'high_error', severity: 'warning', rate: (errorRate*100).toFixed(0)+'%' }); score += 20; }

    const blockedRate = session.totalCalls > 0 ? (session.blockedCalls || 0) / session.totalCalls : 0;
    if (blockedRate > 0.2) { details.push({ type: 'high_block_rate', severity: 'warning', rate: (blockedRate*100).toFixed(0)+'%' }); score += 30; }

    const tools = {};
    session.calls.forEach(c => { tools[c.tool] = (tools[c.tool] || 0) + 1; });
    if (session.totalCalls > 20 && Object.keys(tools).length <= 2) {
      details.push({ type: 'low_tool_diversity', severity: 'info', uniqueTools: Object.keys(tools).length }); score += 10;
    }

    return { anomaly: score >= 25, score: Math.min(score, 100), details };
  }

  raiseAlert(alert) {
    const a = { id: this._genId(), level: alert.level || 'info', type: alert.type, message: alert.message, sessionId: alert.sessionId, detail: alert.detail || '', timestamp: new Date().toISOString(), resolved: false };
    this.alerts.push(a);
    this._persistAlerts();
    return a;
  }

  getActiveAlerts() { return this.alerts.filter(a => !a.resolved); }

  resolveAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) { alert.resolved = true; alert.resolvedAt = new Date().toISOString(); }
    this._persistAlerts();
    return alert;
  }

  getAlertStats() {
    const active = this.getActiveAlerts();
    const byLevel = {};
    active.forEach(a => { byLevel[a.level] = (byLevel[a.level] || 0) + 1; });
    const byType = {};
    active.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
    return { total: this.alerts.length, active: active.length, resolved: this.alerts.length - active.length, byLevel, byType };
  }

  generateSecurityReport() {
    const stats = this.getAlertStats();
    let md = '# Runtime Guardian Security Report\n\n';
    md += `**Generated**: ${new Date().toISOString()}\n`;
    md += `**Mode**: ${this.mode} | **Checks**: ${this.totalChecks} | **Blocked**: ${this.blockedCount}\n\n`;
    md += '## Alert Summary\n';
    md += `| Metric | Value |\n|---|---|\n`;
    md += `| Active | ${stats.active} |\n| Resolved | ${stats.resolved} |\n| Total | ${stats.total} |\n`;
    if (stats.active > 0) {
      md += '\n## Active Alerts\n\n| ID | Level | Type | Message |\n|---|---|---|---|\n';
      this.getActiveAlerts().slice(-10).forEach(a => {
        md += `| ${a.id} | ${a.level} | ${a.type} | ${a.message} |\n`;
      });
    }
    return md;
  }

  setMode(mode) {
    if (['observe', 'enforce', 'adaptive'].includes(mode)) { this.mode = mode; return true; }
    return false;
  }

  getMode() { return this.mode; }

  getOverallStats() {
    return {
      totalChecks: this.totalChecks, blockedCount: this.blockedCount,
      mode: this.mode, alerts: this.getAlertStats(), sessions: this.activeSessions.size
    };
  }

  _genId() { return 'rg_' + Math.random().toString(36).substring(2, 10); }
}

if (require.main === module) {
  const rg = new RuntimeGuardian();
  const cmd = process.argv[2];
  const cmds = {
    scan() {
      const target = process.argv[3] || '';
      const type = process.argv[4] || 'command';
      if (type === 'command') {
        const r = rg.scanCommand(target);
        console.log(r.safe ? 'SAFE' : 'DANGER');
        r.matches.forEach(m => console.log(`  [${m.level}] ${m.desc} (${m.category})`));
      } else if (type === 'file') {
        const r = rg.checkFilePath(target, process.argv[5] || 'read');
        console.log(r.allowed ? 'ALLOWED' : `BLOCKED: ${r.reason}`);
      }
    },
    alerts() {
      const sub = process.argv[3];
      if (sub === 'resolve') { rg.resolveAlert(process.argv[4]); console.log('Resolved'); }
      else {
        const active = rg.getActiveAlerts();
        console.log(`Active: ${active.length} / Total: ${rg.alerts.length}`);
        active.forEach(a => console.log(`  [${a.level}] ${a.id}: ${a.message}`));
      }
    },
    mode() { const m = process.argv[3]; if (m) rg.setMode(m); console.log('Mode:', rg.getMode()); },
    report() { console.log(rg.generateSecurityReport()); },
    stats() { console.log(JSON.stringify(rg.getOverallStats(), null, 2)); },
    help() {
      console.log('\nRuntimeGuardian v2.0\n  scan <command> [command|file]  Scan command or file path\n  alerts [resolve <id>]          Manage alerts\n  mode [observe|enforce]         Set security mode\n  report                          Generate report\n  stats                           Overall stats\n  help                            This help\n');
    }
  };
  (cmds[cmd] || cmds.help)();
}

console.log('[RuntimeGuardian] v2.0 loaded');
module.exports = RuntimeGuardian;
