// test.js - Task Orchestrator 测试用例
module.exports = [
  { id: 'to-import', name: '模块导入测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    assert.truthy(typeof TO === 'function', '应为函数');
  }},
  { id: 'to-instance', name: '实例化测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    assert.truthy(to.TaskStatus, '应有TaskStatus');
    assert.truthy(to.TaskType, '应有TaskType');
    assert.truthy(to.PipelineType, '应有PipelineType');
  }},
  { id: 'to-register', name: '任务注册测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    const task = to.registerTask({ id: 't1', name: '测试任务', type: 'atomic', dependencies: [] });
    assert.truthy(task.id === 't1', '应注册成功');
    assert.truthy(to.tasks.has('t1'), '应在tasks中');
  }},
  { id: 'to-decompose', name: '目标分解测试', type: 'integration', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    const result = to.decomposeGoal('创建用户认证系统，包含登录注册功能');
    assert.truthy(Array.isArray(result.tasks), '应返回任务数组');
    assert.truthy(result.tasks.length > 1, `应分解为多个子任务，实际:${result.tasks.length}`);
    assert.truthy(result.complexity > 0, '应有复杂度评估');
    assert.truthy(result.graph.length > 0, '应有依赖图');
  }},
  { id: 'to-deps', name: '依赖分析测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    to.registerTask({ id: 'A', name: 'A', dependencies: [] });
    to.registerTask({ id: 'B', name: 'B', dependencies: ['A'] });
    to.registerTask({ id: 'C', name: 'C', dependencies: ['A', 'B'] });
    const graph = to.resolveDependencyGraph(['C']);
    assert.truthy(graph.indexOf('A') < graph.indexOf('B'), 'A应在B前');
    assert.truthy(graph.indexOf('B') < graph.indexOf('C'), 'B应在C前');
  }},
  { id: 'to-cycle', name: '循环依赖检测测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    to.registerTask({ id: 'X', name: 'X', dependencies: ['Y'] });
    to.registerTask({ id: 'Y', name: 'Y', dependencies: ['X'] });
    const cycles = to.detectCycles();
    assert.truthy(cycles.length > 0, '应检测到循环依赖');
  }},
  { id: 'to-parallel', name: '并行组检测测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    to.registerTask({ id: 'P1', name: '并行1', dependencies: [] });
    to.registerTask({ id: 'P2', name: '并行2', dependencies: [] });
    to.registerTask({ id: 'P3', name: '汇总', dependencies: ['P1', 'P2'] });
    const groups = to.getParallelGroups(['P1', 'P2', 'P3']);
    assert.truthy(groups.length >= 1, '应有并行组');
  }},
  { id: 'to-stats', name: '统计测试', type: 'unit', fn: ({ assert, require }) => {
    const TO = require('task-orchestrator');
    const to = new TO();
    to.registerTask({ id: 's1', name: 'S1', type: 'atomic', dependencies: [] });
    to.registerTask({ id: 's2', name: 'S2', type: 'composite', dependencies: ['s1'] });
    const stats = to.getStats();
    assert.truthy(stats.total >= 2, '应有任务统计');
  }}
];
