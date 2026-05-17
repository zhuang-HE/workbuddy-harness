// test.js - Runtime Guardian v2.0 测试用例 (12 tests)
module.exports = [
  // === Original 6 tests (updated) ===
  { id: 'rg-import', name: '模块导入', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); assert.truthy(typeof RG === 'function', '应为函数');
  }},
  { id: 'rg-instance', name: '实例化', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.AlertLevel, '应有AlertLevel'); assert.truthy(rg.Mode, '应有Mode');
    assert.truthy(Array.isArray(rg.DANGEROUS_COMMANDS), '应有DANGEROUS_COMMANDS数组');
    assert.truthy(rg.DANGEROUS_COMMANDS.length >= 40, `应有>=40条规则，实际:${rg.DANGEROUS_COMMANDS.length}`);
  }},
  { id: 'rg-safe-cmd', name: '安全命令', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.scanCommand('ls -la /tmp').safe === true, '安全命令应通过');
  }},
  { id: 'rg-danger-cmd', name: '危险命令拦截', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.scanCommand('rm -rf /').safe === false, '危险命令应拦截');
  }},
  { id: 'rg-file-access', name: '文件访问控制', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.checkFilePath('/tmp/test.txt', 'read').allowed === true, '安全路径应允许');
    assert.truthy(rg.checkFilePath('/etc/passwd', 'read').allowed === false, '黑名单路径应拒绝');
  }},
  { id: 'rg-anomaly', name: '异常检测', type: 'integration', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    rg.startSession('s1');
    for (let i = 0; i < 40; i++) {
      rg.recordCall('s1', { tool:'Read', args:'test', timestamp:Date.now()-1000, duration:100, success:true });
    }
    const a = rg.detectAnomaly('s1');
    assert.truthy(a.anomaly === true, '应检测到高频调用异常');
  }},

  // === New v2.0 tests ===
  { id: 'rg-win-danger', name: 'Windows危险命令', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    const r1 = rg.scanCommand('format C:');
    assert.truthy(r1.safe === false, 'format应拦截');
    const r2 = rg.scanCommand('diskpart');
    assert.truthy(r2.safe === false, 'diskpart应拦截');
    const r3 = rg.scanCommand('del /F /S /Q C:\\Windows');
    assert.truthy(r3.safe === false, 'del /F /S应拦截');
  }},
  { id: 'rg-win-warning', name: 'Windows警告命令', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    const r = rg.scanCommand('Set-ExecutionPolicy Unrestricted');
    assert.truthy(r.safe === true, 'Set-ExecutionPolicy非P0不阻断');
    assert.truthy(r.matches.length > 0, '应匹配到警告');
  }},
  { id: 'rg-persist', name: '持久化告警', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    const alert = rg.raiseAlert({ level: 'critical', type: 'test', message: 'test persist', sessionId: 's99' });
    assert.truthy(alert.id, '应有alert ID');
    const active = rg.getActiveAlerts();
    assert.truthy(active.some(a => a.id === alert.id), '告警应在活跃列表中');
    rg.resolveAlert(alert.id);
    const resolved = rg.getActiveAlerts();
    assert.truthy(!resolved.some(a => a.id === alert.id), '解决后不应在活跃列表');
  }},
  { id: 'rg-modes', name: '三模式切换', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.getMode() === 'observe', '默认observe');
    rg.setMode('enforce');
    assert.truthy(rg.getMode() === 'enforce', '切换到enforce');
    const check = rg.preToolCheck('Bash', 'rm -rf /');
    assert.truthy(check.blocked === true, 'enforce模式应阻断P0');
    assert.truthy(check.safe === false, 'enforce模式P0不安全');
    rg.setMode('observe');
    const check2 = rg.preToolCheck('Bash', 'rm -rf /');
    assert.truthy(check2.blocked === false, 'observe模式不阻断');
  }},
  { id: 'rg-preflight', name: '工具预检', type: 'integration', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    const r1 = rg.preToolCheck('Bash', 'echo hello');
    assert.truthy(r1.safe === true, '安全命令预检通过');
    const r2 = rg.preToolCheck('Write', '/etc/passwd');
    assert.truthy(r2.violations.length > 0, '黑名单路径应有violation');
  }},
  { id: 'rg-stats', name: '统计汇总', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    rg.preToolCheck('Bash', 'rm -rf /');
    const stats = rg.getOverallStats();
    assert.truthy(stats.totalChecks > 0, '应有检查计数');
    assert.truthy(stats.alerts.active > 0, '告警应为活跃');
    assert.truthy(typeof stats.mode === 'string', '应有模式信息');
  }}
];
