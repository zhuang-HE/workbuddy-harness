// test.js - Fusion Sync Enhancer 测试用例
module.exports = [
  { id: 'fse-import', name: '模块导入', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    assert.truthy(typeof FSE === 'function', '应为函数');
  }},
  { id: 'fse-instance', name: '实例化', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    assert.truthy(fse.SyncDirection, '应有SyncDirection');
    assert.truthy(fse.ConflictStrategy, '应有ConflictStrategy');
    assert.truthy(fse.conflictResolver, '应有conflictResolver');
  }},
  { id: 'fse-hash', name: '文件哈希', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const h1 = fse._hash('test');
    const h2 = fse._hash('test');
    assert.truthy(h1 === h2, '相同内容应有相同哈希');
    const h3 = fse._hash('different');
    assert.truthy(h1 !== h3, '不同内容应有不同哈希');
  }},
  { id: 'fse-health', name: '健康检查', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const health = fse.checkHealth();
    assert.truthy(typeof health.score === 'number', '应有健康分数');
    assert.truthy(health.score >= 0 && health.score <= 100, `分数应在0-100，实际:${health.score}`);
    assert.truthy(Array.isArray(health.issues), '应有问题列表');
  }},
  { id: 'fse-conflict-newest', name: '冲突解决-最新优先', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const r = fse.conflictResolver.resolve(
      { name: 'test.md', content: 'new', mtime: Date.now() },
      { name: 'test.md', content: 'old', mtime: Date.now() - 10000 },
      'newest'
    );
    assert.truthy(r.resolution.action === 'use_source', '应选择更新版本');
  }},
  { id: 'fse-conflict-wb-wins', name: '冲突解决-WB优先', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const r = fse.conflictResolver.resolve(
      { name: 'test.md', content: 'wb', mtime: Date.now() - 10000 },
      { name: 'test.md', content: 'hm', mtime: Date.now() },
      'wb_wins'
    );
    assert.truthy(r.resolution.action === 'use_source', 'WB优先应选source');
  }},
  { id: 'fse-conflict-hermes-wins', name: '冲突解决-HM优先', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const r = fse.conflictResolver.resolve(
      { name: 'test.md', content: 'wb', mtime: Date.now() },
      { name: 'test.md', content: 'hm', mtime: Date.now() - 10000 },
      'hermes_wins'
    );
    assert.truthy(r.resolution.action === 'use_target', 'HM优先应选target');
  }},
  { id: 'fse-report', name: '报告生成', type: 'unit', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const report = fse.generateReport();
    assert.truthy(typeof report === 'string', '应返回字符串');
    assert.truthy(report.includes('健康报告'), '报告应包含标题');
    assert.truthy(report.includes('健康分数'), '报告应包含分数');
  }},
  { id: 'fse-dryrun', name: '干运行模式', type: 'integration', fn: ({ assert, require }) => {
    const FSE = require('fusion-sync-enhancer');
    const fse = new FSE();
    const report = fse.incrementalSync('wb→hm', { dryRun: true });
    assert.truthy(report.summary, '应有摘要');
    assert.truthy(typeof report.summary.totalOps === 'number', '应有操作计数');
    // Verify no actual files were changed (dry run)
    for (const op of report.operations) {
      assert.truthy(op.type.startsWith('would_'), `干运行操作应以would_开头，实际:${op.type}`);
    }
  }}
];
