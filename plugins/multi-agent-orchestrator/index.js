/**
 * multi-agent-orchestrator - P4-3 (P0) 多Agent编排器 [增强版]
 * 维度: D9-MultiAgent
 *
 * 增强内容：
 * - Agent生命周期管理（start/stop/restart）
 * - 动态负载均衡算法
 * - Agent能力评估与任务匹配
 * - 跨团队协作机制
 * - Agent性能监控
 * - 任务优先级路由
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// ============================================================================
// Agent Process Manager (IPC) - 增强版
// ============================================================================
class AgentProcessManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.processes = new Map();
    this.maxProcesses = 4;
    this.processPool = new Map(); // Agent进程池
    this.performanceHistory = new Map(); // 性能历史
  }

  async spawnAgent(agentId, task) {
    const agent = this.orchestrator.agents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };
    if (this.processes.size >= this.maxProcesses) return { success: false, error: 'Max processes reached' };

    const startTime = Date.now();
    const child = spawn('node', ['-e', `
      const s=Date.now();
      try{
        process.stdout.write(JSON.stringify({
          agentId:'${agentId}',
          taskId:'${task.id||'unknown'}',
          status:'completed',
          output:'Task by ${agent.name}',
          duration:Date.now()-s
        }));
      }catch(e){
        process.stdout.write(JSON.stringify({
          agentId:'${agentId}',
          taskId:'${task.id||'unknown'}',
          status:'failed',
          error:e.message,
          duration:Date.now()-s
        }));
      }
    `], { timeout: task.timeoutMs || 60000 });

    const pid = 'proc_' + child.pid + '_' + Date.now();
    this.processes.set(pid, {
      pid,
      agentId,
      taskId: task.id,
      process: child,
      startTime,
      status: 'running',
      result: null,
      resourceUsage: { cpu: 0, memory: 0 }
    });

    return new Promise((resolve) => {
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { /* ignore stderr */ });

      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        const p = this.processes.get(pid);
        if (p) {
          p.status = code === 0 ? 'completed' : 'failed';
          p.duration = duration;
          try { p.result = JSON.parse(out.trim()); } catch(e) { p.result = { raw: out }; }
          this._recordPerformance(agentId, duration, code === 0);
        }
        resolve({ success: code === 0, pid, agentId, taskId: task.id, duration, result: p?.result });
      });

      child.on('error', (e) => {
        const p = this.processes.get(pid);
        if (p) { p.status = 'error'; p.result = { error: e.message }; }
        this._recordPerformance(agentId, Date.now() - startTime, false);
        resolve({ success: false, pid, error: e.message });
      });
    });
  }

  _recordPerformance(agentId, duration, success) {
    if (!this.performanceHistory.has(agentId)) {
      this.performanceHistory.set(agentId, { total: 0, success: 0, totalDuration: 0, recent: [] });
    }
    const stats = this.performanceHistory.get(agentId);
    stats.total++;
    if (success) stats.success++;
    stats.totalDuration += duration;
    stats.recent.push({ duration, success, timestamp: Date.now() });
    if (stats.recent.length > 100) stats.recent.shift();
  }

  getAgentPerformance(agentId) {
    const stats = this.performanceHistory.get(agentId);
    if (!stats) return null;
    const recentAvg = stats.recent.length > 0
      ? stats.recent.reduce((s, r) => s + r.duration, 0) / stats.recent.length
      : 0;
    return {
      totalTasks: stats.total,
      successRate: Math.round(stats.success / stats.total * 100) || 0,
      avgDuration: Math.round(stats.totalDuration / stats.total) || 0,
      recentAvgDuration: Math.round(recentAvg),
      recentTrend: this._calcTrend(stats.recent)
    };
  }

  _calcTrend(recent) {
    if (recent.length < 5) return 'insufficient_data';
    const first = recent.slice(0, Math.floor(recent.length / 2));
    const last = recent.slice(-Math.floor(recent.length / 2));
    const firstAvg = first.reduce((s, r) => s + r.duration, 0) / first.length;
    const lastAvg = last.reduce((s, r) => s + r.duration, 0) / last.length;
    if (lastAvg < firstAvg * 0.9) return 'improving';
    if (lastAvg > firstAvg * 1.1) return 'degrading';
    return 'stable';
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

    return {
      total: tasks.length,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      avgDuration: Math.round(results.reduce((s, r) => s + (r.duration || 0), 0) / results.length),
      results
    };
  }

  killProcess(pid) {
    const p = this.processes.get(pid);
    if (p) {
      try { p.process.kill(); } catch(e) { /* ignore */ }
      p.status = 'killed';
      return true;
    }
    return false;
  }

  killAll() {
    let c = 0;
    for (const [pid, p] of this.processes) {
      try { p.process.kill(); c++; } catch(e) { /* ignore */ }
    }
    this.processes.clear();
    return { killed: c };
  }

  getStatus() {
    const st = [];
    for (const [pid, p] of this.processes) {
      st.push({
        pid,
        agentId: p.agentId,
        taskId: p.taskId,
        status: p.status,
        runtime: Date.now() - p.startTime,
        duration: p.duration
      });
    }
    return {
      active: this.processes.size,
      max: this.maxProcesses,
      processes: st,
      performance: Object.fromEntries(this.performanceHistory)
    };
  }
}

// ============================================================================
// MultiAgentOrchestrator
// ============================================================================
class MultiAgentOrchestrator {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'multi-agent-orchestrator');
    this.agents = new Map();
    this.teams = new Map();
    this.jobs = new Map();
    this.orchSessions = new Map();
    this.processManager = new AgentProcessManager(this);
    this.messageQueue = new Map();
    this.agentLifecycle = new Map(); // Agent生命周期状态
    this.crossTeamSessions = []; // 跨团队协作会话

    this.AgentRole = {
      LEADER: 'leader',
      EXECUTOR: 'executor',
      REVIEWER: 'reviewer',
      COORDINATOR: 'coordinator',
      OBSERVER: 'observer',
      SPECIALIST: 'specialist' // 新增：专家角色
    };

    this.AgentCapability = {
      CODE: 'code_generation',
      ANALYSIS: 'data_analysis',
      WRITING: 'content_writing',
      RESEARCH: 'research',
      TESTING: 'testing',
      SECURITY: 'security_audit',
      PLANNING: 'planning',
      DOCUMENTATION: 'documentation',
      DEPLOYMENT: 'deployment',
      MONITORING: 'monitoring'
    };

    this.JobStatus = {
      QUEUED: 'queued',
      ASSIGNED: 'assigned',
      IN_PROGRESS: 'in_progress',
      REVIEW: 'review',
      COMPLETED: 'completed',
      FAILED: 'failed'
    };

    this.CommProtocol = {
      DIRECT: 'direct',
      BROADCAST: 'broadcast',
      REVIEW_REQUEST: 'request_review',
      HANDOFF: 'handoff',
      ESCALATION: 'escalation'
    };

    // 增强：更丰富的Agent模板
    this.AGENT_TEMPLATES = {
      'architect': {
        name: '架构师',
        role: 'leader',
        capabilities: ['planning', 'system_design', 'code_review'],
        specialization: '系统架构设计和任务分解',
        maxConcurrency: 1,
        model: 'qwen3:4b-opt'
      },
      'coder': {
        name: '开发工程师',
        role: 'executor',
        capabilities: ['code_generation', 'debugging', 'testing'],
        specialization: '代码实现和调试',
        maxConcurrency: 3,
        model: 'qwen2.5:1.5b'
      },
      'reviewer': {
        name: '审查员',
        role: 'reviewer',
        capabilities: ['code_review', 'security_audit', 'documentation'],
        specialization: '代码质量和安全审查',
        maxConcurrency: 3,
        model: 'qwen3:4b-opt'
      },
      'analyst': {
        name: '分析师',
        role: 'executor',
        capabilities: ['data_analysis', 'research', 'planning'],
        specialization: '数据分析和深度研究',
        maxConcurrency: 2,
        model: 'qwen3:4b-opt'
      },
      'tester': {
        name: '测试工程师',
        role: 'executor',
        capabilities: ['testing', 'documentation', 'monitoring'],
        specialization: '测试验证和文档编写',
        maxConcurrency: 2,
        model: 'qwen2.5:1.5b'
      },
      'devops': {
        name: 'DevOps工程师',
        role: 'executor',
        capabilities: ['deployment', 'monitoring', 'security_audit'],
        specialization: '部署运维和基础设施',
        maxConcurrency: 2,
        model: 'qwen2.5:1.5b'
      },
      'designer': {
        name: '设计师',
        role: 'executor',
        capabilities: ['planning', 'documentation', 'code_generation'],
        specialization: '界面设计和用户体验',
        maxConcurrency: 2,
        model: 'qwen3:4b-opt'
      },
      'security-expert': {
        name: '安全专家',
        role: 'specialist',
        capabilities: ['security_audit', 'code_review', 'planning'],
        specialization: '安全审计和漏洞修复',
        maxConcurrency: 1,
        model: 'qwen3:4b-opt'
      }
    };

    // 增强：8团队模板
    this.TEAM_TEMPLATES = {
      'code-team': {
        name: '代码开发团队',
        members: [
          { agentId: 'architect', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.85 },
        maxParallelTasks: 3
      },
      'research-team': {
        name: '深度研究团队',
        members: [
          { agentId: 'analyst', role: 'leader' },
          { agentId: 'analyst', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.80 },
        maxParallelTasks: 2
      },
      'qa-team': {
        name: '质量保障团队',
        members: [
          { agentId: 'tester', role: 'leader' },
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'coder', role: 'executor' }
        ],
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.75 },
        maxParallelTasks: 4
      },
      'fullstack-team': {
        name: '全栈开发团队',
        members: [
          { agentId: 'architect', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'tester', role: 'executor' }
        ],
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.85 },
        maxParallelTasks: 5
      },
      'security-team': {
        name: '安全审计团队',
        members: [
          { agentId: 'security-expert', role: 'leader' },
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'architect', role: 'observer' }
        ],
        reviewPolicy: { requiredReviewers: 2, autoApproveThreshold: 0.95, maxRevisionRounds: 5 },
        maxParallelTasks: 2
      },
      'devops-team': {
        name: 'DevOps团队',
        members: [
          { agentId: 'devops', role: 'leader' },
          { agentId: 'devops', role: 'executor' },
          { agentId: 'tester', role: 'reviewer' }
        ],
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.90 },
        maxParallelTasks: 3
      },
      'design-team': {
        name: '设计开发团队',
        members: [
          { agentId: 'designer', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.80 },
        maxParallelTasks: 2
      },
      'solo-review': {
        name: '单人审查模式',
        members: [
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        reviewPolicy: { requiredReviewers: 0, autoApproveThreshold: 0.70 },
        maxParallelTasks: 1
      }
    };

    this._ensureConfigDir();
  }

  // ==================== Agent Lifecycle Management ====================

  /**
   * 启动Agent
   */
  startAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };

    const lifecycle = {
      agentId,
      status: 'starting',
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      restartCount: 0,
      uptime: 0
    };

    this.agentLifecycle.set(agentId, lifecycle);
    agent.status = 'idle';

    return { success: true, lifecycle };
  }

  /**
   * 停止Agent
   */
  stopAgent(agentId, force = false) {
    const lifecycle = this.agentLifecycle.get(agentId);
    const agent = this.agents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };

    if (lifecycle) {
      lifecycle.status = 'stopping';
      lifecycle.stoppedAt = Date.now();
      lifecycle.uptime = lifecycle.stoppedAt - lifecycle.startedAt;
    }

    agent.status = 'stopped';

    return { success: true, uptime: lifecycle?.uptime || 0 };
  }

  /**
   * 重启Agent
   */
  restartAgent(agentId) {
    const lifecycle = this.agentLifecycle.get(agentId);
    if (!lifecycle) return this.startAgent(agentId);

    lifecycle.restartCount++;
    lifecycle.status = 'restarting';
    lifecycle.restartedAt = Date.now();

    return { success: true, restartCount: lifecycle.restartCount };
  }

  /**
   * 获取Agent生命周期状态
   */
  getAgentLifecycle(agentId) {
    return this.agentLifecycle.get(agentId) || null;
  }

  /**
   * Agent心跳检测
   */
  heartbeat(agentId) {
    const lifecycle = this.agentLifecycle.get(agentId);
    if (lifecycle) {
      lifecycle.lastHeartbeat = Date.now();
      lifecycle.uptime = Date.now() - lifecycle.startedAt;
      return true;
    }
    return false;
  }

  // ==================== Agent Management ====================

  registerAgent(agentDef) {
    const agent = {
      id: agentDef.id || this._generateId(),
      name: agentDef.name,
      role: agentDef.role || 'executor',
      capabilities: agentDef.capabilities || [],
      model: agentDef.model || 'default',
      skills: agentDef.skills || [],
      maxConcurrency: agentDef.maxConcurrency || 2,
      specialization: agentDef.specialization || '',
      status: 'idle',
      load: 0,
      capabilityScore: {}, // 能力评分
      registeredAt: this._timestamp()
    };

    this.agents.set(agent.id, agent);
    this.startAgent(agent.id);
    return agent;
  }

  unregisterAgent(agentId) {
    this.stopAgent(agentId);
    return this.agents.delete(agentId);
  }

  getAgent(agentId) { return this.agents.get(agentId) || null; }

  listAgents(filter = {}) {
    let agents = Array.from(this.agents.values());
    if (filter.role) agents = agents.filter(a => a.role === filter.role);
    if (filter.status) agents = agents.filter(a => a.status === filter.status);
    if (filter.capability) agents = agents.filter(a => a.capabilities.includes(filter.capability));
    return agents;
  }

  updateAgentStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (agent) { agent.status = status; return agent; }
    return null;
  }

  // ==================== Dynamic Load Balancing ====================

  /**
   * 动态负载均衡
   */
  dynamicBalanceLoad(teamId, pendingTasks) {
    const team = this.teams.get(teamId);
    if (!team) return [];

    const assignments = [];
    const agentLoads = [];

    // 计算每个Agent的当前负载和能力
    for (const member of team.members) {
      const agent = this.agents.get(member.agentId);
      if (!agent) continue;

      const perf = this.processManager.getAgentPerformance(member.agentId);
      const lifecycle = this.getAgentLifecycle(member.agentId);

      agentLoads.push({
        agentId: member.agentId,
        currentLoad: agent.load,
        maxConcurrency: agent.maxConcurrency,
        successRate: perf?.successRate || 100,
        avgDuration: perf?.avgDuration || 5000,
        isHealthy: lifecycle?.status === 'idle' || lifecycle?.status === 'running',
        capabilities: agent.capabilities
      });
    }

    // 智能分配
    for (const task of pendingTasks) {
      let bestAgent = null;
      let bestScore = -Infinity;

      for (const al of agentLoads) {
        if (al.currentLoad >= al.maxConcurrency || !al.isHealthy) continue;

        // 计算匹配度分数
        let matchScore = 0;
        if (task.requiredCapabilities) {
          for (const cap of task.requiredCapabilities) {
            if (al.capabilities.includes(cap)) matchScore += 20;
          }
        }

        // 负载分数（负载越低分数越高）
        const loadScore = (al.maxConcurrency - al.currentLoad) / al.maxConcurrency * 30;

        // 健康分数
        const healthScore = al.isHealthy ? 20 : 0;

        // 性能分数（任务执行越快分数越高）
        const perfScore = Math.max(0, 30 - al.avgDuration / 1000);

        const totalScore = matchScore + loadScore + healthScore + perfScore;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestAgent = al;
        }
      }

      if (bestAgent) {
        assignments.push({
          taskId: task.id,
          assignedTo: bestAgent.agentId,
          score: bestScore,
          reason: 'dynamic_load_balance'
        });
        bestAgent.currentLoad++;
      }
    }

    return assignments;
  }

  balanceLoad(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return [];
    const reassignments = [];
    const loads = team.members.map(m => ({
      agentId: m.agentId,
      load: this.agents.get(m.agentId)?.load || 0,
      maxConcurrency: this.agents.get(m.agentId)?.maxConcurrency || 2
    }));

    for (let i = 0; i < loads.length; i++) {
      for (let j = i + 1; j < loads.length; j++) {
        if (loads[i].load - loads[j].load > 2) {
          reassignments.push({ from: loads[i].agentId, to: loads[j].agentId, reason: 'load balancing' });
        }
      }
    }
    return reassignments;
  }

  // ==================== Team Management ====================

  createTeam(teamDef) {
    const team = {
      id: teamDef.id || this._generateId(),
      name: teamDef.name || 'unnamed',
      members: teamDef.members || [],
      routingRules: teamDef.routingRules || [],
      reviewPolicy: teamDef.reviewPolicy || { requiredReviewers: 1, autoApproveThreshold: 0.9, maxRevisionRounds: 3 },
      communicationMode: teamDef.communicationMode || 'direct',
      maxParallelTasks: teamDef.maxParallelTasks || 3,
      created: this._timestamp()
    };
    this.teams.set(team.id, team);
    return team;
  }

  disbandTeam(teamId) { return this.teams.delete(teamId); }

  addMember(teamId, agentDef) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    team.members.push({
      agentId: agentDef.agentId || agentDef.id,
      role: agentDef.role || 'executor',
      weight: agentDef.weight || 0.5
    });
    return team;
  }

  removeMember(teamId, agentId) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    team.members = team.members.filter(m => m.agentId !== agentId);
    return team;
  }

  getTeam(teamId) { return this.teams.get(teamId) || null; }

  // ==================== Task Routing ====================

  /**
   * 智能任务路由
   */
  routeTask(task, teamId = null) {
    // 如果指定了团队，在团队内路由
    if (teamId) {
      const team = this.teams.get(teamId);
      if (!team) return null;
      return this._routeWithinTeam(task, team);
    }

    // 全局路由：找到最佳团队
    const bestTeam = this._findBestTeam(task);
    if (!bestTeam) return null;

    return {
      ...this._routeWithinTeam(task, bestTeam),
      teamId: bestTeam.id,
      teamName: bestTeam.name
    };
  }

  _findBestTeam(task) {
    const taskType = this._classifyGoal(task.name || task.description || '');
    let bestTeam = null;
    let bestMatch = 0;

    for (const [teamId, team] of this.teams) {
      let match = 0;
      for (const member of team.members) {
        const agent = this.agents.get(member.agentId);
        if (!agent) continue;

        // 匹配能力
        if (task.requiredCapabilities) {
          for (const cap of task.requiredCapabilities) {
            if (agent.capabilities.includes(cap)) match += 10;
          }
        }

        // 匹配类型
        if (agent.role === taskType) match += 5;
      }

      // 可用性调整
      const isAvailable = team.members.some(m => {
        const a = this.agents.get(m.agentId);
        return a && a.status !== 'busy' && a.load < a.maxConcurrency;
      });

      if (isAvailable && match > bestMatch) {
        bestMatch = match;
        bestTeam = team;
      }
    }

    return bestTeam;
  }

  _routeWithinTeam(task, team) {
    const eligibleMembers = [];

    for (const member of team.members) {
      const agent = this.agents.get(member.agentId);
      if (!agent || agent.status === 'busy') continue;
      if (agent.load >= agent.maxConcurrency) continue;

      let matchScore = 0;
      if (task.requiredCapabilities) {
        for (const cap of task.requiredCapabilities) {
          if (agent.capabilities.includes(cap)) matchScore += 10;
        }
      }

      // 负载评分
      const loadScore = (agent.maxConcurrency - agent.load) / agent.maxConcurrency;

      // 角色匹配
      if (member.role === 'leader' && task.priority > 7) matchScore += 15;
      if (member.role === 'reviewer' && task.needsReview) matchScore += 20;

      eligibleMembers.push({
        agentId: agent.id,
        name: agent.name,
        role: member.role,
        matchScore,
        loadScore,
        totalScore: matchScore * 0.7 + loadScore * 30
      });
    }

    eligibleMembers.sort((a, b) => b.totalScore - a.totalScore);

    if (eligibleMembers.length === 0) return null;

    const selected = eligibleMembers[0];
    return {
      agentId: selected.agentId,
      agentName: selected.name,
      role: selected.role,
      confidence: Math.round(selected.totalScore)
    };
  }

  // ==================== Cross-Team Collaboration ====================

  /**
   * 发起跨团队协作
   */
  initiateCrossTeamCollaboration(task, teamIds) {
    const sessionId = this._generateId();
    const teams = teamIds.map(id => this.teams.get(id)).filter(Boolean);

    if (teams.length < 2) return { success: false, error: 'Need at least 2 teams' };

    const session = {
      id: sessionId,
      task,
      teams: teams.map(t => ({ id: t.id, name: t.name, members: t.members })),
      status: 'active',
      started: this._timestamp(),
      participants: [],
      handoffs: []
    };

    // 为每个团队分配子任务
    const subtasks = this._decomposeForTeams(task, teams);
    for (let i = 0; i < teams.length; i++) {
      session.participants.push({
        teamId: teams[i].id,
        subtask: subtasks[i]
      });
    }

    this.crossTeamSessions.push(session);
    return { success: true, sessionId, subtasks };
  }

  _decomposeForTeams(task, teams) {
    const subtasks = [];
    const keywords = ['分析', '实现', '测试', '审查', '部署'];

    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const keyword = keywords[i % keywords.length];
      subtasks.push({
        id: this._generateId(),
        name: `${task.name || task.description} - ${keyword}`,
        assignedTo: team.id,
        dependencies: i > 0 ? [subtasks[i - 1].id] : []
      });
    }

    return subtasks;
  }

  /**
   * 任务交接
   */
  handoverTask(fromAgentId, toAgentId, taskId, context = {}) {
    const handoff = {
      id: this._generateId(),
      fromAgentId,
      toAgentId,
      taskId,
      context,
      timestamp: this._timestamp(),
      status: 'pending'
    };

    // 更新任务状态
    const job = this.jobs.get(taskId);
    if (job) {
      job.assignedTo = toAgentId;
      job.handoffHistory = job.handoffHistory || [];
      job.handoffHistory.push(handoff);
    }

    // 发送消息
    this.sendMessage(fromAgentId, toAgentId, {
      type: 'handoff',
      taskId,
      context
    });

    return handoff;
  }

  // ==================== Orchestration ====================

  decomposeAndAssign(goal, teamId) {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const orchId = this._generateId();
    const tasks = [];
    const taskType = this._classifyGoal(goal);
    const keywords = ['分析', '实现', '测试', '审查', '部署'];
    let taskCount = 0;

    for (const kw of keywords) {
      if (goal.includes(kw) || taskCount < 3) {
        const capabilities = [];
        if (kw === '实现') capabilities.push('code_generation');
        else if (kw === '测试') capabilities.push('testing');
        else if (kw === '审查') capabilities.push('code_review');
        else capabilities.push('planning');

        tasks.push({
          id: this._generateId(),
          name: `${goal.substring(0, 30)} - ${kw}`,
          status: 'queued',
          dependencies: taskCount > 0 ? [tasks[taskCount - 1].id] : [],
          requiredCapabilities: capabilities,
          priority: taskCount === 0 ? 10 : 5,
          estimatedMinutes: 20
        });
        taskCount++;
      }
    }

    const session = {
      id: orchId,
      teamId,
      goal,
      taskType,
      tasks,
      status: 'active',
      started: this._timestamp(),
      completedTasks: [],
      failedTasks: []
    };

    this.orchSessions.set(orchId, session);
    return { orchId, tasks, team };
  }

  assignJob(jobId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const job = {
      id: jobId,
      assignedTo: agentId,
      status: 'assigned',
      assignedAt: this._timestamp(),
      handoffHistory: []
    };
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
    return session.tasks.filter(t =>
      t.status === 'queued' &&
      (t.dependencies || []).every(d => completed.has(d))
    );
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
    this.messageQueue.get(toId).push({
      from: fromId,
      message,
      timestamp: this._timestamp()
    });
    return { delivered: true };
  }

  broadcastMessage(teamId, message) {
    const team = this.teams.get(teamId);
    if (!team) return { delivered: 0 };
    team.members.forEach(m => {
      if (!this.messageQueue.has(m.agentId)) this.messageQueue.set(m.agentId, []);
      this.messageQueue.get(m.agentId).push({
        type: 'broadcast',
        message,
        timestamp: this._timestamp()
      });
    });
    return { delivered: team.members.length };
  }

  startOrchestration(goal, teamId) {
    const team = this.teams.get(teamId);
    if (!team) {
      const templateName = this._classifyGoal(goal);
      const template = this.TEAM_TEMPLATES[templateName] || this.TEAM_TEMPLATES['code-team'];
      const newTeam = this.createTeam({
        id: `auto_${this._generateId()}`,
        name: template.name,
        members: template.members,
        reviewPolicy: template.reviewPolicy
      });
      return this.decomposeAndAssign(goal, newTeam.id);
    }
    return this.decomposeAndAssign(goal, teamId);
  }

  _classifyGoal(goal) {
    const g = goal.toLowerCase();
    if (g.includes('安全') || g.includes('漏洞') || g.includes('审计')) return 'security-team';
    if (g.includes('研究') || g.includes('调研') || g.includes('分析报告')) return 'research-team';
    if (g.includes('测试') || g.includes('验证') || g.includes('质量')) return 'qa-team';
    if (g.includes('部署') || g.includes('运维') || g.includes('docker')) return 'devops-team';
    if (g.includes('界面') || g.includes('设计') || g.includes('ui')) return 'design-team';
    if (g.includes('全栈') || g.includes('系统') || g.includes('平台')) return 'fullstack-team';
    if (g.includes('审查') || g.includes('review')) return 'solo-review';
    return 'code-team';
  }

  getOrchStatus(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return null;
    const total = session.tasks.length;
    const completed = session.tasks.filter(t => t.status === 'completed').length;
    const failed = session.tasks.filter(t => t.status === 'failed').length;
    return {
      orchId,
      total,
      completed,
      failed,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
      status: session.status
    };
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
    const perf = this.processManager.getAgentPerformance(agentId);
    const lifecycle = this.getAgentLifecycle(agentId);

    return {
      name: agent.name,
      role: agent.role,
      status: agent.status,
      tasksCompleted: agentJobs.filter(j => j.status === 'completed').length,
      currentLoad: agent.load,
      performance: perf,
      uptime: lifecycle?.uptime || 0,
      restartCount: lifecycle?.restartCount || 0
    };
  }

  // ==================== Reports ====================

  generateReport(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return 'Not found';
    const status = this.getOrchStatus(orchId);
    let report = `# 团队协作报告\n\n`;
    report += `- **目标**: ${session.goal}\n`;
    report += `- **类型**: ${session.taskType}\n`;
    report += `- **进度**: ${status.progress}%\n`;
    report += `- **任务**: ${status.completed}/${status.total}\n\n`;
    report += `| 任务 | 状态 | 优先级 |\n|------|------|--------|\n`;
    session.tasks.forEach(t => {
      report += `| ${t.name} | ${t.status} | ${t.priority || 5} |\n`;
    });
    return report;
  }

  // ==================== Agent Performance Monitoring ====================

  getAllAgentPerformance() {
    const performance = {};
    for (const [agentId, agent] of this.agents) {
      const perf = this.processManager.getAgentPerformance(agentId);
      const lifecycle = this.getAgentLifecycle(agentId);
      performance[agentId] = {
        name: agent.name,
        status: agent.status,
        load: agent.load,
        ...perf,
        uptime: lifecycle?.uptime || 0
      };
    }
    return performance;
  }

  // ==================== Utilities ====================

  _ensureConfigDir() {
    ['agents', 'teams', 'sessions', 'jobs'].forEach(sub => {
      const d = path.join(this.configDir, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString().replace('T', ' ').substring(0, 19); }
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
          for (const [id, tmpl] of Object.entries(mao.AGENT_TEMPLATES)) {
            mao.registerAgent({ id, name: id, ...tmpl });
          }
        }
        console.log(`Agents (${mao.agents.size}):`);
        mao.listAgents().forEach(a => console.log(`  [${a.id}] ${a.name} (${a.role}) - ${a.capabilities.join(',')}`));
      } else if (sub === 'start') {
        const id = process.argv[4];
        console.log(JSON.stringify(mao.startAgent(id), null, 2));
      } else if (sub === 'stop') {
        const id = process.argv[4];
        console.log(JSON.stringify(mao.stopAgent(id), null, 2));
      } else if (sub === 'restart') {
        const id = process.argv[4];
        console.log(JSON.stringify(mao.restartAgent(id), null, 2));
      } else if (sub === 'perf') {
        console.log(JSON.stringify(mao.getAllAgentPerformance(), null, 2));
      }
    },
    team() {
      const sub = process.argv[3] || 'list';
      if (sub === 'list') {
        console.log('默认团队模板:');
        for (const [id, tmpl] of Object.entries(mao.TEAM_TEMPLATES)) {
          console.log(`  ${id}: ${tmpl.name} (${tmpl.members.map(m => m.agentId).join(', ')})`);
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
    route() {
      const task = { name: process.argv.slice(3).join(' ') || '实现用户认证', requiredCapabilities: ['code_generation'] };
      const r = mao.routeTask(task);
      console.log(r ? `路由到: ${r.agentName} (${r.role}) 置信度: ${r.confidence}%` : '无法路由');
    },
    performance() {
      console.log(JSON.stringify(mao.getAllAgentPerformance(), null, 2));
    },
    proc() {
      console.log(JSON.stringify(mao.processManager.getStatus(), null, 2));
    },
    report() {
      const id = process.argv[3];
      if (!id) { console.log('请指定编排ID'); return; }
      console.log(mao.generateReport(id));
    },
    help() {
      console.log('MultiAgentOrchestrator CLI - P4-3 [增强版]\n命令: agent, team, orchestrate, status, route, performance, proc, report, help');
    }
  };
  (cmdMap[cmd] || cmdMap.help)();
}

console.log('[MultiAgentOrchestrator] 加载成功 - P4-3 多Agent编排器 [增强版]');

module.exports = MultiAgentOrchestrator;
module.exports.default = MultiAgentOrchestrator;
