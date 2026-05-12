module.exports = [
  { id: 'll-import', name: '模块导入', type: 'unit', fn: ({assert,require}) => {
    const LL = require('learning-loop'); assert.truthy(typeof LL === 'function', '应为函数');
  }},
  { id: 'll-instance', name: '实例化', type: 'unit', fn: ({assert,require}) => {
    const LL = require('learning-loop'); const ll = new LL();
    assert.truthy(ll.Phase, '应有Phase'); assert.truthy(ll.Confidence, '应有Confidence');
  }},
  { id: 'll-analyze', name: '会话分析', type: 'unit', fn: ({assert,require}) => {
    const LL = require('learning-loop'); const ll = new LL();
    const r = ll.analyzeSession({ id:'s1', taskType:'coding', complexity:8, toolCalls:12, success:true, duration:300 });
    assert.truthy(r.patterns.length > 0, '应识别出模式');
  }},
  { id: 'll-cycle', name: '学习周期', type: 'integration', fn: ({assert,require}) => {
    const LL = require('learning-loop'); const ll = new LL();
    const r = ll.runLearningCycle({ id:'s2', taskType:'coding', complexity:7, toolCalls:12, success:true, duration:200 });
    assert.truthy(typeof r.cycle === 'number', '应有周期数');
    assert.truthy(typeof r.instinctsExtracted === 'number', '应有本能数');
  }},
  { id: 'll-feedback', name: '反馈记录', type: 'unit', fn: ({assert,require}) => {
    const LL = require('learning-loop'); const ll = new LL();
    ll.runLearningCycle({ id:'s3', taskType:'coding', complexity:6, toolCalls:12, success:true, duration:150 });
    const fb = ll.recordFeedback({ sessionId:'s3', taskType:'coding', reward:5, model:'qwen3:4b-opt' });
    assert.truthy(fb.reward === 5, '奖励应为5');
    assert.truthy(ll.feedbackLoop.totalLearned > 0, '应记录学习');
  }},
  { id: 'll-stats', name: '统计', type: 'unit', fn: ({assert,require}) => {
    const LL = require('learning-loop'); const ll = new LL();
    const stats = ll.getLoopStats();
    assert.truthy(typeof stats.cycles === 'number', '应有周期数');
  }}
];
