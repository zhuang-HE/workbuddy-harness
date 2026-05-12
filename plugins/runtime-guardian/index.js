/**
 * runtime-guardian - P4-4 (P0) 运行时守护者
 * 维度: D7-Security
 * 命令安全检查、文件访问控制、行为异常检测
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

class RuntimeGuardian {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'runtime-guardian');
    this.rules = [];
    this.alerts = [];
    this.activeSessions = new Map();
    this.mode = options.mode || 'observe';
    
    this.AlertLevel = { INFO:'info', WARNING:'warning', ERROR:'error', CRITICAL:'critical' };
    this.AnomalyType = {
      RAPID_CALLS:'rapid_calls', SUSPICIOUS_PATTERN:'suspicious_pattern',
      PRIVILEGE_ESCALATION:'privilege_escalation', RESOURCE_ABUSE:'resource_abuse', PATTERN_DEVIATION:'pattern_deviation'
    };
    this.Mode = { OBSERVE:'observe', ENFORCE:'enforce', ADAPTIVE:'adaptive' };
    
    this.DANGEROUS_COMMANDS = [
      { pattern: /rm\s+-rf\s+\//, level: 'critical', desc: '删除根目录' },
      { pattern: /curl.*\|.*(ba)?sh/, level: 'critical', desc: '远程脚本执行' },
      { pattern: /mkfs\./, level: 'critical', desc: '格式化磁盘' },
      { pattern: /dd\s+if=/, level: 'critical', desc: '磁盘操作' },
      { pattern: /chmod\s+777/, level: 'warning', desc: '不安全权限' },
      { pattern: /:\(\)\s*\{ :\|:& \};:/, level: 'critical', desc: 'Fork Bomb' },
      { pattern: /sudo\s+/, level: 'warning', desc: '提权操作' },
      { pattern: /git\s+push\s+--force/, level: 'warning', desc: '强制推送' },
      { pattern: /npm\s+publish/, level: 'warning', desc: 'NPM发布' },
      { pattern: />\s*\/dev\/sd[a-z]/, level: 'critical', desc: '写入块设备' },
      { pattern: /wget.*-O.*\/etc\//, level: 'critical', desc: '覆盖系统配置' },
      { pattern: /pip\s+install/, level: 'info', desc: 'Pip安装' }
    ];
    
    this.BLACKLIST_PATHS = [
      '/etc/passwd', '/etc/shadow', '/etc/sudoers',
      '~/.ssh/', '~/.aws/', '~/.gnupg/',
      '.env', 'credentials.json', 'secrets.yaml', 'id_rsa', '*.pem',
      'C:\\Windows\\System32\\', 'C:\\Windows\\registry\\'
    ];
    
    this._ensureConfigDir();
  }

  preToolCheck(toolName, args) {
    const violations = [];
    
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const cmd = typeof args === 'string' ? args : (args?.command || '');
      const cmdResult = this.checkCommand(cmd);
      if (!cmdResult.safe) {
        violations.push(...cmdResult.matches.map(m => ({
          type: 'dangerous_command', level: m.level, message: m.desc, matched: m.matched
        })));
      }
    }
    
    if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
      const filePath = typeof args === 'string' ? args : (args?.file_path || '');
      const fileResult = this.checkFilePath(filePath, toolName.toLowerCase());
      if (!fileResult.allowed) {
        violations.push({ type: 'restricted_path', level: 'warning', message: fileResult.reason, path: filePath });
      }
    }
    
    const criticals = violations.filter(v => v.level === 'critical');
    const safe = this.mode === 'enforce' ? criticals.length === 0 : true;
    
    return {
      safe,
      violations,
      requiresConfirmation: violations.length > 0 && this.mode !== 'observe'
    };
  }

  checkCommand(command) {
    if (!command) return { safe: true, matches: [] };
    const matches = [];
    
    for (const rule of this.DANGEROUS_COMMANDS) {
      const matched = rule.pattern.test(command);
      if (matched) {
        matches.push({
          level: rule.level,
          desc: rule.desc,
          matched: command.substring(0, 100)
        });
      }
    }
    
    return { safe: matches.filter(m => m.level === 'critical').length === 0, matches };
  }

  checkFilePath(filePath, operation = 'read') {
    if (!filePath) return { allowed: true, reason: '' };
    
    for (const bp of this.BLACKLIST_PATHS) {
      const clean = bp.replace('~', os.homedir()).replace(/\\/g, '/');
      const checkPath = filePath.replace(/\\/g, '/');
      if (checkPath.includes(clean) || (bp.includes('*') && checkPath.match(new RegExp(clean.replace(/\*/g, '.*'))))) {
        return { allowed: false, reason: `路径在黑名单中: ${bp}`, operation };
      }
    }
    
    return { allowed: true, reason: '', operation };
  }

  startSession(sessionId) {
    this.activeSessions.set(sessionId, {
      id: sessionId, calls: [], startedAt: this._timestamp(), errorCount: 0, totalCalls: 0
    });
  }

  recordCall(sessionId, call) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    session.calls.push({ ...call, timestamp: Date.now() });
    session.totalCalls++;
    if (!call.success) session.errorCount++;
    if (session.calls.length > 200) session.calls = session.calls.slice(-200);
  }

  endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) session.endedAt = this._timestamp();
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
      tools
    };
  }

  detectAnomaly(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return { anomaly: false, score: 0, details: [] };
    
    const details = [];
    let score = 0;
    const callsPerMinute = session.calls.length > 0 ? session.calls.length / Math.max((Date.now() - session.calls[0].timestamp) / 60000, 1) : 0;
    
    if (callsPerMinute > 30) { details.push({ type: 'rapid_calls', severity: 'warning', value: callsPerMinute.toFixed(1) }); score += 30; }
    else if (callsPerMinute > 20) { score += 15; }
    
    const errorRate = session.totalCalls > 0 ? session.errorCount / session.totalCalls : 0;
    if (errorRate > 0.5) { details.push({ type: 'high_error', severity: 'critical', value: (errorRate*100).toFixed(0)+'%' }); score += 40; }
    else if (errorRate > 0.3) { score += 20; }
    
    return { anomaly: score >= 25, score: Math.min(score, 100), details };
  }

  raiseAlert(alert) {
    const a = { id: this._generateId(), level: alert.level || 'info', type: alert.type, message: alert.message, sessionId: alert.sessionId, timestamp: this._timestamp(), resolved: false };
    this.alerts.push(a);
    return a;
  }

  getActiveAlerts() { return this.alerts.filter(a => !a.resolved); }
  resolveAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) alert.resolved = true;
    return alert;
  }

  getAlertStats() {
    const active = this.getActiveAlerts();
    const byLevel = {};
    active.forEach(a => { byLevel[a.level] = (byLevel[a.level] || 0) + 1; });
    return { total: active.length, byLevel };
  }

  generateSecurityReport() {
    let report = '# 运行时安全报告\n\n';
    const stats = this.getAlertStats();
    report += `## 告警统计\n- 活跃告警: ${stats.total}\n`;
    for (const [level, count] of Object.entries(stats.byLevel)) {
      report += `- ${level}: ${count}\n`;
    }
    report += `\n## 会话统计\n`;
    for (const [id, session] of this.activeSessions) {
      report += `- ${id}: ${session.totalCalls} 次调用, 错误率 ${session.totalCalls > 0 ? (session.errorCount/session.totalCalls*100).toFixed(1) : 0}%\n`;
    }
    return report;
  }

  setMode(mode) {
    if (['observe', 'enforce', 'adaptive'].includes(mode)) { this.mode = mode; return true; }
    return false;
  }

  getMode() { return this.mode; }

  _ensureConfigDir() {
    ['alerts', 'sessions', 'rules'].forEach(sub => {
      const d = path.join(this.configDir, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString().replace('T',' ').substring(0,19); }
}

// CLI
if (require.main === module) {
  const rg = new RuntimeGuardian();
  const cmd = process.argv[2];
  const cmdMap = {
    scan() {
      const sub = process.argv[3] || 'command';
      const arg = process.argv.slice(4).join(' ');
      if (sub === 'command' && arg) {
        const r = rg.checkCommand(arg);
        console.log(r.safe ? '✅ 安全' : '❌ 危险');
        r.matches.forEach(m => console.log(`  [${m.level}] ${m.desc}`));
      }
    },
    alerts() {
      const active = rg.getActiveAlerts();
      console.log(`活跃告警: ${active.length}`);
      active.forEach(a => console.log(`  [${a.level}] ${a.message}`));
    },
    mode() {
      const sub = process.argv[3];
      if (sub) { rg.setMode(sub); }
      console.log('当前模式:', rg.getMode());
    },
    report() { console.log(rg.generateReport()); },
    help() { console.log('RuntimeGuardian CLI\n命令: scan, alerts, mode, report, help'); }
  };
  (cmdMap[cmd] || cmdMap.help)();
}

console.log('[RuntimeGuardian] 加载成功 - P4-4 运行时守护者');

module.exports = RuntimeGuardian;
module.exports.default = RuntimeGuardian;
