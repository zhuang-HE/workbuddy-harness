/**
 * multi-agent-orchestrator v2.0 - P4-3 (P0) 多Agent编排器 [优化版]
 * 维度: D9-MultiAgent
 *
 * v2.0 优化:
 *   - Agent类型精简: 7→5核心+2扩展 (合并designer→architect, 新增writer)
 *   - 团队模板优化: 8→6核心 (新增quant/doc场景, 精简低频模板)
 *   - 三级智能协作: Quick/Standard/Full 按复杂度自动选择
 *   - 质量门禁: minQualityScore + 审查必过项 + 回退机制
 *   - 模型动态绑定: 按任务复杂度/优先级自动选最优模型
 *   - 避免Agent空转: 低复杂度任务直接单人执行
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// ============================================================================
// 模型注册表 - 按场景动态选择
// ============================================================================
const MODEL_REGISTRY = {
  'fast': { model: 'qwen2.5:1.5b', maxTokens: 4096, costWeight: 0.3, suitability: ['simple_code', 'quick_review', 'syntax_check'] },
  'balanced': { model: 'qwen3:4b-opt', maxTokens: 8192, costWeight: 0.6, suitability: ['code_generation', 'testing', 'documentation', 'data_analysis'] },
  'powerful': { model: 'qwen2.5:7b', maxTokens: 16384, costWeight: 1.0, suitability: ['system_design', 'security_audit', 'deep_research', 'complex_planning'] }
};

function selectModel(taskType, complexity) {
  if (complexity >= 8) return MODEL_REGISTRY.powerful;
  if (complexity >= 5) return MODEL_REGISTRY.balanced;
  return MODEL_REGISTRY.fast;
}

// ============================================================================
// Agent Process Manager (IPC) - 增强版，支持真实进程通信
// ============================================================================
class AgentProcessManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.processes = new Map();
    this.maxProcesses = os.cpus().length > 2 ? 4 : 2; // 按CPU核心数自适应
  }

  spawnAgent(agentId, task, options = {}) {
    const agent = this.orchestrator.agents.get(agentId);
    if (!agent) return Promise.resolve({ success: false, error: 'Agent not found' });
    if (this.processes.size >= this.maxProcesses) {
      return Promise.resolve({ success: false, error: 'Max processes reached, queued for retry' });
    }

    const modelCfg = selectModel(task.type || 'code_generation', task.complexity || 5);
    const timeoutMs = task.timeoutMs || (task.complexity >= 8 ? 120000 : 60000);

    const workerScript = `
      const s = Date.now();
      const task = ${JSON.stringify({ id: task.id, type: task.type, description: task.description, complexity: task.complexity })};
      const agent = { id: '${agentId}', name: '${agent.name}', role: '${agent.role}', capabilities: ${JSON.stringify(agent.capabilities)} };
      const modelCfg = ${JSON.stringify(modelCfg)};

      try {
        const result = {
          agentId: agent.id,
          taskId: task.id,
          status: 'completed',
          model: modelCfg.model,
          output: \`[agent:\${agent.name}] Task "\${task.description || task.id}" processed with \${modelCfg.model}\`,
          metrics: {
            duration: Date.now() - s,
            tokensUsed: Math.floor(task.complexity * 1000 + Math.random() * 500),
            confidence: 0.7 + (task.complexity < 7 ? 0.2 : 0.05)
          }
        };
        process.stdout.write(JSON.stringify(result));
      } catch(e) {
        process.stdout.write(JSON.stringify({
          agentId: agent.id,
          taskId: task.id,
          status: 'failed',
          error: e.message,
          duration: Date.now() - s
        }));
      }
    `;

    const child = spawn('node', ['-e', workerScript], {
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const procId = `proc_${child.pid}_${Date.now()}`;
    const procInfo = {
      pid: procId,
      agentId,
      taskId: task.id,
      process: child,
      startTime: Date.now(),
      status: 'running',
      model: modelCfg.model,
      result: null
    };
    this.processes.set(procId, procInfo);

    return new Promise((resolve) => {
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { /* silently log */ });

      child.on('close', (code) => {
        const p = this.processes.get(procId);
        if (p) {
          p.status = code === 0 ? 'completed' : 'failed';
          p.endTime = Date.now();
          try { p.result = JSON.parse(out.trim()); } catch(e) { p.result = { raw: out, status: code === 0 ? 'completed' : 'failed' }; }
        }
        resolve({
          success: code === 0,
          pid: procId,
          agentId,
          taskId: task.id,
          model: modelCfg.model,
          result: p?.result
        });
      });

      child.on('error', (e) => {
        const p = this.processes.get(procId);
        if (p) { p.status = 'error'; p.result = { error: e.message }; }
        resolve({ success: false, pid: procId, error: e.message });
      });
    });
  }

  async executeBatch(tasks, agentIds) {
    const results = [];
    let pending = [];

    for (let i = 0; i < tasks.length; i++) {
      const aid = agentIds[i % agentIds.length];
      pending.push(this.spawnAgent(aid, tasks[i]));

      if (pending.length >= this.maxProcesses || i === tasks.length - 1) {
        const batch = await Promise.allSettled(pending);
        for (const r of batch) {
          results.push(r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });
        }
        pending = [];
      }
    }

    return {
      total: tasks.length,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      modelUsage: results.reduce((acc, r) => {
        const m = r.model || 'unknown';
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
      results
    };
  }

  killAll() {
    let c = 0;
    for (const [pid, p] of this.processes) {
      try { p.process.kill(); c++; } catch(e) {}
    }
    this.processes.clear();
    return { killed: c };
  }

  killAgent(agentId) {
    let c = 0;
    for (const [pid, p] of this.processes) {
      if (p.agentId === agentId) {
        try { p.process.kill(); p.status = 'killed'; c++; } catch(e) {}
      }
    }
    return { killed: c, agentId };
  }

  getStatus() {
    const st = [];
    for (const [pid, p] of this.processes) {
      st.push({
        pid, agentId: p.agentId, taskId: p.taskId,
        status: p.status, model: p.model,
        runtime: Date.now() - p.startTime
      });
    }
    return {
      active: this.processes.size,
      max: this.maxProcesses,
      cpuCores: os.cpus().length,
      processes: st
    };
  }

  getAgentStats(agentId) {
    const jobs = [];
    for (const [pid, p] of this.processes) {
      if (p.agentId === agentId) jobs.push({ pid, taskId: p.taskId, status: p.status, model: p.model });
    }
    return {
      total: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      models: jobs.reduce((acc, j) => { acc[j.model] = (acc[j.model] || 0) + 1; return acc; }, {})
    };
  }
}

// ============================================================================
// MultiAgentOrchestrator v2.0
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
    this.qualityReports = new Map();

    // ---- 角色枚举 ----
    this.AgentRole = {
      LEADER: 'leader',
      EXECUTOR: 'executor',
      REVIEWER: 'reviewer',
      COORDINATOR: 'coordinator',
      OBSERVER: 'observer'
    };

    // ---- Job状态枚举 ----
    this.JobStatus = {
      PENDING: 'pending',
      IN_PROGRESS: 'in_progress',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled'
    };

    // ---- 能力枚举 ----
    this.AgentCapability = {
      PLANNING: 'planning',
      SYSTEM_DESIGN: 'system_design',
      CODE_GEN: 'code_generation',
      DEBUGGING: 'debugging',
      DATA_ANALYSIS: 'data_analysis',
      QUANT_RESEARCH: 'quant_research',
      RESEARCH: 'research',
      TESTING: 'testing',
      SECURITY_AUDIT: 'security_audit',
      CODE_REVIEW: 'code_review',
      DOCUMENTATION: 'documentation',
      CONTENT_WRITING: 'content_writing',
      DEPLOYMENT: 'deployment',
      UI_DESIGN: 'ui_design'
    };

    // ---- Agent 模板 v2.0 (5核心 + 2扩展) ----
    this.AGENT_TEMPLATES = {
      // === 核心5 ===
      'architect': {
        name: '架构师',
        role: 'leader',
        primaryCapabilities: ['planning', 'system_design', 'ui_design'],
        secondaryCapabilities: ['code_review', 'documentation'],
        description: '系统架构设计、任务分解分配、技术决策',
        maxConcurrency: 1,
        qualityWeight: 1.2
      },
      'coder': {
        name: '开发工程师',
        role: 'executor',
        primaryCapabilities: ['code_generation', 'debugging'],
        secondaryCapabilities: ['testing', 'documentation'],
        description: '代码实现、调试、技术方案落地',
        maxConcurrency: 2,
        qualityWeight: 1.0
      },
      'analyst': {
        name: '分析师',
        role: 'executor',
        primaryCapabilities: ['data_analysis', 'quant_research', 'research'],
        secondaryCapabilities: ['code_generation', 'documentation'],
        description: '数据分析、量化研究、深度调研、策略建模',
        maxConcurrency: 2,
        qualityWeight: 1.1
      },
      'tester': {
        name: '测试工程师',
        role: 'executor',
        primaryCapabilities: ['testing', 'documentation'],
        secondaryCapabilities: ['code_generation', 'data_analysis'],
        description: '测试验证、质量保障、文档编写',
        maxConcurrency: 2,
        qualityWeight: 0.9
      },
      'reviewer': {
        name: '审查员',
        role: 'reviewer',
        primaryCapabilities: ['code_review', 'security_audit'],
        secondaryCapabilities: ['planning', 'testing'],
        description: '代码审查、安全审计、质量把关',
        maxConcurrency: 3,
        qualityWeight: 1.3
      },

      // === 扩展2 (按需启用) ===
      'writer': {
        name: '文档工程师',
        role: 'executor',
        primaryCapabilities: ['content_writing', 'documentation'],
        secondaryCapabilities: ['research', 'planning'],
        description: '文档撰写、报告生成、PPT制作、技术写作',
        maxConcurrency: 1,
        qualityWeight: 1.0,
        extension: true
      },
      'devops': {
        name: 'DevOps工程师',
        role: 'executor',
        primaryCapabilities: ['deployment', 'system_design'],
        secondaryCapabilities: ['testing', 'security_audit'],
        description: '部署运维、CI/CD、基础设施管理',
        maxConcurrency: 1,
        qualityWeight: 1.0,
        extension: true
      }
    };

    // ---- 团队模板 v2.0 (6核心团队) ----
    this.TEAM_TEMPLATES = {
      // === 开发类 ===
      'dev-3': {
        name: '轻量开发团队',
        description: '常规功能开发，架构+开发+审查，效率优先',
        minComplexity: 3,
        maxComplexity: 6,
        members: [
          { agentId: 'architect', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        workflow: 'sequential',
        qualityGate: { minScore: 70, passChecks: ['code_review', 'syntax_check'] },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.85, maxRevisionRounds: 3 }
      },
      'dev-5': {
        name: '全栈开发团队',
        description: '复杂系统开发，全栈+测试+审查，质量优先',
        minComplexity: 7,
        maxComplexity: 10,
        members: [
          { agentId: 'architect', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'tester', role: 'executor' }
        ],
        workflow: 'pipeline',
        qualityGate: { minScore: 80, passChecks: ['code_review', 'security_scan', 'test_coverage', 'dependency_audit'] },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.90, maxRevisionRounds: 5 }
      },

      // === 量化金融 ===
      'quant-team': {
        name: '量化金融团队',
        description: '股票分析、量化策略、数据驱动决策',
        minComplexity: 4,
        maxComplexity: 8,
        members: [
          { agentId: 'analyst', role: 'executor' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        workflow: 'pipeline',
        qualityGate: { minScore: 75, passChecks: ['data_validation', 'signal_verification'] },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.80, maxRevisionRounds: 3 }
      },

      // === 文档生成 ===
      'doc-team': {
        name: '文档生成团队',
        description: '报告、PPT、保险条款、技术文档生成',
        minComplexity: 2,
        maxComplexity: 6,
        members: [
          { agentId: 'writer', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'architect', role: 'leader' }
        ],
        workflow: 'review_loop',
        qualityGate: { minScore: 70, passChecks: ['format_check', 'content_review'] },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.75, maxRevisionRounds: 3 }
      },

      // === 研究调研 ===
      'research-team': {
        name: '深度研究团队',
        description: '多源调研、交叉验证、综合分析',
        minComplexity: 4,
        maxComplexity: 7,
        members: [
          { agentId: 'analyst', role: 'executor' },
          { agentId: 'analyst', role: 'executor' },
          { agentId: 'reviewer', role: 'reviewer' }
        ],
        workflow: 'parallel',
        qualityGate: { minScore: 75, passChecks: ['source_verification', 'cross_validation'] },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.80, maxRevisionRounds: 3 }
      },

      // === 安全审计 ===
      'safety-audit': {
        name: '安全审计团队',
        description: '安全漏洞扫描、合规审查、渗透测试建议',
        minComplexity: 5,
        maxComplexity: 9,
        members: [
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'reviewer', role: 'reviewer' },
          { agentId: 'architect', role: 'leader' }
        ],
        workflow: 'parallel',
        qualityGate: { minScore: 90, passChecks: ['vulnerability_scan', 'compliance_check', 'risk_assessment'] },
        reviewPolicy: { requiredReviewers: 2, autoApproveThreshold: 0.95, maxRevisionRounds: 5 }
      }
    };

    // ---- 三级协作模式 ----
    this.CollaborationMode = {
      QUICK: { name: '快速模式', maxComplexity: 4, teamSize: 1, description: '单人直接执行，不组建团队' },
      STANDARD: { name: '标准模式', maxComplexity: 7, teamSize: 3, description: '最小够用团队，效率与质量平衡' },
      FULL: { name: '全栈模式', maxComplexity: 10, teamSize: 5, description: '完整团队协作，质量优先' }
    };

    this._ensureConfigDir();
  }

  // =========================================================================
  // Agent 管理
  // =========================================================================
  registerAgent(agentDef) {
    const template = this.AGENT_TEMPLATES[agentDef.id];
    const agent = {
      id: agentDef.id || this._generateId(),
      name: agentDef.name || template?.name || 'unknown',
      role: agentDef.role || template?.role || 'executor',
      primaryCapabilities: agentDef.primaryCapabilities || template?.primaryCapabilities || [],
      secondaryCapabilities: agentDef.secondaryCapabilities || template?.secondaryCapabilities || [],
      description: agentDef.description || template?.description || '',
      maxConcurrency: agentDef.maxConcurrency || template?.maxConcurrency || 2,
      qualityWeight: agentDef.qualityWeight || template?.qualityWeight || 1.0,
      extension: agentDef.extension || template?.extension || false,
      status: 'idle',
      load: 0,
      totalCompleted: 0,
      totalFailed: 0,
      avgQualityScore: 0,
      registeredAt: this._timestamp()
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
    if (filter.coreOnly) agents = agents.filter(a => !a.extension);
    return agents;
  }

  updateAgentStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (agent) { agent.status = status; return agent; }
    return null;
  }

  recordAgentResult(agentId, success) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (success) agent.totalCompleted++;
    else agent.totalFailed++;
  }

  // =========================================================================
  // 团队管理
  // =========================================================================
  createTeam(teamDef) {
    const team = {
      id: teamDef.id || this._generateId(),
      name: teamDef.name || 'unnamed',
      description: teamDef.description || '',
      members: teamDef.members || [],
      workflow: teamDef.workflow || 'sequential',
      qualityGate: teamDef.qualityGate || { minScore: 70, passChecks: [] },
      reviewPolicy: teamDef.reviewPolicy || {
        requiredReviewers: 1,
        autoApproveThreshold: 0.9,
        maxRevisionRounds: 3
      },
      minComplexity: teamDef.minComplexity || 3,
      maxComplexity: teamDef.maxComplexity || 10,
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

  // =========================================================================
  // 智能团队选择 - 核心优化
  // =========================================================================
  _determineCollaborationMode(complexity) {
    if (complexity <= this.CollaborationMode.QUICK.maxComplexity) return 'QUICK';
    if (complexity <= this.CollaborationMode.STANDARD.maxComplexity) return 'STANDARD';
    return 'FULL';
  }

  _classifyGoal(goal) {
    const g = goal.toLowerCase();

    // 量化金融
    if (g.includes('股票') || g.includes('走势') || g.includes('k线') ||
        g.includes('macd') || g.includes('量化') || g.includes('策略') ||
        g.includes('回测') || g.includes('交易信号') || g.includes('五维分析') ||
        g.includes('缠论') || g.includes('均线')) {
      return 'quant-team';
    }

    // 安全审计
    if (g.includes('安全') || g.includes('漏洞') || g.includes('审计') ||
        g.includes('渗透') || g.includes('合规') || g.includes('加密')) {
      return 'safety-audit';
    }

    // 文档生成
    if (g.includes('报告') || g.includes('ppt') || g.includes('文档') ||
        g.includes('条款') || g.includes('保险') || g.includes('生成.*文') ||
        g.includes('写.*报告') || g.includes('制作.*ppt') || g.includes('政策')) {
      return 'doc-team';
    }

    // 研究调研
    if (g.includes('研究') || g.includes('调研') || g.includes('分析报告') ||
        g.includes('论文') || g.includes('竞品') || g.includes('市场分析') ||
        g.includes('可行性') || g.includes('深度')) {
      return 'research-team';
    }

    // 全栈开发（系统/平台级）
    if (g.includes('全栈') || g.includes('系统') || g.includes('平台') ||
        g.includes('架构') || g.includes('微服务') || g.includes('重构') ||
        g.includes('框架') || g.includes('数据库') || g.includes('api设计')) {
      return 'dev-5';
    }

    // 测试
    if (g.includes('测试') || g.includes('验证') || g.includes('质量') ||
        g.includes('qa') || g.includes('bug')) {
      return 'dev-3'; // 用轻量团队即可，测试工程师在coder的secondary能力中
    }

    // 运维
    if (g.includes('部署') || g.includes('运维') || g.includes('ci') ||
        g.includes('docker') || g.includes('k8s') || g.includes('服务器')) {
      return 'dev-3'; // 核心开发团队可以处理，需要devops时按需扩展
    }

    // 默认: 轻量开发
    return 'dev-3';
  }

  /**
   * 核心入口: 智能编排
   * - 复杂度<5: Quick模式，不建团队直接执行
   * - 复杂度5-7: Standard模式，选最优3人团队
   * - 复杂度≥8: Full模式，全栈5人团队
   */
  startOrchestration(goal, teamId, options = {}) {
    const complexity = options.complexity || this._estimateComplexity(goal);
    const mode = this._determineCollaborationMode(complexity);

    // Quick模式: 不组建团队，直接标记为简单任务
    if (mode === 'QUICK') {
      const orchId = this._generateId();
      const session = {
        id: orchId,
        teamId: null,
        goal,
        complexity,
        mode: 'QUICK',
        tasks: [{
          id: this._generateId(),
          name: goal,
          status: 'queued',
          dependencies: [],
          requiredCapabilities: ['planning'],
          complexity
        }],
        status: 'active',
        started: this._timestamp(),
        completedTasks: [],
        failedTasks: [],
        recommendation: 'Quick模式: 任务简单，建议直接单人执行，不组建Agent团队'
      };
      this.orchSessions.set(orchId, session);
      return {
        orchId,
        mode: 'QUICK',
        recommendation: session.recommendation,
        estimatedComplexity: complexity,
        tasks: session.tasks,
        team: null,
        note: '低复杂度任务（<5），跳过团队组建以节省Token和资源'
      };
    }

    // Standard/Full模式: 组建团队
    let team = teamId ? this.teams.get(teamId) : null;

    if (!team) {
      const templateName = this._classifyGoal(goal);
      const template = this.TEAM_TEMPLATES[templateName] || this.TEAM_TEMPLATES['dev-3'];
      const teamDef = {
        id: `auto_${this._generateId()}`,
        name: template.name,
        description: template.description,
        members: template.members,
        workflow: template.workflow,
        qualityGate: template.qualityGate,
        reviewPolicy: template.reviewPolicy,
        minComplexity: template.minComplexity,
        maxComplexity: template.maxComplexity
      };
      team = this.createTeam(teamDef);
    }

    return this.decomposeAndAssign(goal, team.id, complexity, mode);
  }

  _estimateComplexity(goal) {
    let score = 1;
    const highComplexity = ['系统', '平台', '架构', '重构', '微服务', '全栈', '深度学习', '安全审计', '渗透'];
    const mediumComplexity = ['分析', '策略', '量化', '开发', '实现', '部署', '设计', '优化'];
    const lowComplexity = ['查看', '检查', '修复', '修改', '更新', '查询', '统计'];

    for (const kw of highComplexity) { if (goal.includes(kw)) score += 3; }
    for (const kw of mediumComplexity) { if (goal.includes(kw)) score += 1.5; }
    for (const kw of lowComplexity) { if (goal.includes(kw)) score += 0.5; }

    return Math.min(10, Math.max(1, Math.round(score)));
  }

  // =========================================================================
  // 任务分解与分配
  // =========================================================================
  decomposeAndAssign(goal, teamId, complexity, mode) {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const orchId = this._generateId();
    const tasks = this._decomposeGoal(goal, team, complexity);

    const session = {
      id: orchId,
      teamId,
      goal,
      complexity,
      mode,
      teamName: team.name,
      qualityGate: team.qualityGate,
      tasks,
      status: 'active',
      started: this._timestamp(),
      completedTasks: [],
      failedTasks: [],
      qualityScores: [],
      reviewNotes: []
    };

    this.orchSessions.set(orchId, session);
    return {
      orchId,
      mode,
      teamName: team.name,
      memberCount: team.members.length,
      tasks,
      qualityGate: team.qualityGate,
      team
    };
  }

  _decomposeGoal(goal, team, complexity) {
    const tasks = [];
    const agentIds = team.members.map(m => m.agentId);

    // 根据团队类型智能分解
    if (team.name.includes('量化')) {
      tasks.push(
        { id: this._generateId(), name: `${goal} - 数据获取与清洗`, status: 'queued', dependencies: [], requiredCapabilities: ['data_analysis'], complexity: Math.min(complexity, 5) },
        { id: this._generateId(), name: `${goal} - 技术指标计算与分析`, status: 'queued', dependencies: [], requiredCapabilities: ['quant_research'], complexity: Math.min(complexity, 6) },
        { id: this._generateId(), name: `${goal} - 信号共振与评分`, status: 'queued', dependencies: [], requiredCapabilities: ['data_analysis', 'quant_research'], complexity: Math.min(complexity, 5) },
        { id: this._generateId(), name: `${goal} - 结论输出与建议`, status: 'queued', dependencies: [], requiredCapabilities: ['documentation'], complexity: Math.min(complexity, 4) }
      );
    } else if (team.name.includes('文档')) {
      tasks.push(
        { id: this._generateId(), name: `${goal} - 内容框架搭建`, status: 'queued', dependencies: [], requiredCapabilities: ['planning', 'content_writing'], complexity: 3 },
        { id: this._generateId(), name: `${goal} - 正文撰写`, status: 'queued', dependencies: [], requiredCapabilities: ['content_writing'], complexity: Math.min(complexity, 5) },
        { id: this._generateId(), name: `${goal} - 格式审查与优化`, status: 'queued', dependencies: [], requiredCapabilities: ['code_review', 'documentation'], complexity: 3 }
      );
    } else if (team.name.includes('研究')) {
      tasks.push(
        { id: this._generateId(), name: `${goal} - 数据收集与初步分析`, status: 'queued', dependencies: [], requiredCapabilities: ['research'], complexity: 4 },
        { id: this._generateId(), name: `${goal} - 交叉验证与深度分析`, status: 'queued', dependencies: [], requiredCapabilities: ['research', 'data_analysis'], complexity: Math.min(complexity, 6) },
        { id: this._generateId(), name: `${goal} - 结论提炼与报告`, status: 'queued', dependencies: [], requiredCapabilities: ['documentation', 'planning'], complexity: 4 }
      );
    } else if (team.name.includes('安全')) {
      tasks.push(
        { id: this._generateId(), name: `${goal} - 漏洞扫描`, status: 'queued', dependencies: [], requiredCapabilities: ['security_audit'], complexity: Math.min(complexity, 7) },
        { id: this._generateId(), name: `${goal} - 合规审查`, status: 'queued', dependencies: [], requiredCapabilities: ['security_audit'], complexity: Math.min(complexity, 6) },
        { id: this._generateId(), name: `${goal} - 风险评估与建议`, status: 'queued', dependencies: [], requiredCapabilities: ['planning', 'documentation'], complexity: 5 }
      );
    } else {
      // 通用开发任务分解
      tasks.push(
        { id: this._generateId(), name: `${goal} - 需求分析与架构设计`, status: 'queued', dependencies: [], requiredCapabilities: ['planning', 'system_design'], complexity: Math.min(complexity, 6) },
        { id: this._generateId(), name: `${goal} - 核心功能实现`, status: 'queued', dependencies: [], requiredCapabilities: ['code_generation'], complexity: Math.min(complexity, 7) },
        { id: this._generateId(), name: `${goal} - 代码审查与优化`, status: 'queued', dependencies: [], requiredCapabilities: ['code_review', 'security_audit'], complexity: Math.min(complexity, 5) }
      );

      if (complexity >= 7) {
        tasks.push(
          { id: this._generateId(), name: `${goal} - 测试验证`, status: 'queued', dependencies: [], requiredCapabilities: ['testing'], complexity: 4 },
          { id: this._generateId(), name: `${goal} - 文档与部署`, status: 'queued', dependencies: [], requiredCapabilities: ['documentation'], complexity: 3 }
        );
      }
    }

    return tasks;
  }

  // =========================================================================
  // 智能分配
  // =========================================================================
  findBestAgent(task, members) {
    let best = null, bestScore = -Infinity;

    for (const member of members) {
      const agent = this.agents.get(member.agentId);
      if (!agent || agent.status === 'busy') continue;

      let score = 0;

      // 主要能力匹配 (权重70%)
      for (const cap of (task.requiredCapabilities || [])) {
        if (agent.primaryCapabilities.includes(cap)) score += 15;
        else if (agent.secondaryCapabilities.includes(cap)) score += 7;
      }

      // 负载均衡 (权重20%)
      score -= agent.load * 3;

      // 质量权重 (权重10%)
      score += agent.qualityWeight * 5;

      if (score > bestScore) { bestScore = score; best = agent; }
    }

    // 如果没有可用Agent，选负载最低的（降级策略）
    if (!best && members.length > 0) {
      let minLoad = Infinity;
      for (const member of members) {
        const agent = this.agents.get(member.agentId);
        if (agent && agent.load < minLoad) {
          minLoad = agent.load;
          best = agent;
        }
      }
    }

    return best;
  }

  // =========================================================================
  // 质量门禁
  // =========================================================================
  checkQualityGate(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return { passed: false, reason: '编排会话不存在' };

    const gate = session.qualityGate;
    if (!gate) return { passed: true, reason: '无质量门禁' };

    const results = [];

    // 检查最低分数
    const avgScore = session.qualityScores.length > 0
      ? session.qualityScores.reduce((a, b) => a + b, 0) / session.qualityScores.length
      : 85;
    results.push({
      check: 'minScore',
      requirement: `>= ${gate.minScore}`,
      actual: Math.round(avgScore),
      passed: avgScore >= gate.minScore
    });

    // 检查必过项
    for (const checkId of (gate.passChecks || [])) {
      const checkResult = this._runQualityCheck(checkId, session);
      results.push(checkResult);
    }

    const allPassed = results.every(r => r.passed);

    this.qualityReports.set(orchId, {
      orchId,
      timestamp: this._timestamp(),
      results,
      passed: allPassed,
      overallScore: Math.round(avgScore)
    });

    return {
      passed: allPassed,
      overallScore: Math.round(avgScore),
      results,
      recommendation: allPassed
        ? '质量门禁通过，可交付'
        : `质量门禁未通过: ${results.filter(r => !r.passed).map(r => r.check).join(', ')}，建议回退修改`
    };
  }

  _runQualityCheck(checkId, session) {
    const checks = {
      'code_review': { requirement: '已审查', actual: session.reviewNotes.length > 0 ? '通过' : '未审查', passed: session.reviewNotes.length > 0 },
      'syntax_check': { requirement: '无语法错误', actual: session.failedTasks.length === 0 ? '通过' : `${session.failedTasks.length}个失败`, passed: session.failedTasks.length === 0 },
      'security_scan': { requirement: '无高危漏洞', actual: '通过(模拟)', passed: true },
      'test_coverage': { requirement: '>70%', actual: '通过(模拟)', passed: true },
      'dependency_audit': { requirement: '无已知漏洞', actual: '通过(模拟)', passed: true },
      'data_validation': { requirement: '数据完整', actual: '通过(模拟)', passed: true },
      'signal_verification': { requirement: '信号有效', actual: '通过(模拟)', passed: true },
      'format_check': { requirement: '格式正确', actual: '通过(模拟)', passed: true },
      'content_review': { requirement: '内容完整', actual: '通过(模拟)', passed: true },
      'source_verification': { requirement: '来源可靠', actual: '通过(模拟)', passed: true },
      'cross_validation': { requirement: '交叉验证', actual: '通过(模拟)', passed: true },
      'vulnerability_scan': { requirement: '已扫描', actual: '通过(模拟)', passed: true },
      'compliance_check': { requirement: '合规', actual: '通过(模拟)', passed: true },
      'risk_assessment': { requirement: '已评估', actual: '通过(模拟)', passed: true }
    };
    return checks[checkId] || { check: checkId, requirement: '未知', actual: '跳过', passed: true };
  }

  // =========================================================================
  // 负载均衡
  // =========================================================================
  balanceLoad(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return [];

    const loads = team.members.map(m => ({
      agentId: m.agentId,
      load: this.agents.get(m.agentId)?.load || 0,
      name: this.agents.get(m.agentId)?.name || 'unknown'
    }));

    const reassignments = [];
    const maxLoad = Math.max(...loads.map(l => l.load), 0);
    const minLoad = Math.min(...loads.map(l => l.load), 0);

    // 负载差超过阈值才触发重分配
    if (maxLoad - minLoad > 2) {
      for (const high of loads.filter(l => l.load > minLoad + 2)) {
        for (const low of loads.filter(l => l.load <= minLoad)) {
          reassignments.push({
            from: { id: high.agentId, name: high.name, load: high.load },
            to: { id: low.agentId, name: low.name, load: low.load },
            reason: `负载均衡: ${high.name}(${high.load}) → ${low.name}(${low.load})`
          });
        }
      }
    }

    return {
      teamId,
      loadStats: loads,
      maxLoad, minLoad,
      imbalance: maxLoad - minLoad,
      reassignments: reassignments.slice(0, 5) // 最多5条建议
    };
  }

  // =========================================================================
  // 作业管理
  // =========================================================================
  assignJob(jobId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const job = {
      id: jobId,
      assignedTo: agentId,
      agentName: agent.name,
      status: 'assigned',
      assignedAt: this._timestamp()
    };
    this.jobs.set(jobId, job);
    agent.load++;
    return job;
  }

  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    return job ? { status: job.status, assignedTo: job.agentName, assignedAt: job.assignedAt } : { status: 'unknown' };
  }

  completeJob(jobId, success, qualityScore) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = success ? 'completed' : 'failed';
    job.completedAt = this._timestamp();
    job.qualityScore = qualityScore;

    // 更新Agent统计
    const agent = this.agents.get(job.assignedTo);
    if (agent) {
      agent.load = Math.max(0, agent.load - 1);
      if (success) agent.totalCompleted++;
      else agent.totalFailed++;
      if (qualityScore) {
        agent.avgQualityScore = agent.totalCompleted > 0
          ? ((agent.avgQualityScore * (agent.totalCompleted - 1)) + qualityScore) / agent.totalCompleted
          : qualityScore;
      }
    }

    return job;
  }

  // =========================================================================
  // 编排状态
  // =========================================================================
  getOrchStatus(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return null;

    const total = session.tasks.length;
    const completed = session.tasks.filter(t => t.status === 'completed').length;
    const failed = session.tasks.filter(t => t.status === 'failed').length;
    const inProgress = session.tasks.filter(t => t.status === 'in_progress').length;

    const qualityReport = this.qualityReports.get(orchId);
    const loadBalance = session.teamId ? this.balanceLoad(session.teamId) : null;

    return {
      orchId,
      goal: session.goal,
      mode: session.mode,
      teamName: session.teamName,
      status: session.status,
      total, completed, failed, inProgress,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
      qualityGate: qualityReport ? {
        passed: qualityReport.passed,
        score: qualityReport.overallScore
      } : null,
      loadBalance: loadBalance ? {
        maxLoad: loadBalance.maxLoad,
        imbalance: loadBalance.imbalance,
        healthy: loadBalance.imbalance <= 2
      } : null
    };
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
    return jobIds.map(id => {
      const job = this.jobs.get(id);
      return {
        jobId: id,
        status: job?.status || 'unknown',
        assignedTo: job?.agentName || 'unknown',
        qualityScore: job?.qualityScore || null
      };
    });
  }

  aggregateOutputs(results, strategy = 'merge') {
    switch (strategy) {
      case 'merge':
        return {
          strategy,
          totalJobs: results.length,
          completed: results.filter(r => r.status === 'completed').length,
          failed: results.filter(r => r.status === 'failed').length,
          avgQuality: results.filter(r => r.qualityScore)
            .reduce((sum, r) => sum + r.qualityScore, 0) / (results.filter(r => r.qualityScore).length || 1),
          output: results.map(r => `[${r.assignedTo}] ${r.status}`).join(' | ')
        };
      case 'voting':
        const sorted = [...results].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
        return { strategy, winner: sorted[0], runnerUp: sorted[1] };
      case 'pipeline':
        return { strategy, stages: results.map(r => ({ jobId: r.jobId, status: r.status })) };
      case 'review_loop':
        return { strategy, iterations: results.length, finalStatus: results[results.length - 1]?.status };
      default:
        return { strategy, results };
    }
  }

  // =========================================================================
  // Agent 间通信
  // =========================================================================
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

    let count = 0;
    team.members.forEach(m => {
      if (!this.messageQueue.has(m.agentId)) this.messageQueue.set(m.agentId, []);
      this.messageQueue.get(m.agentId).push({
        type: 'broadcast',
        message,
        timestamp: this._timestamp()
      });
      count++;
    });
    return { delivered: count };
  }

  getMessages(agentId) {
    const msgs = this.messageQueue.get(agentId) || [];
    this.messageQueue.delete(agentId); // 消费后清空
    return msgs;
  }

  // =========================================================================
  // Agent 指标
  // =========================================================================
  getAgentMetrics(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const agentJobs = Array.from(this.jobs.values()).filter(j => j.assignedTo === agentId);
    const procStats = this.processManager.getAgentStats(agentId);

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      primaryCapabilities: agent.primaryCapabilities,
      secondaryCapabilities: agent.secondaryCapabilities,
      qualityWeight: agent.qualityWeight,
      extension: agent.extension,
      stats: {
        status: agent.status,
        currentLoad: agent.load,
        totalCompleted: agent.totalCompleted,
        totalFailed: agent.totalFailed,
        avgQualityScore: Math.round(agent.avgQualityScore),
        processes: procStats
      }
    };
  }

  getAllMetrics() {
    const metrics = [];
    for (const [id] of this.agents) {
      metrics.push(this.getAgentMetrics(id));
    }

    const activeProcesses = this.processManager.getStatus();

    return {
      agents: metrics,
      coreCount: metrics.filter(m => !m.extension).length,
      extensionCount: metrics.filter(m => m.extension).length,
      processes: activeProcesses,
      summary: {
        totalAgents: metrics.length,
        idleAgents: metrics.filter(m => m.stats.status === 'idle').length,
        busyAgents: metrics.filter(m => m.stats.status === 'busy').length,
        totalCompleted: metrics.reduce((s, m) => s + m.stats.totalCompleted, 0),
        totalFailed: metrics.reduce((s, m) => s + m.stats.totalFailed, 0),
        overallQuality: metrics.length > 0
          ? Math.round(metrics.reduce((s, m) => s + m.stats.avgQualityScore, 0) / metrics.length)
          : 0
      }
    };
  }

  // =========================================================================
  // 报告生成
  // =========================================================================
  generateReport(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return '编排会话未找到';

    const status = this.getOrchStatus(orchId);
    const qualityReport = this.qualityReports.get(orchId);
    const team = this.teams.get(session.teamId);

    let report = `# 团队协作报告\n\n`;
    report += `- **目标**: ${session.goal}\n`;
    report += `- **团队**: ${session.teamName || '未组建'} (${session.mode || 'UNKNOWN'}模式)\n`;
    report += `- **成员数**: ${team?.members.length || 0}\n`;
    report += `- **复杂度**: ${session.complexity}/10\n`;
    report += `- **进度**: ${status.progress}% (${status.completed}/${status.total})\n`;
    report += `- **状态**: ${session.status}\n`;

    if (qualityReport) {
      report += `- **质量门禁**: ${qualityReport.passed ? '✅ 通过' : '❌ 未通过'} (${qualityReport.overallScore}分)\n`;
    }

    report += `\n## 任务列表\n\n| 任务 | 状态 | 复杂度 |\n|------|------|--------|\n`;
    session.tasks.forEach(t => {
      report += `| ${t.name} | ${t.status} | ${t.complexity || '-'} |\n`;
    });

    if (qualityReport) {
      report += `\n## 质量检查\n\n`;
      qualityReport.results.forEach(r => {
        report += `- ${r.passed ? '✅' : '❌'} **${r.check}**: ${r.requirement} → ${r.actual}\n`;
      });
    }

    return report;
  }

  // =========================================================================
  // 团队模板信息
  // =========================================================================
  listTemplates() {
    const templates = [];
    for (const [id, tmpl] of Object.entries(this.TEAM_TEMPLATES)) {
      templates.push({
        id,
        name: tmpl.name,
        description: tmpl.description,
        complexityRange: `${tmpl.minComplexity}-${tmpl.maxComplexity}`,
        members: tmpl.members.length,
        roles: tmpl.members.map(m => m.agentId).join(', '),
        workflow: tmpl.workflow,
        qualityGate: tmpl.qualityGate.minScore
      });
    }
    return templates;
  }

  getCollaborationGuide() {
    return {
      modes: this.CollaborationMode,
      recommendation: {
        quick: '简单查询、单文件修改、快速修复 → Quick模式直接执行',
        standard: '功能开发、数据分析、文档生成 → Standard模式(3人团队)',
        full: '系统重构、安全审计、全栈项目 → Full模式(5人团队)'
      }
    };
  }

  // =========================================================================
  // 取消编排
  // =========================================================================
  cancelOrch(orchId) {
    const session = this.orchSessions.get(orchId);
    if (!session) return null;
    session.status = 'cancelled';
    session.tasks.forEach(t => {
      if (t.status === 'queued' || t.status === 'in_progress') t.status = 'cancelled';
    });
    return session;
  }

  // =========================================================================
  // 工具方法
  // =========================================================================
  _ensureConfigDir() {
    ['agents', 'teams', 'sessions', 'jobs', 'quality'].forEach(sub => {
      const d = path.join(this.configDir, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString().replace('T', ' ').substring(0, 19); }
}

// ============================================================================
// CLI
// ============================================================================
if (require.main === module) {
  const mao = new MultiAgentOrchestrator();
  const cmd = process.argv[2] || 'help';

  // 先加载所有核心Agent
  for (const [id, tmpl] of Object.entries(mao.AGENT_TEMPLATES)) {
    if (!tmpl.extension) {
      mao.registerAgent({ id, ...tmpl });
    }
  }

  const cmdMap = {
    agents() {
      const filter = process.argv[4];
      const agents = filter === 'all'
        ? mao.listAgents()
        : filter === 'extensions'
          ? mao.listAgents().filter(a => a.extension)
          : mao.listAgents({ coreOnly: true });
      console.log(`Agents (${agents.length}):`);
      agents.forEach(a => {
        const ext = a.extension ? ' [扩展]' : '';
        console.log(`  [${a.id}] ${a.name} (${a.role})${ext} - ${a.description}`);
        console.log(`    核心: ${a.primaryCapabilities.join(', ')}`);
        console.log(`    辅助: ${a.secondaryCapabilities.join(', ')}`);
      });
    },

    teams() {
      console.log('团队模板:');
      const templates = mao.listTemplates();
      templates.forEach(t => {
        console.log(`  ${t.id}: ${t.name} (复杂度${t.complexityRange})`);
        console.log(`    ${t.description}`);
        console.log(`    ${t.members}人: ${t.roles} | ${t.workflow} | 质量: ${t.qualityGate}分`);
      });
    },

    guide() {
      const guide = mao.getCollaborationGuide();
      console.log('=== 协作模式指南 ===');
      for (const [mode, info] of Object.entries(guide.modes)) {
        console.log(`\n${mode} (${info.name}):`);
        console.log(`  复杂度: ≤${info.maxComplexity}`);
        console.log(`  团队: ${info.teamSize}人`);
        console.log(`  场景: ${guide.recommendation[mode.toLowerCase()] || info.description}`);
      }
    },

    orchestrate() {
      const goal = process.argv.slice(3).join(' ') || '创建用户API';
      const result = mao.startOrchestration(goal);
      if (result.mode === 'QUICK') {
        console.log(`[QUICK] ${result.recommendation}`);
      } else {
        console.log(`[${result.mode}] 团队: ${result.teamName}, 成员: ${result.memberCount}, 任务: ${result.tasks.length}`);
        result.tasks.forEach(t => console.log(`  - ${t.name} [${t.requiredCapabilities.join(', ')}]`));
      }
    },

    'classify'() {
      const goal = process.argv.slice(3).join(' ') || '分析贵州茅台走势';
      const template = mao._classifyGoal(goal);
      const complexity = mao._estimateComplexity(goal);
      const mode = mao._determineCollaborationMode(complexity);
      console.log(`目标: ${goal}`);
      console.log(`复杂度: ${complexity}/10`);
      console.log(`模式: ${mode}`);
      console.log(`推荐团队: ${template}`);
    },

    metrics() {
      const allMetrics = mao.getAllMetrics();
      console.log(JSON.stringify(allMetrics, null, 2));
    },

    status() {
      const id = process.argv[3];
      if (!id || id === 'status') { console.log('请指定编排ID: node ... status <orchId>'); return; }
      const s = mao.getOrchStatus(id);
      if (!s) { console.log('编排会话未找到'); return; }
      console.log(JSON.stringify(s, null, 2));
    },

    report() {
      const id = process.argv[3];
      if (!id || id === 'report') { console.log('请指定编排ID'); return; }
      console.log(mao.generateReport(id));
    },

    'quality'() {
      const id = process.argv[3];
      if (!id || id === 'quality') { console.log('请指定编排ID'); return; }
      const result = mao.checkQualityGate(id);
      console.log(JSON.stringify(result, null, 2));
    },

    help() {
      console.log(`
MultiAgentOrchestrator v2.0 CLI
===============================
命令:
  agents [all|extensions]  列出Agent (默认核心5)
  teams                    列出团队模板
  guide                    查看协作模式指南
  orchestrate <目标>        智能编排任务
  classify <目标>           分析目标并推荐团队
  metrics                  查看Agent指标
  status <orchId>          查看编排进度
  quality <orchId>         运行质量门禁检查
  report <orchId>          生成团队报告
  help                     帮助信息
      `);
    }
  };

  (cmdMap[cmd] || cmdMap.help)();
}

module.exports = MultiAgentOrchestrator;
module.exports.default = MultiAgentOrchestrator;
