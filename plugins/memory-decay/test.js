// test.js - Memory Decay 测试用例
module.exports = [
  { id: 'md-import', name: '模块导入', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    assert.truthy(typeof MD === 'function', '应为函数');
  }},
  { id: 'md-instance', name: '实例化', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    assert.truthy(md.DecayModel, '应有DecayModel');
    assert.truthy(md.ImportanceLevel, '应有ImportanceLevel');
    assert.truthy(md.contentWeights, '应有contentWeights');
  }},
  { id: 'md-register', name: '记忆注册', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    const m = md.registerMemory({ id: 'm1', content: '测试记忆', type: 'user_preference', importance: 5, created: Date.now() });
    assert.truthy(m.id === 'm1', '应注册成功');
    assert.truthy(m.importance === 5, '重要性应为5');
  }},
  { id: 'md-decay-critical', name: 'CRITICAL不过期', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    md.registerMemory({ id: 'm2', content: '关键信息', type: 'technical_decision', importance: 5, created: Date.now() - 86400000 * 30 });
    const d = md.calculateDecay('m2');
    assert.truthy(d.willBeForgotten === false, 'CRITICAL不应被遗忘');
    assert.truthy(d.currentImportance >= 4.9, `重要性应>=4.9，实际:${d.currentImportance}`);
  }},
  { id: 'md-decay-transient', name: 'TRANSIENT快速衰减', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    md.registerMemory({ id: 'm3', content: '闲聊内容', type: 'casual_chat', importance: 1, created: Date.now() - 86400000 * 3 });
    const d = md.calculateDecay('m3');
    assert.truthy(d.currentImportance < 0.5, `TRANSIENT应快速衰减，实际:${d.currentImportance}`);
    assert.truthy(d.willBeForgotten === true, '应标记为遗忘');
  }},
  { id: 'md-classify', name: '自动分类', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    assert.truthy(md.classifyImportance('test', 'user_preference') === md.ImportanceLevel.HIGH, '用户偏好应为HIGH');
    assert.truthy(md.classifyImportance('test', 'casual_chat') === md.ImportanceLevel.TRANSIENT, '闲聊应为TRANSIENT');
  }},
  { id: 'md-compress', name: '上下文压缩', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    md.registerMemory({ id: 'pref', content: '用户偏好: 喜欢简洁回复', type: 'user_preference', importance: 5, created: Date.now() });
    md.registerMemory({ id: 'chat', content: '今天天气不错', type: 'casual_chat', importance: 1, created: Date.now() - 86400000 * 7 });
    const items = [
      { id: 'pref', content: '用户偏好: 喜欢简洁回复', type: 'user_preference', turnsAgo: 0 },
      { id: 'chat', content: '今天天气不错', type: 'casual_chat', turnsAgo: 50 }
    ];
    const result = md.compressContextBuffer(items, 100);
    assert.truthy(result.kept.length > 0, '应保留一些内容');
    assert.truthy(result.kept.some(i => i.type === 'user_preference'), '应保留用户偏好');
  }},
  { id: 'md-stats', name: '统计', type: 'integration', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    md.registerMemory({ id: 's1', content: 'crit', type: 'user_preference', importance: 5, created: Date.now() });
    md.registerMemory({ id: 's2', content: 'low', type: 'casual_chat', importance: 1, created: Date.now() - 86400000 * 10 });
    const stats = md.getDecayStats();
    assert.truthy(stats.total >= 2, `应有>=2条记忆，实际:${stats.total}`);
  }},
  { id: 'md-health', name: '健康分数', type: 'unit', fn: ({ assert, require }) => {
    const MD = require('memory-decay');
    const md = new MD();
    const score = md.getMemoryHealthScore();
    assert.truthy(score >= 0 && score <= 100, `分数应在0-100，实际:${score}`);
  }}
];
