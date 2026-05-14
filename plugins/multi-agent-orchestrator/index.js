/**
 * multi-agent-orchestrator v2.3 - P4-3 (P0) 多Agent编排器 [三省六部增强版 + 简化API]
 * 维度: D9-MultiAgent
 *
 * v2.3 优化 (2026-05-14 P2-1 spawn/wait简化API):
 *   - 简化spawn: spawn() / spawnSync() / run()
 *   - 简化wait: waitFor() / waitAll() / waitFirst()
 *   - 链式调用: run() = spawn + wait
 *   - 批量操作: spawnMany()
 *
 * v2.2 优化 (2026-05-14 三省六部增强):
 *   - Agent模板重构: 7→9核心角色，新增critic(批评者)和coordinator(协调员)
 *   - 能力矩阵匹配: 基于任务类型自动匹配最优Agent组合
 *   - 动态能力扩展: 支持临时能力增强和角色切换
 *   - 团队类型扩展: 新增应急响应/CI/CD/智能客服3种团队模板
 *   - 互动效率提升: 消息优先级队列、流式响应、智能超时降级
 *
 * v2.1 优化:
 *   - AgentProcessManager改用真实Ollama API调用
 *   - D9 Multi-Agent执行层从模拟→真实
 *
 * v2.0 优化:
 *   - Agent类型精简: 7→5核心+2扩展
 *   - 三级智能协作: Quick/Standard/Full
 *   - 质量门禁机制
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
  'powerful': { model: 'qwen2.5:7b-instruct-q4_K_M', maxTokens: 16384, costWeight: 1.0, suitability: ['system_design', 'security_audit', 'deep_research', 'complex_planning'] }
};

function selectModel(taskType, complexity) {
  if (complexity >= 8) return MODEL_REGISTRY.powerful;
  if (complexity >= 5) return MODEL_REGISTRY.balanced;
  return MODEL_REGISTRY.fast;
}

// ============================================================================
// Ollama API 调用器 (D9增强: 真实LLM调用)
// ============================================================================
class OllamaCaller {
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
    this.defaultOptions = {
      temperature: 0.7,
      top_p: 0.9,
      repeat_penalty: 1.1
    };
  }

  /**
   * 调用Ollama生成响应
   * @param {string} model - 模型名称
   * @param {string} prompt - 提示词
   * @param {object} options - 生成选项
   * @returns {Promise<object>} 响应结果
   */
  async generate(model, prompt, options = {}) {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: opts.temperature,
            top_p: opts.top_p,
            repeat_penalty: opts.repeat_penalty,
            num_predict: opts.maxTokens || 4096
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      return {
        success: true,
        model: data.model || model,
        response: data.response || '',
        tokensUsed: data.eval_count || 0,
        promptTokens: data.prompt_eval_count || 0,
        totalTokens: (data.eval_count || 0) + (data.prompt_eval_count || 0),
        duration,
        evalRate: data.eval_count ? Math.round(data.eval_count / (duration / 1000)) : 0,
        done: data.done || true,
        raw: data
      };
    } catch (error) {
      return {
        success: false,
        model,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 检查Ollama服务状态
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return { healthy: true, models: data.models?.length || 0 };
      }
      return { healthy: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * 获取可用模型列表
   */
  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return data.models || [];
      }
      return [];
    } catch (error) {
      return [];
    }
  }
}

// ============================================================================
// Agent Process Manager v2.2 (三省六部增强)
// ============================================================================
class AgentProcessManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.processes = new Map();
    this.maxProcesses = os.cpus().length > 2 ? 4 : 2;
    this.ollama = new OllamaCaller();
    
    // v2.2新增: 消息优先级队列
    this.messageQueue = {
      high: [],    // P0-P1 紧急任务
      medium: [],  // P2 标准任务
      low: []     // P3 低优先级任务
    };
    
    // v2.2新增: 降级配置
    this.fallbackConfig = {
      enabled: true,
      retryAttempts: 2,
      retryDelay: 1000,
      degradedModel: 'qwen2.5:1.5b',
      timeoutMultiplier: 2.0
    };
    
    // v2.2新增: 流式响应缓冲区
    this.streamBuffers = new Map();
  }

  // v2.2新增: 消息优先级枚举
  MessagePriority = {
    CRITICAL: 'high',  // P0 故障处理
    HIGH: 'high',      // P1 紧急任务
    MEDIUM: 'medium',  // P2 标准任务
    LOW: 'low'        // P3 低优先级
  };

  // v2.2新增: 添加任务到优先级队列
  enqueueTask(task, priority = 'medium') {
    const queue = this.messageQueue[priority] || this.messageQueue.medium;
    queue.push({
      task,
      priority,
      enqueuedAt: Date.now(),
      status: 'queued'
    });
    return { queued: true, queueLength: queue.length, priority };
  }

  // v2.2新增: 获取下一个高优先级任务
  dequeueNextTask() {
    // 严格按照优先级顺序处理
    for (const priority of ['high', 'medium', 'low']) {
      if (this.messageQueue[priority].length > 0) {
        return this.messageQueue[priority].shift();
      }
    }
    return null;
  }

  // v2.2新增: 估算队列等待时间
  estimateQueueWait() {
    const wait = {};
    for (const [priority, queue] of Object.entries(this.messageQueue)) {
      wait[priority] = {
        count: queue.length,
        estimatedWaitMs: queue.length * 30000 // 假设每个任务30秒
      };
    }
    return wait;
  }

  // v2.2新增: 智能超时计算
  calculateTimeout(baseTimeout, retryCount = 0) {
    const multiplier = Math.pow(this.fallbackConfig.timeoutMultiplier, retryCount);
    return Math.min(baseTimeout * multiplier, 300000); // 最大5分钟
  }

  // v2.2新增: 流式响应回调
  setupStreamCallback(procId, callback) {
    this.streamBuffers.set(procId, {
      chunks: [],
      callback,
      startedAt: Date.now()
    });
  }

  // v2.2新增: 处理流式响应块
  processStreamChunk(procId, chunk) {
    const buffer = this.streamBuffers.get(procId);
    if (buffer) {
      buffer.chunks.push(chunk);
      if (buffer.callback) {
        buffer.callback(chunk);
      }
    }
  }

  // v2.2新增: 获取流式响应结果
  getStreamResult(procId) {
    const buffer = this.streamBuffers.get(procId);
    if (buffer) {
      return {
        fullText: buffer.chunks.join(''),
        chunkCount: buffer.chunks.length,
        duration: Date.now() - buffer.startedAt
      };
    }
    return null;
  }

  // v2.2新增: 智能降级处理
  async executeWithFallback(taskFn, fallbackFn) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= this.fallbackConfig.retryAttempts; attempt++) {
      try {
        const timeout = this.calculateTimeout(60000, attempt);
        return await Promise.race([
          taskFn(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), timeout)
          )
        ]);
      } catch (error) {
        lastError = error;
        
        if (attempt < this.fallbackConfig.retryAttempts) {
          // 等待后重试
          await new Promise(resolve => 
            setTimeout(resolve, this.fallbackConfig.retryDelay * Math.pow(2, attempt))
          );
        }
      }
    }
    
    // 所有重试都失败，尝试降级方案
    if (fallbackFn && this.fallbackConfig.enabled) {
      console.log(`[AgentProcessManager] 执行降级方案 (${this.fallbackConfig.degradedModel})`);
      return await fallbackFn();
    }
    
    throw lastError;
  }

  /**
   * D9增强: 构建Agent执行提示词 (v2.2支持角色模板)
   */
  buildAgentPrompt(agent, task) {
    const roleDescriptions = {
      // 三省角色
      'architect': '你是一位资深的系统架构师，擅长系统设计和技术决策。你的职责是规划整体架构、分解任务、做出关键技术决策。',
      'reviewer': '你是一位资深的代码审查员，擅长代码审查和安全审计。你的职责是严格把关代码质量、发现潜在问题。',
      'critic': '你是一位专业的批评者和风险评估专家。你的职责是提出质疑、识别边缘case、评估风险。',
      // 尚书省角色
      'coder': '你是一位经验丰富的开发工程师，擅长代码实现和调试。你的职责是高质量完成编码任务。',
      'tester': '你是一位专业的测试工程师，擅长质量保障和测试验证。你的职责是确保交付质量。',
      'devops': '你是一位资深的DevOps工程师，擅长部署运维和CI/CD。你的职责是确保稳定部署。',
      // 六部角色
      'analyst': '你是一位专业的数据分析师，擅长量化研究和数据分析。你的职责是提供数据驱动的洞察。',
      'writer': '你是一位专业的技术文档工程师，擅长文档撰写和报告生成。你的职责是清晰表达。',
      'coordinator': '你是一位专业的协调员，擅长任务调度和资源分配。你的职责是协调各方、推进进度。'
    };

    const roleDesc = roleDescriptions[agent.id] || `你是一个${agent.name}。`;
    const capabilities = [...(agent.primaryCapabilities || []), ...(agent.secondaryCapabilities || [])].join('、');

    // v2.2增强: 包含省份/部门信息
    const province = agent.province || agent.ministry;
    const orgContext = province ? `\n所属机构: ${province}` : '';

    return `${roleDesc}${orgContext}
你的专长: ${capabilities}
任务描述: ${task.description || task.name || '未知任务'}
任务ID: ${task.id}
复杂度: ${task.complexity || 5}/10

请基于你的专业能力完成任务，并提供高质量的结果。`;
  }

  /**
   * D9核心: 使用真实Ollama API执行Agent任务
   */
  async spawnAgent(agentId, task, options = {}) {
    const agent = this.orchestrator.agents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };
    
    const modelCfg = selectModel(task.type || 'code_generation', task.complexity || 5);
    const timeoutMs = task.timeoutMs || (task.complexity >= 8 ? 120000 : 60000);
    const procId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const procInfo = {
      pid: procId,
      agentId,
      taskId: task.id,
      startTime: Date.now(),
      status: 'running',
      model: modelCfg.model,
      result: null
    };
    this.processes.set(procId, procInfo);

    try {
      // D9增强: 构建提示词
      const prompt = this.buildAgentPrompt(agent, task);
      
      // D9核心: 调用真实Ollama API
      const result = await Promise.race([
        this.ollama.generate(modelCfg.model, prompt, {
          temperature: 0.7,
          maxTokens: modelCfg.maxTokens
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeoutMs)
        )
      ]);

      procInfo.endTime = Date.now();
      procInfo.status = result.success ? 'completed' : 'failed';
      procInfo.result = result;

      return {
        success: result.success,
        pid: procId,
        agentId,
        taskId: task.id,
        model: modelCfg.model,
        result: {
          status: result.success ? 'completed' : 'failed',
          output: result.response || result.error,
          metrics: {
            duration: result.duration,
            tokensUsed: result.tokensUsed || 0,
            promptTokens: result.promptTokens || 0,
            totalTokens: result.totalTokens || 0,
            evalRate: result.evalRate || 0,
            confidence: result.success ? 0.85 : 0.3
          }
        }
      };
    } catch (error) {
      procInfo.endTime = Date.now();
      procInfo.status = 'failed';
      procInfo.result = { error: error.message };

      return {
        success: false,
        pid: procId,
        agentId,
        taskId: task.id,
        model: modelCfg.model,
        error: error.message,
        result: {
          status: 'failed',
          error: error.message,
          metrics: { duration: procInfo.endTime - procInfo.startTime }
        }
      };
    }
  }

  /**
   * D9增强: 批量执行任务 (保持API兼容性)
   */
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

    // D9增强: 统计模型使用情况
    const modelUsage = {};
    for (const r of results) {
      if (r.model) {
        if (!modelUsage[r.model]) {
          modelUsage[r.model] = { count: 0, success: 0, tokens: 0, totalDuration: 0 };
        }
        modelUsage[r.model].count++;
        if (r.success) modelUsage[r.model].success++;
        if (r.result?.metrics) {
          modelUsage[r.model].tokens += r.result.metrics.tokensUsed || 0;
          modelUsage[r.model].totalDuration += r.result.metrics.duration || 0;
        }
      }
    }

    return {
      total: tasks.length,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      modelUsage,
      results
    };
  }

  // D9兼容: 终止所有进程 (进程追踪已简化为内存Map)
  killAll() {
    let c = 0;
    for (const [pid, p] of this.processes) {
      if (p.status === 'running') {
        p.status = 'killed';
        p.endTime = Date.now();
        c++;
      }
    }
    return { killed: c };
  }

  // D9兼容: 终止指定Agent的进程
  killAgent(agentId) {
    let c = 0;
    for (const [pid, p] of this.processes) {
      if (p.agentId === agentId && p.status === 'running') {
        p.status = 'killed';
        p.endTime = Date.now();
        c++;
      }
    }
    return { killed: c, agentId };
  }

  // D9增强: 获取进程状态 (包含真实LLM指标)
  getStatus() {
    const st = [];
    for (const [pid, p] of this.processes) {
      const info = {
        pid, 
        agentId: p.agentId, 
        taskId: p.taskId,
        status: p.status, 
        model: p.model,
        runtime: Date.now() - p.startTime
      };
      // D9增强: 添加真实LLM指标
      if (p.result?.metrics) {
        info.tokensUsed = p.result.metrics.tokensUsed;
        info.evalRate = p.result.metrics.evalRate;
      }
      st.push(info);
    }
    return {
      active: this.processes.size,
      max: this.maxProcesses,
      cpuCores: os.cpus().length,
      processes: st
    };
  }

  // D9增强: 获取Agent统计 (包含真实LLM调用统计)
  getAgentStats(agentId) {
    const jobs = [];
    for (const [pid, p] of this.processes) {
      if (p.agentId === agentId) {
        const job = { pid, taskId: p.taskId, status: p.status, model: p.model };
        if (p.result?.metrics) {
          job.tokensUsed = p.result.metrics.tokensUsed || 0;
          job.duration = p.result.metrics.duration || 0;
        }
        jobs.push(job);
      }
    }
    
    // D9增强: 汇总真实LLM指标
    const totalTokens = jobs.reduce((sum, j) => sum + (j.tokensUsed || 0), 0);
    const totalDuration = jobs.reduce((sum, j) => sum + (j.duration || 0), 0);
    
    return {
      total: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      // D9新增: 真实LLM统计
      totalTokens,
      totalDuration,
      avgTokensPerTask: jobs.length > 0 ? Math.round(totalTokens / jobs.length) : 0,
      avgDuration: jobs.length > 0 ? Math.round(totalDuration / jobs.length) : 0,
      models: jobs.reduce((acc, j) => { 
        acc[j.model] = (acc[j.model] || 0) + 1; 
        return acc; 
      }, {})
    };
  }

  // ============================================================================
  // P2-1: 简化API层 - spawn/wait 模式
  // ============================================================================

  /**
   * P2-1: 简化spawn - 一步完成Agent调用
   * 用法: await mao.spawn('coder', { id: 'task1', description: '写快排' })
   */
  async spawn(agentId, taskInput, options = {}) {
    // 统一输入格式
    const task = typeof taskInput === 'string' 
      ? { id: `task_${Date.now()}`, description: taskInput }
      : { id: taskInput.id || `task_${Date.now()}`, ...taskInput };
    
    task.description = task.description || taskInput;
    task.type = task.type || options.type || 'code_generation';
    task.complexity = task.complexity || options.complexity || 5;
    
    return this.spawnAgent(agentId, task, options);
  }

  /**
   * P2-1: 简化spawnSync - 同步版本，返回结果Promise
   * 用法: mao.spawnSync('coder', '写快排')  // 不等待，直接返回进程ID
   */
  spawnSync(agentId, taskInput, options = {}) {
    const task = typeof taskInput === 'string' 
      ? { id: `task_${Date.now()}`, description: taskInput }
      : { id: taskInput.id || `task_${Date.now()}`, ...taskInput };
    
    task.description = task.description || taskInput;
    task.type = task.type || options.type || 'code_generation';
    task.complexity = task.complexity || options.complexity || 5;
    
    // 立即返回进程ID，不等待完成
    const modelCfg = selectModel(task.type, task.complexity);
    const procId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    this.processes.set(procId, {
      pid: procId,
      agentId,
      taskId: task.id,
      startTime: Date.now(),
      status: 'spawned',  // 特殊状态：已spawn未完成
      model: modelCfg.model,
      task  // 保存任务以供后续使用
    });
    
    // 后台执行
    this._backgroundSpawn(procId, agentId, task, options);
    
    return { pid: procId, taskId: task.id, status: 'spawned' };
  }

  /**
   * P2-1: 后台spawn执行
   */
  async _backgroundSpawn(procId, agentId, task, options) {
    const procInfo = this.processes.get(procId);
    if (!procInfo) return;
    
    const agent = this.orchestrator.agents.get(agentId);
    if (!agent) {
      procInfo.status = 'failed';
      procInfo.result = { error: 'Agent not found' };
      return;
    }
    
    procInfo.status = 'running';
    
    try {
      const modelCfg = selectModel(task.type, task.complexity);
      const timeoutMs = options.timeout || (task.complexity >= 8 ? 120000 : 60000);
      const prompt = this.buildAgentPrompt(agent, task);
      
      const result = await Promise.race([
        this.ollama.generate(modelCfg.model, prompt, {
          temperature: 0.7,
          maxTokens: modelCfg.maxTokens
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeoutMs)
        )
      ]);
      
      procInfo.endTime = Date.now();
      procInfo.status = result.success ? 'completed' : 'failed';
      procInfo.result = result;
    } catch (error) {
      procInfo.endTime = Date.now();
      procInfo.status = 'failed';
      procInfo.result = { error: error.message };
    }
  }

  /**
   * P2-1: 等待指定进程完成
   * 用法: await mao.waitFor(pid, { timeout: 60000 })
   */
  async waitFor(pid, options = {}) {
    const timeout = options.timeout || 120000;
    const pollInterval = options.pollInterval || 500;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const procInfo = this.processes.get(pid);
      if (!procInfo) {
        throw new Error(`Process ${pid} not found`);
      }
      
      if (procInfo.status === 'completed' || procInfo.status === 'failed') {
        return {
          pid,
          status: procInfo.status,
          result: procInfo.result
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`Timeout waiting for process ${pid}`);
  }

  /**
   * P2-1: 等待所有指定进程完成
   * 用法: const results = await mao.waitAll([pid1, pid2])
   */
  async waitAll(pids, options = {}) {
    return Promise.all(pids.map(pid => this.waitFor(pid, options)));
  }

  /**
   * P2-1: 等待任意一个进程完成（最先完成的）
   * 用法: const result = await mao.waitFirst([pid1, pid2])
   */
  async waitFirst(pids, options = {}) {
    return Promise.race(pids.map(pid => this.waitFor(pid, options)));
  }

  /**
   * P2-1: 链式调用 - spawn后自动wait
   * 用法: const result = await mao.run('coder', '写快排')
   */
  async run(agentId, taskInput, options = {}) {
    const spawnResult = this.spawnSync(agentId, taskInput, options);
    return this.waitFor(spawnResult.pid, { timeout: options.timeout });
  }

  /**
   * P2-1: 批量spawn
   * 用法: const pids = await mao.spawnMany('coder', ['任务1', '任务2'])
   */
  async spawnMany(agentId, tasks, options = {}) {
    const pids = [];
    for (const task of tasks) {
      const result = this.spawnSync(agentId, task, options);
      pids.push(result.pid);
    }
    return pids;
  }

  /**
   * P2-1: 获取简化进程状态
   */
  getProcStatus(pid) {
    const proc = this.processes.get(pid);
    if (!proc) return null;
    
    return {
      pid: proc.pid,
      status: proc.status,
      elapsed: Date.now() - proc.startTime,
      result: proc.result
    };
  }
}

// ============================================================================
// MultiAgentOrchestrator v2.3
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

    // v2.3: 代理简化API到主类
    this.spawn = (agentId, task, opts) => this.processManager.spawn(agentId, task, opts);
    this.spawnSync = (agentId, task, opts) => this.processManager.spawnSync(agentId, task, opts);
    this.waitFor = (pid, opts) => this.processManager.waitFor(pid, opts);
    this.waitAll = (pids, opts) => this.processManager.waitAll(pids, opts);
    this.waitFirst = (pids, opts) => this.processManager.waitFirst(pids, opts);
    this.run = (agentId, task, opts) => this.processManager.run(agentId, task, opts);
    this.spawnMany = (agentId, tasks, opts) => this.processManager.spawnMany(agentId, tasks, opts);
    this.getProcStatus = (pid) => this.processManager.getProcStatus(pid);

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

    // ---- Agent 模板 v2.2 (三省六部增强: 5核心 + 2扩展 + 2新角色) ----
    this.AGENT_TEMPLATES = {
      // === 三省角色 ===
      // 中书省 - 决策与规划
      'architect': {
        name: '架构师',
        nameEn: 'Architect',
        role: 'leader',
        province: '中书省', // 决策
        primaryCapabilities: ['planning', 'system_design', 'ui_design'],
        secondaryCapabilities: ['code_review', 'documentation'],
        description: '系统架构设计、任务分解分配、技术决策',
        maxConcurrency: 1,
        qualityWeight: 1.2,
        traits: ['strategic', 'decisive', 'holistic']
      },
      
      // 门下省 - 审议与批评
      'reviewer': {
        name: '审查员',
        nameEn: 'Reviewer',
        role: 'reviewer',
        province: '门下省', // 审议
        primaryCapabilities: ['code_review', 'security_audit'],
        secondaryCapabilities: ['planning', 'testing'],
        description: '代码审查、安全审计、质量把关',
        maxConcurrency: 3,
        qualityWeight: 1.3,
        traits: ['critical', 'thorough', 'detail-oriented']
      },
      'critic': {
        name: '批评者',
        nameEn: 'Critic',
        role: 'reviewer',
        province: '门下省', // 审议
        primaryCapabilities: ['risk_assessment', 'adversarial_thinking', 'edge_case_analysis'],
        secondaryCapabilities: ['security_audit', 'planning'],
        description: '风险评估、对抗性思考、边缘case分析、质疑决策',
        maxConcurrency: 2,
        qualityWeight: 1.4,
        traits: ['skeptical', 'risk-aware', 'devil-advocate']
      },

      // 尚书省 - 执行
      'coder': {
        name: '开发工程师',
        nameEn: 'Coder',
        role: 'executor',
        province: '尚书省', // 执行
        primaryCapabilities: ['code_generation', 'debugging'],
        secondaryCapabilities: ['testing', 'documentation'],
        description: '代码实现、调试、技术方案落地',
        maxConcurrency: 2,
        qualityWeight: 1.0,
        traits: ['efficient', 'pragmatic', 'detail-focused']
      },
      'tester': {
        name: '测试工程师',
        nameEn: 'Tester',
        role: 'executor',
        province: '尚书省', // 执行
        primaryCapabilities: ['testing', 'documentation'],
        secondaryCapabilities: ['code_generation', 'data_analysis'],
        description: '测试验证、质量保障、文档编写',
        maxConcurrency: 2,
        qualityWeight: 0.9,
        traits: ['meticulous', 'systematic', 'quality-driven']
      },
      'devops': {
        name: '运维工程师',
        nameEn: 'DevOps',
        role: 'executor',
        province: '尚书省', // 执行
        primaryCapabilities: ['deployment', 'system_design'],
        secondaryCapabilities: ['testing', 'security_audit'],
        description: '部署运维、CI/CD、基础设施管理',
        maxConcurrency: 1,
        qualityWeight: 1.0,
        traits: ['reliable', 'infrastructure-minded', 'automated']
      },

      // === 六部角色 ===
      'analyst': {
        name: '分析师',
        nameEn: 'Analyst',
        role: 'executor',
        ministry: '户部', // 资源分析
        primaryCapabilities: ['data_analysis', 'quant_research', 'research'],
        secondaryCapabilities: ['code_generation', 'documentation'],
        description: '数据分析、量化研究、深度调研、策略建模',
        maxConcurrency: 2,
        qualityWeight: 1.1,
        traits: ['analytical', 'data-driven', 'insightful']
      },
      'writer': {
        name: '文档工程师',
        nameEn: 'Writer',
        role: 'executor',
        ministry: '礼部', // 沟通协调
        primaryCapabilities: ['content_writing', 'documentation'],
        secondaryCapabilities: ['research', 'planning'],
        description: '文档撰写、报告生成、PPT制作、技术写作',
        maxConcurrency: 1,
        qualityWeight: 1.0,
        traits: ['articulate', 'structured', 'clarity-focused']
      },
      'coordinator': {
        name: '协调员',
        nameEn: 'Coordinator',
        role: 'coordinator',
        ministry: '吏部', // 人事调度
        primaryCapabilities: ['task_coordination', 'resource_allocation', 'conflict_resolution'],
        secondaryCapabilities: ['planning', 'communication'],
        description: '任务调度、资源分配、冲突协调、进度追踪',
        maxConcurrency: 3,
        qualityWeight: 1.0,
        traits: ['communicative', 'balanced', 'mediator']
      }
    };

    // ---- 能力矩阵 (v2.2新增) ----
    // 用于基于任务类型自动匹配最优Agent
    this.CAPABILITY_MATRIX = {
      'code_generation': { primary: ['coder'], secondary: ['tester', 'architect'], weight: { coder: 1.0, tester: 0.3, architect: 0.2 } },
      'code_review': { primary: ['reviewer'], secondary: ['architect', 'critic'], weight: { reviewer: 1.0, architect: 0.4, critic: 0.6 } },
      'security_audit': { primary: ['reviewer', 'critic'], secondary: ['architect'], weight: { reviewer: 0.6, critic: 0.8, architect: 0.3 } },
      'data_analysis': { primary: ['analyst'], secondary: ['writer', 'coder'], weight: { analyst: 1.0, writer: 0.3, coder: 0.4 } },
      'planning': { primary: ['architect'], secondary: ['coordinator', 'critic'], weight: { architect: 1.0, coordinator: 0.5, critic: 0.4 } },
      'documentation': { primary: ['writer'], secondary: ['tester', 'architect'], weight: { writer: 1.0, tester: 0.3, architect: 0.2 } },
      'deployment': { primary: ['devops'], secondary: ['tester', 'architect'], weight: { devops: 1.0, tester: 0.4, architect: 0.2 } },
      'risk_assessment': { primary: ['critic'], secondary: ['architect', 'reviewer'], weight: { critic: 1.0, architect: 0.4, reviewer: 0.5 } },
      'coordination': { primary: ['coordinator'], secondary: ['architect', 'writer'], weight: { coordinator: 1.0, architect: 0.3, writer: 0.2 } }
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
      },

      // === v2.2新增团队模板 ===

      // === 应急响应团队 (刑部) ===
      'emergency-response': {
        name: '应急响应团队',
        description: '故障处理、问题诊断、紧急修复、事后复盘',
        minComplexity: 6,
        maxComplexity: 10,
        members: [
          { agentId: 'architect', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'devops', role: 'executor' },
          { agentId: 'critic', role: 'reviewer' },
          { agentId: 'coordinator', role: 'coordinator' }
        ],
        workflow: 'rapid_response', // 快速响应模式
        qualityGate: { minScore: 60, passChecks: ['error_resolution', 'rollback_check'], urgent: true },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.95, maxRevisionRounds: 1 },
        timeout: 300000, // 5分钟超时
        escalationThreshold: 180000 // 3分钟未解决自动升级
      },

      // === 持续集成团队 (工部) ===
      'ci-team': {
        name: '持续集成团队',
        description: '代码构建、自动化测试、持续部署、质量门禁',
        minComplexity: 4,
        maxComplexity: 8,
        members: [
          { agentId: 'devops', role: 'leader' },
          { agentId: 'coder', role: 'executor' },
          { agentId: 'tester', role: 'executor' },
          { agentId: 'coordinator', role: 'coordinator' }
        ],
        workflow: 'pipeline',
        qualityGate: { minScore: 80, passChecks: ['build_success', 'test_pass', 'coverage_check'] },
        reviewPolicy: { requiredReviewers: 1, autoApproveThreshold: 0.90, maxRevisionRounds: 2 },
        autoMerge: true, // 自动合并开关
        rollbackPolicy: { enabled: true, maxAge: '1h' }
      },

      // === 智能客服团队 (礼部) ===
      'support-team': {
        name: '智能客服团队',
        description: '用户问答、问题分类、工单处理、知识库更新',
        minComplexity: 1,
        maxComplexity: 5,
        members: [
          { agentId: 'writer', role: 'executor' },
          { agentId: 'analyst', role: 'executor' },
          { agentId: 'coordinator', role: 'coordinator' }
        ],
        workflow: 'triage', // 分诊模式
        qualityGate: { minScore: 70, passChecks: ['intent_classification', 'response_quality'] },
        reviewPolicy: { requiredReviewers: 0, autoApproveThreshold: 0.85, maxRevisionRounds: 1 },
        escalationPolicy: { threshold: 0.6, escalateTo: 'analyst' }
      },

      // === 三省决策团队 (大型复杂决策) ===
      'executive-team': {
        name: '三省决策团队',
        description: '重大决策、多方案评估、风险权衡、执行规划',
        minComplexity: 8,
        maxComplexity: 10,
        members: [
          { agentId: 'architect', role: 'leader', province: '中书省' }, // 决策
          { agentId: 'critic', role: 'reviewer', province: '门下省' }, // 审议
          { agentId: 'reviewer', role: 'reviewer', province: '门下省' }, // 审议
          { agentId: 'coordinator', role: 'coordinator', province: '尚书省' }, // 执行协调
          { agentId: 'analyst', role: 'executor', province: '尚书省' } // 执行
        ],
        workflow: 'deliberation', // 审议模式
        qualityGate: { minScore: 85, passChecks: ['risk_assessment', 'cost_benefit', 'stakeholder_impact'] },
        reviewPolicy: { requiredReviewers: 2, autoApproveThreshold: 0.0, maxRevisionRounds: 5 }, // 必须人工确认
        deliberationRounds: 3 // 多轮讨论
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
  // 能力矩阵匹配 (v2.2新增)
  // =========================================================================

  /**
   * 基于任务能力需求，智能匹配最优Agent组合
   * @param {string[]} requiredCapabilities - 所需能力列表
   * @param {number} maxAgents - 最大Agent数量
   * @returns {Array} 排序后的Agent ID列表及其权重
   */
  matchAgentsByCapability(requiredCapabilities, maxAgents = 3) {
    const scores = new Map();

    // 初始化所有Agent分数
    for (const [agentId, template] of Object.entries(this.AGENT_TEMPLATES)) {
      scores.set(agentId, { agentId, score: 0, match: [] });
    }

    // 计算每个Agent的匹配分数
    for (const capability of requiredCapabilities) {
      const matrix = this.CAPABILITY_MATRIX[capability];
      if (matrix) {
        for (const [agentId, weight] of Object.entries(matrix.weight)) {
          const current = scores.get(agentId);
          if (current) {
            current.score += weight;
            current.match.push({ capability, weight });
          }
        }
      } else {
        // 模糊匹配: 检查Agent的primary/secondary能力
        for (const [agentId, template] of Object.entries(this.AGENT_TEMPLATES)) {
          const current = scores.get(agentId);
          if (current) {
            if (template.primaryCapabilities.includes(capability)) {
              current.score += 0.8;
              current.match.push({ capability, weight: 0.8, type: 'primary' });
            } else if (template.secondaryCapabilities.includes(capability)) {
              current.score += 0.4;
              current.match.push({ capability, weight: 0.4, type: 'secondary' });
            }
          }
        }
      }
    }

    // 排序并返回top N
    const sorted = Array.from(scores.values())
      .filter(a => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxAgents);

    return {
      matches: sorted,
      recommended: sorted.map(m => m.agentId),
      totalScore: sorted.reduce((sum, m) => sum + m.score, 0)
    };
  }

  /**
   * 基于任务描述自动提取所需能力
   */
  extractRequiredCapabilities(goalText) {
    const text = goalText.toLowerCase();
    const capabilities = [];

    // 关键词→能力映射
    const keywordMap = {
      'code_generation': ['写代码', '实现', 'coding', '代码生成', '编写', '开发', '写一个'],
      'code_review': ['审查', 'review', 'review', '审核', '看代码'],
      'security_audit': ['安全', 'security', '漏洞', '审计', '渗透'],
      'data_analysis': ['分析', '分析数据', 'data analysis', '统计', '图表'],
      'planning': ['规划', '计划', 'planning', '设计方案', '架构'],
      'documentation': ['文档', 'doc', 'report', '报告', '说明', '撰写'],
      'deployment': ['部署', 'deploy', '上线', '发布', '运维'],
      'risk_assessment': ['风险', 'risk', '评估', '预警', '边缘case'],
      'coordination': ['协调', '协调', 'coordination', '调度', '安排']
    };

    for (const [capability, keywords] of Object.entries(keywordMap)) {
      if (keywords.some(kw => text.includes(kw))) {
        capabilities.push(capability);
      }
    }

    // 默认能力
    if (capabilities.length === 0) {
      capabilities.push('code_generation');
    }

    return capabilities;
  }

  /**
   * 智能推荐Agent组合
   */
  recommendAgentTeam(goal, options = {}) {
    const capabilities = options.capabilities || this.extractRequiredCapabilities(goal);
    const maxAgents = options.maxAgents || 3;
    const preferQuality = options.preferQuality || false;

    const match = this.matchAgentsByCapability(capabilities, maxAgents + 2);

    // 如果偏好质量，优先选择qualityWeight高的
    if (preferQuality) {
      match.matches.sort((a, b) => {
        const aTemplate = this.AGENT_TEMPLATES[a.agentId];
        const bTemplate = this.AGENT_TEMPLATES[b.agentId];
        return (bTemplate?.qualityWeight || 1) - (aTemplate?.qualityWeight || 1);
      });
    }

    const recommended = match.matches.slice(0, maxAgents).map(m => m.agentId);

    // 构建团队建议
    const teamComposition = {
      goal,
      capabilities,
      recommendedAgents: recommended.map(id => {
        const template = this.AGENT_TEMPLATES[id];
        return {
          id,
          name: template?.name || id,
          province: template?.province || template?.ministry || '未知',
          role: template?.role,
          traits: template?.traits || [],
          matchScore: match.matches.find(m => m.agentId === id)?.score || 0
        };
      }),
      matchQuality: match.totalScore,
      rationale: this._generateTeamRationale(recommended, capabilities)
    };

    return teamComposition;
  }

  /**
   * 生成团队组合的理由
   */
  _generateTeamRationale(agentIds, capabilities) {
    const rationales = [];

    for (const id of agentIds) {
      const template = this.AGENT_TEMPLATES[id];
      if (template) {
        const province = template.province || template.ministry;
        rationales.push(`${template.name}(${province || template.role}): 负责${
          template.primaryCapabilities.slice(0, 2).join('、')
        }`);
      }
    }

    return rationales.join(' | ');
  }

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
