// test.js - Context Awareness 测试用例
module.exports = [
  { id: 'ca-import', name: '模块导入测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    assert.truthy(typeof CA === 'function', '应为函数');
  }},
  { id: 'ca-instance', name: '实例化测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    assert.truthy(ca.ContextType, '应有ContextType');
    assert.truthy(ca.context.environment !== undefined, '应有环境上下文');
    assert.truthy(ca.context.project !== undefined, '应有项目上下文');
  }},
  { id: 'ca-scan-all', name: '全维扫描测试', type: 'integration', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    const ctx = ca.scanAll();
    assert.truthy(ctx.environment.os, '应有OS信息');
    assert.truthy(ctx.project.name, '应有项目名');
    assert.truthy(typeof ctx.time.hour === 'number', '应有时数');
    assert.truthy(ctx.time.timeOfDay, '应有时段');
  }},
  { id: 'ca-time', name: '时间感知测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    const time = ca.scanTime();
    assert.truthy(['凌晨', '上午', '下午', '晚上'].includes(time.timeOfDay), `时段应有效，实际:${time.timeOfDay}`);
    assert.truthy(['日', '一', '二', '三', '四', '五', '六'].includes(time.dayOfWeek), '星期应有效');
  }},
  { id: 'ca-enrich', name: '提示词丰富测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    ca.scanAll();
    const enriched = ca.enrichPrompt('写一个排序函数');
    assert.truthy(typeof enriched === 'string', '应返回字符串');
    assert.truthy(enriched.length >= '写一个排序函数'.length, '应丰富提示词');
  }},
  { id: 'ca-strategy', name: '策略推荐测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    const strategy = ca.getRecommendedStrategy();
    assert.truthy(strategy.verbosity, '应有详细度设置');
  }},
  { id: 'ca-suggest', name: '技能建议测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    ca.scanAll();
    const skills = ca.suggestSkills();
    assert.truthy(Array.isArray(skills), '应返回技能数组');
  }},
  { id: 'ca-route', name: '任务路由测试', type: 'unit', fn: ({ assert, require }) => {
    const CA = require('context-awareness');
    const ca = new CA();
    const route = ca.routeTask('code_generation');
    assert.truthy(route.model, '应有推荐模型');
    assert.truthy(route.reason, '应有推荐原因');
  }}
];
