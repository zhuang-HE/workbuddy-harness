module.exports = [
  { id: 'rg-import', name: '模块导入', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); assert.truthy(typeof RG === 'function', '应为函数');
  }},
  { id: 'rg-instance', name: '实例化', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.AlertLevel, '应有AlertLevel'); assert.truthy(rg.AnomalyType, '应有AnomalyType');
  }},
  { id: 'rg-safe-cmd', name: '安全命令', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.checkCommand('ls -la /tmp').safe === true, '安全命令应通过');
  }},
  { id: 'rg-danger-cmd', name: '危险命令拦截', type: 'unit', fn: ({assert, require}) => {
    const RG = require('runtime-guardian'); const rg = new RG();
    assert.truthy(rg.checkCommand('rm -rf /').safe === false, '危险命令应拦截');
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
  }}
];
