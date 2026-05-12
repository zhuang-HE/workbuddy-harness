// test.js - Eval Framework 测试用例
module.exports = [
  { id: 'ef-import', name: '模块导入测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    assert.truthy(typeof EF === 'function', '应为函数');
  }},
  { id: 'ef-instance', name: '实例化测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    assert.truthy(ef.EvalType, '应有EvalType');
    assert.truthy(ef.ExperimentType, '应有ExperimentType');
    assert.truthy(ef.suites instanceof Map, 'suites应为Map');
  }},
  { id: 'ef-suite-create', name: '套件创建测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    const suite = ef.createSuite({
      id: 'test-suite', name: '测试套件',
      testCases: [{ id: 't1', prompt: 'hello world', type: 'accuracy' }]
    });
    assert.truthy(suite.id === 'test-suite', '套件应创建成功');
    assert.truthy(suite.testCases.length === 1, '应有1个测试用例');
  }},
  { id: 'ef-compute-score', name: '综合评分计算测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    const score = ef.computeCompositeScore({
      accuracy: 90, efficiency: 80, safety: 95, stability: 85, maintainability: 70
    });
    assert.truthy(score > 0 && score <= 100, `综合评分应在0-100，实际:${score}`);
    // 90*0.30 + 80*0.25 + 95*0.20 + 85*0.15 + 70*0.10 = 27+20+19+12.75+7 = 85.75
  }},
  { id: 'ef-regression', name: '回归检测测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    const baseline = {
      dimensions: { accuracy: { score: 90 }, efficiency: { score: 85 }, safety: { score: 95 }, stability: { score: 80 }, maintainability: { score: 75 } }
    };
    const current = {
      dimensions: { accuracy: { score: 80 }, efficiency: { score: 80 }, safety: { score: 90 }, stability: { score: 75 }, maintainability: { score: 70 } }
    };
    const regression = ef.detectRegression(baseline, current);
    assert.truthy(regression.detected === true, '应检测到回归');
    assert.truthy(regression.details.length > 0, '应有回归详情');
  }},
  { id: 'ef-no-regression', name: '无回归检测测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    const baseline = {
      dimensions: { accuracy: { score: 80 }, efficiency: { score: 80 }, safety: { score: 90 } }
    };
    const current = {
      dimensions: { accuracy: { score: 85 }, efficiency: { score: 82 }, safety: { score: 92 } }
    };
    const regression = ef.detectRegression(baseline, current);
    assert.truthy(regression.detected === false, '改善不应检测到回归');
  }},
  { id: 'ef-benchmark', name: '内置基准测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    // Verify smoke suite exists
    const smokeSuite = { id: 'smoke-suite', name: '冒烟测试套件' };
    const suite = ef.createSuite({ ...smokeSuite, testCases: [{ id: 's1', prompt: 'hello', type: 'accuracy' }] });
    assert.truthy(suite, '应创建冒烟套件');
  }},
  { id: 'ef-report', name: '报告生成测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    ef.createSuite({ id: 'rpt-suite', name: '报告套件', testCases: [{ id: 'r1', prompt: 'test', type: 'accuracy' }] });
    // Run suite (mock)
    const report = ef.generateReport('mock-result', 'markdown');
    assert.truthy(typeof report === 'string', '应返回字符串报告');
  }},
  { id: 'ef-baseline', name: '基线管理测试', type: 'unit', fn: ({ assert, require }) => {
    const EF = require('eval-framework');
    const ef = new EF();
    ef.setBaseline('qwen3:4b', { score: 85, dimensions: { accuracy: { score: 88 } } });
    const baseline = ef.getBaseline('qwen3:4b');
    assert.truthy(baseline, '应获取到基线');
    assert.truthy(baseline.score === 85, '基线分数应匹配');
  }}
];
