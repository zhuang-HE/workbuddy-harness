module.exports = [
  { id: 'mao-import', name: '模块导入', type: 'unit', fn: ({assert, require}) => {
    const MAO = require('multi-agent-orchestrator'); assert.truthy(typeof MAO === 'function', '应为函数');
  }},
  { id: 'mao-instance', name: '实例化', type: 'unit', fn: ({assert, require}) => {
    const MAO = require('multi-agent-orchestrator'); const mao = new MAO();
    assert.truthy(mao.AgentRole, '应有AgentRole'); assert.truthy(mao.JobStatus, '应有JobStatus');
  }},
  { id: 'mao-agent-reg', name: 'Agent注册', type: 'unit', fn: ({assert, require}) => {
    const MAO = require('multi-agent-orchestrator'); const mao = new MAO();
    const a = mao.registerAgent({ id:'a1', name:'Test', role:'executor', capabilities:['code_generation'], model:'test' });
    assert.truthy(a.id === 'a1', '应注册成功');
  }},
  { id: 'mao-team-create', name: '团队创建', type: 'integration', fn: ({assert, require}) => {
    const MAO = require('multi-agent-orchestrator'); const mao = new MAO();
    mao.registerAgent({ id:'lead', name:'Lead', role:'leader', capabilities:['planning'] });
    mao.registerAgent({ id:'dev', name:'Dev', role:'executor', capabilities:['code_generation'] });
    const t = mao.createTeam({ id:'t1', name:'TestTeam', members:[{agentId:'lead',role:'leader'},{agentId:'dev',role:'executor'}] });
    assert.truthy(t.members.length === 2, '应有2个成员');
  }},
  { id: 'mao-find-best', name: '最佳Agent匹配', type: 'unit', fn: ({assert, require}) => {
    const MAO = require('multi-agent-orchestrator'); const mao = new MAO();
    mao.registerAgent({ id:'dev', name:'Dev', role:'executor', capabilities:['code_generation'] });
    const best = mao.findBestAgent({ requiredCapabilities:['code_generation'] }, [{ agentId:'dev', role:'executor', capabilities:['code_generation'], weight:0.8 }]);
    assert.truthy(best && best.id === 'dev', '应选择dev');
  }},
  { id: 'mao-message', name: '消息发送', type: 'unit', fn: ({assert, require}) => {
    const MAO = require('multi-agent-orchestrator'); const mao = new MAO();
    mao.registerAgent({ id:'a1', name:'A1', role:'executor', capabilities:[] });
    mao.registerAgent({ id:'a2', name:'A2', role:'executor', capabilities:[] });
    const r = mao.sendMessage('a1', 'a2', { id:'m1', type:'task_assigned', payload:{jobId:'j1'} });
    assert.truthy(r.delivered === true, '消息应送达');
  }}
];
