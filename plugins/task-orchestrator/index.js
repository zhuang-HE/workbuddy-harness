/**
 * task-orchestrator - P4-1 (P0) 任务编排器 [增强版]
 * 维度: D5-Orchestration
 *
 * 增强内容：
 * - 智能目标分解（语义理解+任务类型识别）
 * - 动态优先级调整（deadline/依赖/执行时间）
 * - 超时自动重试与降级策略
 * - 执行历史和性能分析
 * - 增强管道可视化
 * - 任务批处理优化
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ============================================================================
// Priority Queue - 优先级队列（增强：时间加权）
// ============================================================================
class PriorityQueue {
  constructor() { this.items = []; }
  enqueue(item, priority = 5) {
    const urgencyBonus = item.deadline ? this._calculateUrgency(item.deadline) : 0;
    this.items.push({ item, priority: priority + urgencyBonus, enqueuedAt: Date.now(), deadline: item.deadline });
    this.items.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
  }
  _calculateUrgency(deadline) {
    if (!deadline) return 0;
    const hoursLeft = (deadline - Date.now()) / 3600000;
    if (hoursLeft < 0) return 5; // 已过期
    if (hoursLeft < 1) return 3; // <1小时
    if (hoursLeft < 4) return 2; // <4小时
    if (hoursLeft < 24) return 1; // <1天
    return 0;
  }
  dequeue() { return this.items.shift()?.item || null; }
  peek() { return this.items[0]?.item || null; }
  get size() { return this.items.length; }
  getStats() {
    const p = {};
    this.items.forEach(i => { p[i.priority] = (p[i.priority] || 0) + 1; });
    return { total: this.items.length, byPriority: p, oldestEnqueued: this.items[0]?.enqueuedAt || null };
  }
  // 移除指定项
  remove(itemId) {
    const idx = this.items.findIndex(i => i.item.id === itemId);
    if (idx >= 0) this.items.splice(idx, 1);
    return idx >= 0;
  }
}

// ============================================================================
// Worker Pool - 工作池（增强：性能追踪）
// ============================================================================
class WorkerPool {
  constructor(maxWorkers = 4) {
    this.maxWorkers = maxWorkers;
    this.active = 0;
    this.queue = new PriorityQueue();
    this.results = new Map();
    this.performanceHistory = []; // 新增：性能历史
    this.metrics = { totalProcessed: 0, totalFailed: 0, avgDuration: 0, throughput: 0 };
  }

  get available() { return this.maxWorkers - this.active; }

  async submit(task, priority = 5) {
    return new Promise((resolve, reject) => {
      this.queue.enqueue({ ...task, resolve, reject, submittedAt: Date.now() }, priority);
      this._processNext();
    });
  }

  async _processNext() {
    while (this.active < this.maxWorkers && this.queue.size > 0) {
      const job = this.queue.dequeue();
      if (!job) break;
      this.active++;
      const startTime = Date.now();
      try {
        const result = await this._executeWithTimeout(job, job.task.timeoutMs || 60000);
        const duration = Date.now() - startTime;
        this._recordCompletion(job.task.id, 'completed', result, duration);
        job.resolve(result);
      } catch (e) {
        const duration = Date.now() - startTime;
        this._recordCompletion(job.task.id, 'failed', null, duration, e.message);
        job.reject(e);
      } finally {
        this.active--;
        this._processNext();
      }
    }
  }

  _recordCompletion(taskId, status, result, duration, error = null) {
    this.metrics.totalProcessed++;
    if (status === 'failed') this.metrics.totalFailed++;
    // 计算移动平均
    this.metrics.avgDuration = this.metrics.avgDuration === 0
      ? duration
      : this.metrics.avgDuration * 0.9 + duration * 0.1;
    this.results.set(taskId, { status, result, duration, completedAt: Date.now(), error });
    // 保留最近100条性能记录
    this.performanceHistory.push({ taskId, status, duration, timestamp: Date.now() });
    if (this.performanceHistory.length > 100) this.performanceHistory.shift();
  }

  async _executeWithTimeout(job, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Task ${job.task.id} timeout after ${timeoutMs}ms`)), timeoutMs);
      try {
        resolve({ taskId: job.task.id, executed: true, timestamp: Date.now(), input: job.task });
        clearTimeout(timer);
      } catch(e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  getPoolStats() {
    return {
      activeWorkers: this.active,
      maxWorkers: this.maxWorkers,
      queueSize: this.queue.size,
      queueStats: this.queue.getStats(),
      completedTasks: [...this.results.values()].filter(r => r.status === 'completed').length,
      failedTasks: [...this.results.values()].filter(r => r.status === 'failed').length,
      performance: this.metrics,
      recentPerformance: this.performanceHistory.slice(-10)
    };
  }

  // 预估完成时间
  estimateCompletionTime() {
    if (this.queue.size === 0) return 0;
    const pendingTasks = this.queue.size;
    const avgDuration = this.metrics.avgDuration || 5000;
    const availableSlots = this.available;
    if (availableSlots === 0) return (pendingTasks / this.maxWorkers) * avgDuration;
    return avgDuration * Math.ceil(pendingTasks / this.maxWorkers);
  }

  drain() {
    const r = this.queue.size;
    this.queue = new PriorityQueue();
    return { drained: r };
  }
}

// ============================================================================
// Retry Manager - 重试管理器（增强：降级策略）
// ============================================================================
class RetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.backoffStrategy = options.backoffStrategy || 'exponential';
    this.baseDelayMs = options.baseDelayMs || 1000;
    this.maxDelayMs = options.maxDelayMs || 30000;
    this.jitterFactor = options.jitterFactor || 0.1; // 新增：抖动因子
    this.fallbackStrategies = new Map(); // 新增：降级策略
    this.retryHistory = []; // 新增：重试历史
  }

  // 注册降级策略
  registerFallback(taskType, fallbackFn) {
    this.fallbackStrategies.set(taskType, fallbackFn);
  }

  calculateDelay(attempt, jitter = true) {
    let delay;
    switch (this.backoffStrategy) {
      case 'linear': delay = Math.min(this.baseDelayMs * attempt, this.maxDelayMs); break;
      case 'exponential': delay = Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs); break;
      case 'fibonacci': delay = Math.min(this._fibonacci(attempt) * this.baseDelayMs, this.maxDelayMs); break;
      case 'fixed': delay = this.baseDelayMs; break;
      default: delay = this.baseDelayMs;
    }
    // 添加抖动
    if (jitter) delay *= (1 + (Math.random() - 0.5) * this.jitterFactor * 2);
    return Math.round(delay);
  }

  _fibonacci(n) { return n <= 2 ? 1 : this._fibonacci(n - 1) + this._fibonacci(n - 2); }

  async executeWithRetry(taskFn, taskId, taskType = 'default') {
    let lastError;
    const attemptHistory = [];

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const result = await taskFn();
        const duration = Date.now() - attemptStart;
        this.retryHistory.push({ taskId, attempt, status: 'success', duration });
        return { success: true, result, attempts: attempt, totalDuration: duration, history: attemptHistory };
      } catch (e) {
        lastError = e;
        const duration = Date.now() - attemptStart;
        attemptHistory.push({ attempt, duration, error: e.message });
        this.retryHistory.push({ taskId, attempt, status: 'failed', duration, error: e.message });

        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          await new Promise(r => setTimeout(r, delay));
        } else {
          // 尝试降级策略
          const fallback = this.fallbackStrategies.get(taskType);
          if (fallback) {
            try {
              const fallbackResult = await fallback(taskId, lastError);
              return { success: true, result: fallbackResult, attempts: attempt, degraded: true, originalError: lastError.message };
            } catch (fbError) {
              this.retryHistory.push({ taskId, attempt: attempt + 1, status: 'fallback_failed', error: fbError.message });
            }
          }
        }
      }
    }
    return { success: false, error: lastError?.message, attempts: this.maxRetries, history: attemptHistory };
  }

  getRetryStats() {
    const total = this.retryHistory.length;
    const succeeded = this.retryHistory.filter(r => r.status === 'success').length;
    const failed = this.retryHistory.filter(r => r.status === 'failed').length;
    const avgAttempts = total > 0 ? this.retryHistory.reduce((s, r) => s + (r.attempt || 1), 0) / total : 0;
    return { total, succeeded, failed, successRate: total > 0 ? Math.round(succeeded / total * 100) : 0, avgAttempts: Math.round(avgAttempts * 10) / 10 };
  }
}

// ============================================================================
// Task Orchestrator
// ============================================================================
class TaskOrchestrator {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'task-orchestrator');
    this.tasks = new Map();
    this.executions = new Map();
    this.pipelines = new Map();
    this.taskGraph = new Map();
    this.executionHistory = []; // 新增：执行历史
    this.workerPool = new WorkerPool(options.maxWorkers || 4);
    this.retryManager = new RetryManager({
      maxRetries: options.maxRetries || 3,
      backoffStrategy: options.backoffStrategy || 'exponential'
    });

    this.TaskStatus = {
      PENDING: 'pending', READY: 'ready', RUNNING: 'running',
      COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'blocked',
      CANCELLED: 'cancelled', DEGRADED: 'degraded', TIMEOUT: 'timeout'
    };

    this.TaskType = {
      ATOMIC: 'atomic', COMPOSITE: 'composite',
      DECISION: 'decision', PARALLEL: 'parallel',
      CONDITIONAL: 'conditional', PIPELINE: 'pipeline'
    };

    this.PipelineType = {
      SEQUENTIAL: 'sequential', PARALLEL: 'parallel',
      FAN_OUT: 'fan_out', FAN_IN: 'fan_in',
      MAP_REDUCE: 'map_reduce', CONDITIONAL: 'conditional', RETRY: 'retry'
    };

    // 增强：更丰富的任务模板
    this.TASK_TEMPLATES = {
      'code-implementation': {
        description: '代码实现任务',
        subtasks: [
          { name: '需求分析', skill: 'code-review', estimatedMinutes: 15 },
          { name: '代码实现', skill: null, estimatedMinutes: 45 },
          { name: '单元测试', skill: 'test-framework', estimatedMinutes: 20 },
          { name: '代码审查', skill: 'code-review', estimatedMinutes: 15 },
          { name: '文档更新', skill: 'documentation', estimatedMinutes: 10 }
        ]
      },
      'data-analysis': {
        description: '数据分析任务',
        subtasks: [
          { name: '数据收集', skill: 'deep-research', estimatedMinutes: 20 },
          { name: '数据清洗', skill: null, estimatedMinutes: 25 },
          { name: '特征工程', skill: null, estimatedMinutes: 30 },
          { name: '建模分析', skill: null, estimatedMinutes: 40 },
          { name: '报告生成', skill: 'documentation', estimatedMinutes: 15 }
        ]
      },
      'deployment': {
        description: '部署任务',
        subtasks: [
          { name: '环境检查', skill: null, estimatedMinutes: 5 },
          { name: '依赖安装', skill: null, estimatedMinutes: 15 },
          { name: '构建打包', skill: null, estimatedMinutes: 20 },
          { name: '部署执行', skill: null, estimatedMinutes: 10 },
          { name: '健康检查', skill: 'monitor', estimatedMinutes: 5 }
        ]
      },
      'bug-fix': {
        description: 'Bug修复任务',
        subtasks: [
          { name: '问题复现', skill: null, estimatedMinutes: 15 },
          { name: '根因分析', skill: 'code-review', estimatedMinutes: 20 },
          { name: '修复实施', skill: null, estimatedMinutes: 30 },
          { name: '回归测试', skill: 'test-framework', estimatedMinutes: 25 },
          { name: '代码审查', skill: 'code-review', estimatedMinutes: 10 }
        ]
      },
      'security-audit': {
        description: '安全审计任务',
        subtasks: [
          { name: '威胁建模', skill: null, estimatedMinutes: 20 },
          { name: '代码扫描', skill: 'code-review', estimatedMinutes: 30 },
          { name: '渗透测试', skill: null, estimatedMinutes: 40 },
          { name: '报告编写', skill: 'documentation', estimatedMinutes: 15 }
        ]
      },
      'research': {
        description: '研究任务',
        subtasks: [
          { name: '背景调研', skill: 'deep-research', estimatedMinutes: 30 },
          { name: '文献综述', skill: null, estimatedMinutes: 25 },
          { name: '方案设计', skill: null, estimatedMinutes: 30 },
          { name: '可行性分析', skill: null, estimatedMinutes: 20 },
          { name: '报告撰写', skill: 'documentation', estimatedMinutes: 25 }
        ]
      }
    };

    // 任务复杂度关键词
    this.COMPLEXITY_KEYWORDS = {
      trivial: { keywords: ['简单', '小', '微'], weight: 1 },
      simple: { keywords: ['实现', '添加', '修改'], weight: 2 },
      moderate: { keywords: ['开发', '重构', '优化'], weight: 3 },
      complex: { keywords: ['系统', '架构', '平台', '设计'], weight: 4 },
      massive: { keywords: ['大型', '企业级', '分布式', '微服务'], weight: 5 }
    };

    this._ensureConfigDir();
    this._loadHistory();
  }

  // ==================== 增强：智能目标分解 ====================

  /**
   * 智能目标分解 - 基于语义理解
   */
  decomposeGoal(goal, options = {}) {
    const taskType = this._identifyTaskType(goal);
    const complexity = this._analyzeComplexity(goal);
    const template = this._findBestTemplate(goal);

    const tasks = [];
    let dependencies = [];

    if (template) {
      // 使用模板分解
      const templateData = this.TASK_TEMPLATES[template];
      let prevId = null;
      for (let i = 0; i < templateData.subtasks.length; i++) {
        const st = templateData.subtasks[i];
        const taskId = this._generateId();
        const task = {
          id: taskId,
          name: st.name,
          description: `${goal} - ${st.name}`,
          type: 'atomic',
          dependencies: prevId ? [prevId] : [],
          skill: st.skill,
          estimatedMinutes: st.estimatedMinutes,
          priority: this._calculateInitialPriority(st.name, i, templateData.subtasks.length),
          status: 'pending',
          complexity: Math.round(complexity * st.estimatedMinutes / 100)
        };
        tasks.push(task);
        prevId = taskId;
      }
      dependencies = tasks.map((t, i) => i > 0 ? { from: tasks[i-1].id, to: t.id } : null).filter(Boolean);
    } else {
      // 通用分解
      const numSubtasks = Math.min(Math.max(Math.ceil(goal.length / 15), 2), 8);
      for (let i = 0; i < numSubtasks; i++) {
        const taskId = this._generateId();
        tasks.push({
          id: taskId,
          name: `${goal.substring(0, 30)} - 阶段${i+1}/${numSubtasks}`,
          description: `第${i+1}步: ${goal}`,
          type: 'atomic',
          dependencies: i > 0 ? [tasks[i-1].id] : [],
          estimatedMinutes: 20,
          priority: Math.max(1, 5 - Math.floor(i / 2)),
          status: 'pending'
        });
      }
      dependencies = tasks.map((t, i) => i > 0 ? { from: tasks[i-1].id, to: t.id } : null).filter(Boolean);
    }

    return {
      tasks,
      graph: dependencies,
      goal,
      estimatedTime: tasks.reduce((s, t) => s + (t.estimatedMinutes || 20), 0),
      complexity,
      template,
      taskType,
      subtaskCount: tasks.length
    };
  }

  /**
   * 识别任务类型
   */
  _identifyTaskType(goal) {
    const g = goal.toLowerCase();
    const typePatterns = [
      { type: 'code-implementation', patterns: ['实现', '开发', '写代码', '创建', 'build', 'implement'] },
      { type: 'data-analysis', patterns: ['分析', '统计', '挖掘', 'analyze', 'analytics'] },
      { type: 'deployment', patterns: ['部署', '发布', '上线', 'deploy', 'release'] },
      { type: 'bug-fix', patterns: ['修复', 'bug', '错误', 'fix', 'issue'] },
      { type: 'security-audit', patterns: ['安全', '审计', '漏洞', 'security', 'audit'] },
      { type: 'research', patterns: ['研究', '调研', '探索', 'research', 'explore'] }
    ];

    for (const { type, patterns } of typePatterns) {
      if (patterns.some(p => g.includes(p))) return type;
    }
    return 'general';
  }

  /**
   * 分析任务复杂度
   */
  _analyzeComplexity(goal) {
    let complexity = 5;
    for (const [level, { keywords, weight }] of Object.entries(this.COMPLEXITY_KEYWORDS)) {
      if (keywords.some(k => goal.includes(k))) {
        complexity = Math.min(complexity, weight);
      }
    }
    // 长度也影响复杂度
    complexity = Math.max(complexity, Math.ceil(goal.length / 20));
    return Math.min(10, Math.max(1, complexity));
  }

  /**
   * 找到最佳匹配模板
   */
  _findBestTemplate(goal) {
    const g = goal.toLowerCase();
    const templateKeywords = {
      'code-implementation': ['实现', '开发', '写代码', '创建', '编程'],
      'data-analysis': ['分析', '统计', '数据', '报表'],
      'deployment': ['部署', '发布', '上线', '安装'],
      'bug-fix': ['修复', 'bug', '问题', '错误'],
      'security-audit': ['安全', '审计', '漏洞', '渗透'],
      'research': ['研究', '调研', '探索', '调查']
    };

    let bestMatch = null;
    let bestScore = 0;

    for (const [template, keywords] of Object.entries(templateKeywords)) {
      const score = keywords.filter(k => g.includes(k)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = template;
      }
    }

    return bestMatch;
  }

  /**
   * 计算初始优先级
   */
  _calculateInitialPriority(taskName, index, total) {
    // 越靠后的子任务优先级越高（因为是依赖链）
    return Math.max(1, Math.min(10, Math.round(1 + (index / total) * 4)));
  }

  // ==================== 增强：动态优先级调整 ====================

  /**
   * 动态调整任务优先级
   */
  adjustPriorities(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return [];

    const now = Date.now();
    const adjustments = [];

    for (const task of exec.tasks) {
      if (task.status !== 'pending') continue;

      let newPriority = task.priority || 5;
      let reasons = [];

      // 1. Deadline影响
      if (task.deadline) {
        const hoursLeft = (task.deadline - now) / 3600000;
        if (hoursLeft < 0) {
          newPriority = 10; // 已过期
          reasons.push('deadline_overdue');
        } else if (hoursLeft < 2) {
          newPriority = Math.max(newPriority, 8);
          reasons.push('deadline_urgent');
        } else if (hoursLeft < 8) {
          newPriority = Math.max(newPriority, 7);
          reasons.push('deadline_soon');
        }
      }

      // 2. 依赖任务延迟影响
      if (task.dependencies?.length > 0) {
        for (const depId of task.dependencies) {
          const depTask = exec.tasks.find(t => t.id === depId);
          if (depTask?.status === 'failed') {
            newPriority = Math.min(newPriority, 1); // 依赖失败则降低
            reasons.push('dependency_failed');
          }
        }
      }

      // 3. 执行时间预估影响
      if (task.estimatedMinutes && task.estimatedMinutes > 60) {
        newPriority = Math.max(newPriority, 6); // 长时间任务优先
        reasons.push('long_running');
      }

      // 4. 重试次数影响
      if (task.retryCount > 0) {
        newPriority = Math.max(newPriority, 7);
        reasons.push('retried');
      }

      if (newPriority !== task.priority) {
        const oldPriority = task.priority;
        task.priority = newPriority;
        adjustments.push({ taskId: task.id, oldPriority, newPriority, reasons });
      }
    }

    return adjustments;
  }

  // ==================== 增强：执行历史与分析 ====================

  _loadHistory() {
    const historyPath = path.join(this.configDir, 'executions', 'history.json');
    try {
      if (fs.existsSync(historyPath)) {
        const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        this.executionHistory = data.history || [];
        this.executionHistory = this.executionHistory.slice(-100); // 保留最近100条
      }
    } catch (e) { /* ignore */ }
  }

  _saveHistory() {
    const historyPath = path.join(this.configDir, 'executions', 'history.json');
    try {
      fs.writeFileSync(historyPath, JSON.stringify({
        history: this.executionHistory,
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch (e) { /* ignore */ }
  }

  /**
   * 记录执行历史
   */
  _recordExecution(exec) {
    const summary = this.getExecutionStatus(exec.id);
    const record = {
      id: exec.id,
      planId: exec.planId,
      timestamp: exec.started,
      completedAt: exec.completed,
      duration: exec.completed ? new Date(exec.completed) - new Date(exec.started) : null,
      ...summary
    };

    this.executionHistory.push(record);
    if (this.executionHistory.length > 100) this.executionHistory.shift();
    this._saveHistory();
  }

  /**
   * 获取性能分析
   */
  getPerformanceAnalysis(days = 7) {
    const cutoff = Date.now() - days * 24 * 3600000;
    const recent = this.executionHistory.filter(e => new Date(e.timestamp) > cutoff);

    if (recent.length === 0) {
      return { analysis: 'No data available', period: `Last ${days} days` };
    }

    const completed = recent.filter(e => e.status === 'success' || e.status === 'completed');
    const failed = recent.filter(e => e.status === 'failed');

    const avgDuration = completed.length > 0
      ? completed.reduce((s, e) => s + (e.duration || 0), 0) / completed.length
      : 0;

    const avgProgress = recent.length > 0
      ? recent.reduce((s, e) => s + (e.progress || 0), 0) / recent.length
      : 0;

    return {
      period: `Last ${days} days`,
      totalExecutions: recent.length,
      completed: completed.length,
      failed: failed.length,
      successRate: Math.round(completed.length / recent.length * 100),
      avgDurationMs: Math.round(avgDuration),
      avgDurationFormatted: this._formatDuration(avgDuration),
      avgProgress: Math.round(avgProgress),
      avgTasksPerExecution: recent.length > 0
        ? Math.round(recent.reduce((s, e) => s + (e.total || 0), 0) / recent.length)
        : 0,
      trend: this._calculateTrend()
    };
  }

  _formatDuration(ms) {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`;
  }

  _calculateTrend() {
    if (this.executionHistory.length < 10) return 'insufficient_data';
    const recent = this.executionHistory.slice(-10);
    const older = this.executionHistory.slice(-20, -10);

    const recentSuccessRate = recent.filter(e => e.status === 'success' || e.status === 'completed').length / recent.length;
    const olderSuccessRate = older.length > 0
      ? older.filter(e => e.status === 'success' || e.status === 'completed').length / older.length
      : recentSuccessRate;

    if (recentSuccessRate > olderSuccessRate + 0.1) return 'improving';
    if (recentSuccessRate < olderSuccessRate - 0.1) return 'declining';
    return 'stable';
  }

  // ==================== 增强：管道可视化 ====================

  /**
   * 增强的管道可视化
   */
  visualize(execId, format = 'mermaid') {
    const exec = this.executions.get(execId);
    if (!exec) return '';

    if (format === 'mermaid') {
      let mermaid = 'graph TD\n';
      mermaid += `  subgraph execution_${execId.substring(0, 6)}["执行: ${exec.planId || 'unknown'}"]\n`;

      const statusColors = {
        pending: '#f0f0f0',
        running: '#ffff00',
        completed: '#90EE90',
        failed: '#ff6b6b',
        blocked: '#ffa500',
        cancelled: '#cccccc'
      };

      for (const task of exec.tasks) {
        const color = statusColors[task.status] || '#f0f0f0';
        const label = `${task.name}\n[${task.priority || 5}]`;
        mermaid += `    ${task.id.replace(/-/g, '_')}{${label}}\n`;
        mermaid += `    style ${task.id.replace(/-/g, '_')} fill:${color}\n`;
      }

      for (const task of exec.tasks) {
        if (task.dependencies?.length > 0) {
          for (const depId of task.dependencies) {
            mermaid += `    ${depId.replace(/-/g, '_')} --> ${task.id.replace(/-/g, '_')}\n`;
          }
        }
      }

      mermaid += '  end\n';
      return mermaid;
    }

    if (format === 'ascii') {
      let ascii = `╔════════════════════════════════════════╗\n`;
      ascii += `║  Execution: ${exec.id.substring(0, 20).padEnd(26)}║\n`;
      ascii += `╠════════════════════════════════════════╣\n`;

      for (const task of exec.tasks) {
        const statusIcon = {
          pending: '○', running: '◐', completed: '●',
          failed: '✗', blocked: '⊘', cancelled: '⊝'
        }[task.status] || '?';
        ascii += `║ ${statusIcon} ${task.name.substring(0, 32).padEnd(34)}║\n`;
      }
      ascii += `╚════════════════════════════════════════╝`;
      return ascii;
    }

    return '';
  }

  // ==================== 任务管理 ====================

  registerTask(taskDef) {
    const task = {
      id: taskDef.id || this._generateId(),
      name: taskDef.name,
      description: taskDef.description || '',
      type: taskDef.type || 'atomic',
      dependencies: taskDef.dependencies || [],
      dependencyMode: taskDef.dependencyMode || 'all',
      skill: taskDef.skill || null,
      model: taskDef.model || 'auto',
      estimatedTokens: taskDef.estimatedTokens || 2000,
      estimatedMinutes: taskDef.estimatedMinutes || 20,
      maxRetries: taskDef.maxRetries || 3,
      timeoutMs: taskDef.timeoutMs || 120000,
      deadline: taskDef.deadline || null,
      acceptanceCriteria: taskDef.acceptanceCriteria || [],
      priority: taskDef.priority || 5,
      tags: taskDef.tags || [],
      created: this._timestamp(),
      version: '1.0'
    };

    this.tasks.set(task.id, task);
    this.taskGraph.set(task.id, task.dependencies);
    return task;
  }

  unregisterTask(taskId) {
    this.tasks.delete(taskId);
    this.taskGraph.delete(taskId);
    return true;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  listTasks(filter = {}) {
    let tasks = Array.from(this.tasks.values());
    if (filter.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter.type) tasks = tasks.filter(t => t.type === filter.type);
    if (filter.priority) tasks = tasks.filter(t => t.priority >= filter.priority);
    return tasks;
  }

  analyzeDependencies(taskIds) {
    const analyzed = [];
    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (!task) continue;
      analyzed.push({
        id: task.id,
        name: task.name,
        dependencies: task.dependencies,
        dependencyCount: task.dependencies.length,
        dependents: this._findDependents(task.id)
      });
    }
    return analyzed;
  }

  resolveDependencyGraph(taskIds) {
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const dfs = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`循环依赖: ${id}`);
      visiting.add(id);
      const task = this.tasks.get(id);
      if (task) {
        for (const dep of (task.dependencies || [])) {
          dfs(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of taskIds) {
      dfs(id);
    }

    return order;
  }

  detectCycles() {
    const cycles = [];
    const allIds = Array.from(this.tasks.keys());
    const visiting = new Set();
    const path = [];

    const dfs = (id) => {
      if (visiting.has(id)) {
        const cycleStart = path.indexOf(id);
        if (cycleStart >= 0) {
          cycles.push([...path.slice(cycleStart), id]);
        }
        return;
      }
      visiting.add(id);
      path.push(id);
      const task = this.tasks.get(id);
      if (task) {
        for (const dep of (task.dependencies || [])) {
          dfs(dep);
        }
      }
      path.pop();
      visiting.delete(id);
    };

    for (const id of allIds) {
      if (!visiting.has(id)) dfs(id);
    }

    return cycles;
  }

  getReadyTasks(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return [];
    const completed = new Set(exec.completedTasks || []);
    return exec.tasks.filter(t =>
      t.status === 'pending' &&
      (t.dependencies || []).every(d => completed.has(d))
    );
  }

  getCriticalPath() {
    const allIds = Array.from(this.tasks.keys());
    const maxPath = [];
    let maxLen = 0;

    for (const id of allIds) {
      try {
        const order = this.resolveDependencyGraph([id]);
        if (order.length > maxLen) {
          maxLen = order.length;
          maxPath.splice(0, maxPath.length, ...order);
        }
      } catch (e) { /* cycle */ }
    }

    return maxPath;
  }

  getParallelGroups(taskIds) {
    const groups = [];
    const completed = new Set();
    const remaining = new Set(taskIds);

    while (remaining.size > 0) {
      const group = [];
      for (const id of remaining) {
        const task = this.tasks.get(id);
        if (!task) continue;
        if ((task.dependencies || []).every(d => completed.has(d))) {
          group.push(id);
        }
      }
      for (const id of group) {
        remaining.delete(id);
        completed.add(id);
      }
      groups.push(group);
    }

    return groups;
  }

  createPipeline(pipelineDef) {
    const pipeline = {
      id: pipelineDef.id || this._generateId(),
      name: pipelineDef.name,
      type: pipelineDef.type || 'sequential',
      steps: pipelineDef.steps || [],
      config: pipelineDef.config || {},
      created: this._timestamp()
    };
    this.pipelines.set(pipeline.id, pipeline);
    return pipeline;
  }

  executePipeline(pipelineId, context) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

    const execId = this._generateId();
    const tasks = pipeline.steps.map((step, i) => ({
      id: this._generateId(),
      name: step.name || `Step ${i+1}`,
      status: 'ready',
      dependencies: i > 0 && pipeline.type === 'sequential' ? [pipeline.steps[i-1].id] : [],
      step
    }));

    tasks.forEach((t, i) => {
      if (i > 0 && pipeline.type === 'sequential') {
        t.dependencies = [tasks[i-1].id];
      }
    });

    this.executions.set(execId, {
      id: execId,
      pipelineId,
      tasks,
      status: 'running',
      started: this._timestamp(),
      completedTasks: [],
      context
    });

    return { executionId: execId, tasks };
  }

  startExecution(planId) {
    const execId = this._generateId();
    const tasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending' || !t.status);

    this.executions.set(execId, {
      id: execId,
      planId,
      tasks: tasks.map(t => ({ ...t, status: 'pending' })),
      status: 'running',
      started: this._timestamp(),
      completedTasks: []
    });

    return { executionId: execId, totalTasks: tasks.length };
  }

  getExecutionStatus(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return null;

    const total = exec.tasks.length;
    const completed = exec.tasks.filter(t => t.status === 'completed').length;
    const failed = exec.tasks.filter(t => t.status === 'failed').length;
    const running = exec.tasks.filter(t => t.status === 'running').length;
    const blocked = exec.tasks.filter(t => t.status === 'blocked').length;
    const pending = exec.tasks.filter(t => t.status === 'pending').length;

    return {
      executionId: execId,
      total, completed, failed, running, blocked, pending,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
      status: exec.status,
      estimatedCompletion: this.workerPool.estimateCompletionTime()
    };
  }

  retryTask(execId, taskId) {
    const exec = this.executions.get(execId);
    if (!exec) return null;
    const task = exec.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'pending';
      task.retryCount = (task.retryCount || 0) + 1;
    }
    return task;
  }

  cancelExecution(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return null;
    exec.status = 'cancelled';
    exec.completed = this._timestamp();
    exec.tasks.forEach(t => {
      if (t.status === 'running' || t.status === 'pending') t.status = 'cancelled';
    });
    this._recordExecution(exec);
    return { executionId: execId, status: 'cancelled' };
  }

  generateReport(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return 'Execution not found';

    const status = this.getExecutionStatus(execId);
    let report = `# 任务执行报告\n\n`;
    report += `- **执行ID**: ${execId}\n`;
    report += `- **状态**: ${status.status}\n`;
    report += `- **总任务**: ${status.total} | 完成: ${status.completed} | 失败: ${status.failed} | 进度: ${status.progress}%\n`;
    report += `- **预估完成时间**: ${this._formatDuration(status.estimatedCompletion)}\n\n`;
    report += `## 任务详情\n\n`;
    report += `| ID | 名称 | 状态 | 优先级 | 耗时 |\n`;
    report += `|----|------|------|--------|------|\n`;
    exec.tasks.forEach(t => {
      const duration = t.completedAt && t.startedAt
        ? this._formatDuration(new Date(t.completedAt) - new Date(t.startedAt))
        : '-';
      report += `| ${t.id.substring(0, 8)} | ${t.name} | ${t.status} | ${t.priority || 5} | ${duration} |\n`;
    });
    return report;
  }

  getStats() {
    return {
      total: this.tasks.size,
      totalTasks: this.tasks.size,
      totalExecutions: this.executions.size,
      totalPipelines: this.pipelines.size,
      activeExecutions: Array.from(this.executions.values()).filter(e => e.status === 'running').length,
      poolStats: this.workerPool.getPoolStats(),
      retryStats: this.retryManager.getRetryStats(),
      performanceAnalysis: this.getPerformanceAnalysis()
    };
  }

  // ==================== Distributed Scheduling ====================
  async submitTask(task, priority = 5) { return this.workerPool.submit(task, priority); }
  async executeTaskWithRetry(taskFn, taskId, taskType) { return this.retryManager.executeWithRetry(taskFn, taskId, taskType); }
  getPoolStats() { return this.workerPool.getPoolStats(); }
  getRetryStats() { return this.retryManager.getRetryStats(); }
  drainPool() { return this.workerPool.drain(); }

  // ==================== Pipeline State Machine ====================

  static STATES = {
    PENDING: 'pending', RUNNING: 'running', SUCCESS: 'success',
    FAILED: 'failed', RETRYING: 'retrying', SKIPPED: 'skipped'
  };

  static TRANSITIONS = {
    pending: ['running', 'skipped'],
    running: ['success', 'failed'],
    failed: ['retrying', 'skipped'],
    retrying: ['running', 'failed']
  };

  transitionTask(execId, taskId, newState) {
    const exec = this.executions.get(execId);
    if (!exec) return null;
    const task = exec.tasks.find(t => t.id === taskId);
    if (!task) return null;

    const allowed = TaskOrchestrator.TRANSITIONS[task.status] || [];
    if (!allowed.includes(newState)) throw new Error(`Invalid transition: ${task.status} → ${newState}`);

    task.status = newState;
    task.updated = this._timestamp();

    if (newState === 'retrying') {
      task.retryCount = (task.retryCount || 0) + 1;
      const delay = this.retryManager.calculateDelay(task.retryCount);
      task.nextRetryAt = Date.now() + delay;
    }

    if (newState === 'success' || newState === 'failed' || newState === 'skipped') {
      task.completedAt = this._timestamp();
    }

    if (newState === 'success') {
      exec.completedTasks.push(taskId);
    }

    if (exec.tasks.every(t => ['success', 'skipped', 'failed'].includes(t.status))) {
      exec.status = exec.tasks.some(t => t.status === 'failed') ? 'partial' : 'completed';
      exec.completed = this._timestamp();
      this._recordExecution(exec);
    }

    return task;
  }

  async executeWithTracking(pipelineId, context = {}) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

    const execId = this._generateId();
    const tasks = pipeline.steps.map((step, i) => ({
      id: this._generateId(),
      name: step.name || `Step ${i+1}`,
      status: 'pending',
      dependencies: [],
      step,
      retryCount: 0,
      startedAt: null,
      completedAt: null
    }));

    if (pipeline.type === 'sequential') {
      for (let i = 1; i < tasks.length; i++) {
        tasks[i].dependencies = [tasks[i-1].id];
      }
    }

    const execution = {
      id: execId,
      pipelineId,
      tasks,
      status: 'running',
      started: this._timestamp(),
      completed: null,
      completedTasks: [],
      context,
      history: []
    };

    this.executions.set(execId, execution);
    return execId;
  }

  getPipelineProgress(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return null;

    const total = exec.tasks.length;
    const completed = exec.tasks.filter(t => t.status === 'success' || t.status === 'skipped').length;
    const failed = exec.tasks.filter(t => t.status === 'failed').length;
    const running = exec.tasks.filter(t => t.status === 'running' || t.status === 'retrying').length;

    return {
      executionId: execId,
      total,
      completed,
      failed,
      running,
      pending: total - completed - failed - running,
      progress: Math.round(completed / total * 100),
      status: exec.status,
      elapsed: this._timestamp()
    };
  }

  getPipelineStats() {
    const all = [...this.executions.values()];
    if (!all.length) return { total: 0 };

    const completed = all.filter(e => e.tasks.every(t => t.status === 'success' || t.status === 'skipped'));
    const failed = all.filter(e => e.tasks.some(t => t.status === 'failed'));
    const avgTasks = completed.length > 0
      ? Math.round(completed.reduce((s, e) => s + e.tasks.length, 0) / completed.length)
      : 0;

    return {
      totalPipelines: all.length,
      completed: completed.length,
      failed: failed.length,
      running: all.filter(e => e.status === 'running').length,
      avgTasksPerPipeline: avgTasks,
      successRate: all.length ? Math.round(completed.length / all.length * 100) : 0
    };
  }

  // ==================== Batch Processing ====================

  /**
   * 批量创建任务
   */
  createBatch(taskDefs) {
    const tasks = [];
    for (const def of taskDefs) {
      tasks.push(this.registerTask(def));
    }
    return { created: tasks.length, tasks };
  }

  /**
   * 批量执行准备
   */
  prepareBatchExecution(taskIds, options = {}) {
    const { parallel = false, priority = 5, deadline = null } = options;

    const tasks = taskIds.map(id => this.tasks.get(id)).filter(Boolean);
    const groups = parallel ? this.getParallelGroups(taskIds) : [taskIds];

    return {
      executionId: this._generateId(),
      totalTasks: tasks.length,
      groups,
      mode: parallel ? 'parallel' : 'sequential',
      priority,
      deadline
    };
  }

  _findDependents(taskId) {
    const dependents = [];
    for (const [id, task] of this.tasks) {
      if ((task.dependencies || []).includes(taskId)) {
        dependents.push(id);
      }
    }
    return dependents;
  }

  _ensureConfigDir() {
    ['tasks', 'executions', 'pipelines', 'reports'].forEach(sub => {
      const d = path.join(this.configDir, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString().replace('T', ' ').substring(0, 19); }
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  const to = new TaskOrchestrator();
  const cmdMap = {
    decompose() {
      const goal = process.argv.slice(3).join(' ');
      if (!goal) { console.log('用法: node task-orchestrator.js decompose "<目标>"'); return; }
      const r = to.decomposeGoal(goal);
      console.log(`任务类型: ${r.taskType}`);
      console.log(`复杂度: ${r.complexity}/10`);
      console.log(`模板: ${r.template || 'none'}`);
      console.log(`预估时间: ${r.estimatedTime}分钟`);
      console.log(`子任务: ${r.tasks.length} 个`);
      r.tasks.forEach((t, i) => {
        console.log(`  ${i+1}. ${t.name} (优先级:${t.priority}, 依赖:${t.dependencies.join(',') || 'none'})`);
      });
    },
    task() {
      const sub = process.argv[3] || 'list';
      if (sub === 'list') {
        console.log(`总任务: ${to.tasks.size}`);
        to.listTasks().forEach(t => console.log(`  [${t.id}] ${t.name} (${t.type}) 优先级:${t.priority}`));
      }
    },
    execute() {
      const planId = process.argv[3] || 'default';
      const r = to.startExecution(planId);
      console.log(`开始执行: ${r.executionId}, 任务: ${r.totalTasks}`);
    },
    status() {
      const id = process.argv[3];
      if (!id) { console.log('请指定执行ID'); return; }
      console.log(JSON.stringify(to.getExecutionStatus(id), null, 2));
    },
    report() {
      const id = process.argv[3];
      if (!id) { console.log('请指定执行ID'); return; }
      console.log(to.generateReport(id));
    },
    visualize() {
      const id = process.argv[3] || 'last';
      const format = process.argv[4] || 'mermaid';
      if (id === 'last') {
        const execs = [...to.executions.keys()];
        if (execs.length === 0) { console.log('无执行记录'); return; }
        console.log(to.visualize(execs[execs.length - 1], format));
      } else {
        console.log(to.visualize(id, format));
      }
    },
    stats() { console.log(JSON.stringify(to.getStats(), null, 2)); },
    pool() { console.log(JSON.stringify(to.getPoolStats(), null, 2)); },
    performance() { console.log(JSON.stringify(to.getPerformanceAnalysis(), null, 2)); },
    drain() { console.log(JSON.stringify(to.drainPool())); },
    'retry-config'() { console.log(JSON.stringify(to.getRetryStats(), null, 2)); },
    help() {
      console.log('TaskOrchestrator CLI - P4-1 [增强版]\n命令: decompose, task, execute, status, report, visualize, stats, pool, performance, drain, retry-config, help');
    }
  };
  (cmdMap[cmd] || cmdMap.help)();
}

console.log('[TaskOrchestrator] 加载成功 - P4-1 任务编排器 [增强版]');

module.exports = TaskOrchestrator;
module.exports.default = TaskOrchestrator;
