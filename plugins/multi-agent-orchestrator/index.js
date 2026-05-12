/**
 * multi-agent-orchestrator - P4-3 (P0) 多Agent编排器
 * 维度: D9-MultiAgent
 * Agent团队管理、任务分配、依赖管理、结果聚合
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// ============================================================================
// Agent Process Manager (IPC) - must be defined before MultiAgentOrchestrator
// ============================================================================
class AgentProcessManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.processes = new Map();
    this.maxProcesses = 4;
  }
  spawnAgent(agentId, task) {
    const agent = this.orchestrator.agents.get(agentId);
    if (!agent) return Promise.resolve({ success: false, error: 'Agent not found' });
    if (this.processes.size >= this.maxProcesses) return Promise.resolve({ success: false, error: 'Max processes reached' });
    const child = spawn('node', ['-e', `const s=Date.now();try{process.stdout.write(JSON.stringify({agentId:'${agentId}',taskId:'${task.id||'unknown'}',status:'completed',output:'Task by ${agent.name}',duration:Date.now()-s}));}catch(e){process.stdout.write(JSON.stringify({agentId:'${agentId}',taskId:'${task.id||'unknown'}',status:'failed',error:e.message,duration:Date.now()-s}));}`], { timeout: task.timeoutMs || 60000 });
    const pid = 'proc_' + child.pid + '_' + Date.now();
    this.processes.set(pid, { pid, agentId, taskId: task.id, process: child, startTime: Date.now(), status: 'running', result: null });
    return new Promise((resolve) => {
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('close', (code) => {
        const p = this.processes.get(pid);
        if (p) { p.status = code === 0 ? 'completed' : 'failed'; try { p.result = JSON.parse(out.trim()); } catch(e) { p.result = { raw: out }; } }
        resolve({ success: code === 0, pid, agentId, taskId: task.id, result: p?.result });
      });
      child.on('error', (e) => {
        const p = this.processes.get(pid);
        if (p) { p.status = 'error'; p.result = { error: e.message }; }
        resolve({ success: false, pid, error: e.message });
      });
    });
  }
  async executeBatch(tasks, agentIds) {
    const results = [];
    const pending = [];
    for (let i = 0; i < tasks.length; i++) {
      const aid = agentIds[i % agentIds.length];
      pending.push(this.spawnAgent(aid, tasks[i]));
      if (pending.length >= this.maxProcesses || i === tasks.length - 1) {
        const batch = await Promise.allSettled(pending);
        results.push(...batch.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message }));
        pending.length = 0;
      }
    }
    return { total: tasks.length, completed: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
  }
  killAll() { let c = 0; for (const [pid, p] of this.processes) { try { p.process.kill(); c++; } catch(e) {} } this.processes.clear(); return { killed: c }; }
  getStatus() { const st = []; for (const [pid, p] of this.processes) { st.push({ pid, agentId: p.agentId, taskId: p.taskId, status: p.status, runtime: Date.now() - p.startTime }); } return { active: this.processes.size, max: this.maxProcesses, processes: st }; }
}

class MultiAgentOrchestrator {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'multi-agent-orchestrator');
    this.agents = new Map();
    this.teams = new Map();
    this.jobs = new Map();
    this.orchSessions = new Map();
    this.processManager = new AgentProcessManager(this);
    this.messageQueue = new Map();
    
    this.AgentRole = {
      LEADER: 'leader', EXECUTOR: 'executor',
      REVIEWER: 'reviewer', COORDINATOR: 'coordinator', OBSERVER: 'observer'
    };
    
    this.AgentCapability = {
      CODE: 'code_generation', ANALYSIS: 'data_analysis',
      WRITING: 'content_writing', RESEARCH: 'research',
      TESTING: 'testing', SECURITY: 'security_audit',
      PLANNING: 'planning', DOCUMENTATION: 'documentation'
    };
    
    this.JobStatus = {
      QUEUED: 'queued', ASSIGNED: 'assigned', IN_PROGRESS: 'in_progress',
      REVIEW: 'review', COMPLETED: 'completed', FAILED: 'failed'
    };
    
    this.CommProtocol = {
      DIRECT: 'direct', BROADCAST: 'broadcast',
      REVIEW_REQUEST: 'request_review', HANDOFF: 'handoff'
    };
    
    this.AGENT_TEMPLATES = {
      'architect': { role: 'leader', capabilities: ['planning', 'system_design'], model: 'qwen3:4b-opt', maxConcurrency: 1 },
      'coder': { role: 'executor', capabilities: ['code_generation', 'debugging'], model: 'qwen2.5:1.5b', maxConcurrency: 2 },
      'reviewer': { role: 'reviewer', capabilities: ['code_review', 'security_audit'], model: 'qwen3:4b-opt', maxConcurrency: 3 },
      'analyst': { role: 'executor', capabilities: ['data_analysis', 'research'], model: 'qwen3:4b-opt', maxConcurrency: 2 },
      'tester': { role: 'executor', capabilities: ['testing', 'documentation'], model: 'qwen2.5:1.5b', maxConcurrency: 2 }
    };
    
    this.AGENT_TEMPLATES = {
      'architect': { name: '架构师', role: 'leader', capabilities: ['planning', 'system_design'], specialization: '系统架构设计和任务分解' },
      'coder': { name: '开发工程师', role: 'executor', capabilities: ['code_generation', 'debugging'], specialization: '代码实现和调试' },
      'reviewer': { name: '审查员', role: 'reviewer', capabilities: ['code_review', 'security_audit'], specialization: '代码质量和安全审查' },
      'analyst': { name: '分析师', role: 'executor', capabilities: ['data_analysis', 'research'], specialization: '数据分析和深度研究' },
      'tester': { name: '测试工程师', role: 'executor', capabilities: ['testing', 'documentation'], specialization: '测试验证和文档编写' },
      'devops': { name: 'DevOps工程师', role: 'executor', capabilities: ['deployment', 'monitoring'], specialization: '部署运维和基础设施' },
      'designer': { name: '设计师', role: 'executor', capabilities: ['ui_design', 'ux_research'], specialization: '界面设计和用户体验' }
    };

    this.TEAM_TEMPLATES = {
      'code-team': { name: '代码开发团队', members: [{ agentId: 'architect', role: 'leader' }, { agentId: 'coder', role: 'executor' }, { agentId: 'reviewer', role: 'reviewer' }], reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.85 } },
      'research-team': { name: '深度研究团队', members: [{ agentId: 'analyst', role: 'executor' }, { agentId: 'analyst', role: 'executor' }, { agentId: 'reviewer', role: 'reviewer' }], reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.80 } },
      'qa-team': { name: '质量保障团队', members: [{ agentId: 'tester', role: 'executor' }, { agentId: 'reviewer', role: 'reviewer' }], reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.75 } },
      'fullstack-team': { name: '全栈开发团队', members: [{ agentId: 'architect', role: 'leader' }, { agentId: 'coder', role: 'executor' }, { agentId: 'coder', role: 'executor' }, { agentId: 'reviewer', role: 'reviewer' }, { agentId: 'tester', role: 'executor' }], reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.85 } },
      'security-team': { name: '安全审计团队', members: [{ agentId: 'reviewer', role: 'reviewer' }, { agentId: 'reviewer', role: 'reviewer' }, { agentId: 'architect', role: 'leader' }], reviewPolicy: { requiredReviewers: 2, autoApproveThreshold: 0.95, maxRevisionRounds: 5 } },
      'devops-team': { name: 'DevOps团队', members: [{ agentId: 'devops', role: 'executor' }, { agentId: 'tester', role: 'executor' }, { agentId: 'reviewer', role: 'reviewer' }], reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.90 } },
      'design-team': { name: '设计开发团队', members: [{ agentId: 'designer', role: 'executor' }, { agentId: 'coder', role: 'executor' }, { agentId: 'reviewer', role: 'reviewer' }], reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.80 } },
      'solo-review': { name: '单人审查模式', members: [{ agentId: 'reviewer', role: 'reviewer' }], reviewPolicy: { requiredReviewers: 0, autoApproveThreshold: 0.70 } }
    };
    
    this._ensureConfigDir();
  }

  registerAgent(agentDef) {
    const agent = {
      id: agentDef.id || this._generateId(),
      name: agentDef.name, role: agentDef.role || 'executor',
      capabilities: agentDef.capabilities || [],
      model: agentDef.model || 'default', skills: agentDef.skills || [],
      maxConcurrency: agentDef.maxConcurrency || 2, specialization: agentDef.specialization || '',
      status: 'idle', load: 0, registeredAt: this._timestamp()
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  unregisterAgent(agentId) { return this.agents.delete(agentId); }
  getAgent(agentId) { return this.agents.get(agentId) || null; }

  listAgents(filter = {}) {
    let agents = Array.from(this.agents.values());
    if (filter.role) agents = agents.filter(a => a.role === filter.role);
    if (filter.status) agents = agents.filter(a => a.status === filter.status);
    return agents;
  }

  updateAgentStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (agent) { agent.status = status; return agent; }
    return null;
  }

  createTeam(teamDef) {
    const team = {
      id: teamDef.id || this._generateId(),
      name: teamDef.name || 'unnamed',
      members: teamDef.members || [],
      routingRules: teamDef.routingRules || [],
      reviewPolicy: teamDef.reviewPolicy || { requiredReviewers: 1, autoApproveThreshold: 0.9, maxRevisionRounds: 3 },
      communicationMode: teamDef.communicationMode || 'direct',
      created: this._timestamp()
    };
    this.teams.set(team.id, team);
    return team;
  }

  disbandTeam(teamId) { return this.teams.delete(teamId); }

  addMember(teamId, agentDef) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    team.members.push({ agentId: agentDef.agentId || agentDef.id, role: agentDef.role || 'executor', weight: agentDef.weight || 0.5 });
    return team;
  }

  removeMember(teamId, agentId) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    team.members = team.members.filter(m => m.agentId !== agentId);
    return team;
  }

  getTeam(teamId) { return this.teams.get(teamId) || null; }

  decomposeAndAssign(goal, teamId) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    
    const orchId = this._generateId();
    const tasks = [];
    const keywords = ['分析', '实现', '测试', '文档', '审查', '部署'];
    let taskCount = 0;
    for (const kw of keywords) {
      if (goal.includes(kw) || taskCount < 3) {
        tasks.push({
          id: this._generateId(),
          name: `${goal.substring(0, 30)} - ${kw}`,
          status: 'queued',
          dependencies: taskCount > 0 ? [tasks[taskCount-1].id] : [],
          requiredCapabilities: [kw === '实现' ? 'code_generation' : kw === '测试' ? 'testing' : kw === '审查' ? 'code_review' : 'planning']
        });
        taskCount++;
      }
    }
    
    const session = {
      id: orchId, teamId, goal, tasks,
      status: 'active', started: this._timestamp(),
      completedTasks: [], failedTasks: []
    };
    
    this.orchSessions.set(orchId, session);
    return { orchId, tasks, team };
  }

  assignJob(jobId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const job = { id: jobId, assignedTo: agentId, status: 'assigned', assignedAt: this._timestamp() };
    this.jobs.set(jobId, job);
    agent.load++;
    return job;
  }

  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    return job ? job.status : 'unknown';
  }

  findBestAgent(task, members) {
    let best = null, bestScore = -1;
    for (const member of members) {
      const agent = this.agents.get(member.agentId);
      if (!agent || agent.status === 'busy') continue;
      let score = 0;
      for (const cap of (task.requiredCapabilities || [])) {
        if (agent.capabilities.includes(cap)) score += 10;
      }
      score -= agent.load * 5;
      if (score > bestScore) { bestScore = score; best = agent; }
    }
    return best;
  }

  balanceLoad(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return [];
    const reassignments = [];
    const loads = team.members.map(m => ({ agentId: m.agentId, load: this.agents.get(m.agentId)?.load || 0 }));
    for (let i = 0; i < loads.length; i++) {
      for (let j = i+1; j < loads.length; j++) {
        if (loads[i].load - loads[j].load > 2) {
          reassignments.push({ from: loads[i].agentId, to: loads[j].agentId, reason: 'load balancing' });
        }
      }
    }
    return reassignments;
  }

  buildDependencyGraph(tasks) {
    const graph = new Map();
    for (const task of tasks) {
      graph.set(task.id, { ...task, dependents: [] });
    }
    for (const task of tasks) {
      for (const dep of (task.dependencies || [])) {
        const depNode = graph.get(dep);
        if (depNode) depNode.dependents.push(task.id);
      }
    }
    return graph;
  }

  resolveDependencies(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    return job.status === 'completed' || job.status === 'failed';
  }

  getReadyJobs(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return [];
    const completed = new Set(session.completedTasks || []);
    return session.tasks.filter(t => t.status === 'queued' && (t.dependencies || []).every(d => completed.has(d)));
  }

  collectResults(jobIds) {
    return jobIds.map(id => ({ jobId: id, status: this.jobs.get(id)?.status || 'unknown' }));
  }

  aggregateOutputs(results, strategy = 'merge') {
    switch (strategy) {
      case 'merge': return { strategy, results, output: results.map(r => r.status).join(', ') };
      case 'voting': return { strategy, winner: results[0]?.status || 'none' };
      default: return { strategy, results };
    }
  }

  sendMessage(fromId, toId, message) {
    if (!this.messageQueue.has(toId)) this.messageQueue.set(toId, []);
    this.messageQueue.get(toId).push({ from: fromId, message, timestamp: this._timestamp() });
    return { delivered: true };
  }

  broadcastMessage(teamId, message) {
    const team = this.teams.get(teamId);
    if (!team) return { delivered: 0 };
    team.members.forEach(m => {
      if (!this.messageQueue.has(m.agentId)) this.messageQueue.set(m.agentId, []);
      this.messageQueue.get(m.agentId).push({ type: 'broadcast', message, timestamp: this._timestamp() });
    });
    return { delivered: team.members.length };
  }

  startOrchestration(goal, teamId) {
    const team = this.teams.get(teamId);
    if (!team) {
      // Auto-create team from template based on goal classification
      const templateName = this._classifyGoal(goal);
      const template = this.TEAM_TEMPLATES[templateName] || this.TEAM_TEMPLATES['code-team'];
      const newTeam = this.createTeam({ id: `auto_${this._generateId()}`, name: template.name, members: template.members, reviewPolicy: template.reviewPolicy });
      return this.decomposeAndAssign(goal, newTeam.id);
    }
    return this.decomposeAndAssign(goal, teamId);
  }

  _classifyGoal(goal) {
    const g = goal.toLowerCase();
    if (g.includes('安全') || g.includes('漏洞') || g.includes('审计') || g.includes('渗透')) return 'security-team';
    if (g.includes('研究') || g.includes('调研') || g.includes('分析报告') || g.includes('论文')) return 'research-team';
    if (g.includes('测试') || g.includes('验证') || g.includes('质量') || g.includes('qa')) return 'qa-team';
    if (g.includes('部署') || g.includes('运维') || g.includes('ci') || g.includes('docker') || g.includes('k8s')) return 'devops-team';
    if (g.includes('界面') || g.includes('设计') || g.includes('ui') || g.includes('css') || g.includes('样式')) return 'design-team';
    if (g.includes('全栈') || g.includes('系统') || g.includes('平台') || g.includes('架构')) return 'fullstack-team';
    if (g.includes('审查') || g.includes('review') || g.includes('检查') && !g.includes('开发')) return 'solo-review';
    return 'code-team';
  }

  getOrchStatus(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return null;
    const total = session.tasks.length;
    const completed = session.tasks.filter(t => t.status === 'completed').length;
    const failed = session.tasks.filter(t => t.status === 'failed').length;
    return { orchId, total, completed, failed, progress: total > 0 ? Math.round((completed/total)*100) : 0 };
  }

  cancelOrch(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return null;
    session.status = 'cancelled';
    session.tasks.forEach(t => { if (t.status === 'queued') t.status = 'cancelled'; });
    return session;
  }

  getAgentMetrics(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const agentJobs = Array.from(this.jobs.values()).filter(j => j.assignedTo === agentId);
    return { name: agent.name, tasksCompleted: agentJobs.filter(j => j.status === 'completed').length, currentLoad: agent.load };
  }

  generateReport(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return 'Not found';
    const status = this.getOrchStatus(orchId);
    let report = `# 团队协作报告\n\n- **目标**: ${session.goal}\n- **进度**: ${status.progress}%\n- **任务**: ${status.completed}/${status.total}\n\n`;
    report += `| 任务 | 状态 |\n|------|------|\n`;
    session.tasks.forEach(t => report += `| ${t.name} | ${t.status} |\n`);
    return report;
  }

  _ensureConfigDir() {
    ['agents', 'teams', 'sessions', 'jobs'].forEach(sub => {
      const d = path.join(this.configDir, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString().replace('T',' ').substring(0,19); }
}

// CLI
if (require.main === module) {
  const mao = new MultiAgentOrchestrator();
  const cmd = process.argv[2];
  const cmdMap = {
    agent() {
      const sub = process.argv[3] || 'list';
      if (sub === 'list') {
        if (mao.agents.size === 0) {
          // Auto-create template agents
          for (const [id, tmpl] of Object.entries(mao.AGENT_TEMPLATES)) {
            mao.registerAgent({ id, name: id, ...tmpl });
          }
        }
        console.log(`Agents (${mao.agents.size}):`);
        mao.listAgents().forEach(a => console.log(`  [${a.id}] ${a.name} (${a.role}) - ${a.capabilities.join(',')}`));
      }
    },
    team() {
      const sub = process.argv[3] || 'list';
      if (sub === 'list') {
        console.log('默认团队模板:');
        for (const [id, tmpl] of Object.entries(mao.TEAM_TEMPLATES)) {
          console.log(`  ${id}: ${tmpl.members.map(m => m.agentId).join(', ')}`);
        }
      } else if (sub === 'create') {
        const name = process.argv[4] || 'code-team';
        const tmpl = mao.TEAM_TEMPLATES[name] || mao.TEAM_TEMPLATES['code-team'];
        const team = mao.createTeam({ name, members: tmpl.members, reviewPolicy: tmpl.reviewPolicy });
        console.log(`团队已创建: ${team.id} (${team.name})`);
      }
    },
    orchestrate() {
      const goal = process.argv.slice(3).join(' ') || '创建REST API';
      const r = mao.startOrchestration(goal, 'code-team');
      if (r) console.log(`编排启动: ${r.orchId}, 任务数: ${r.tasks.length}`);
    },
    status() {
      const id = process.argv[3];
      if (!id) { console.log('请指定编排ID'); return; }
      console.log(JSON.stringify(mao.getOrchStatus(id), null, 2));
    },
    report() {
      const id = process.argv[3];
      if (!id) { console.log('请指定编排ID'); return; }
      console.log(mao.generateReport(id));
    },
    help() { console.log('MultiAgentOrchestrator CLI\n命令: agent, team, orchestrate, status, report, spawn, batch, proc-status, help'); }
  };
  (cmdMap[cmd] || cmdMap.help)();
}

console.log('[MultiAgentOrchestrator] 加载成功 - P4-3 多Agent编排器');

module.exports = MultiAgentOrchestrator;
module.exports.default = MultiAgentOrchestrator;
