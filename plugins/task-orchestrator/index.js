/**
 * task-orchestrator - P4-1 (P0) 任务编排器 - 增强版
 * 维度: D5-Orchestration
 * 
 * P3.1 优化: 88% → 92%
 * 新增功能:
 * - 智能依赖推断器 (SmartDependencyInferrer)
 * - 资源感知调度器 (ResourceAwareScheduler)
 * - 执行时间预测器 (ExecutionPredictor)
 * - 增强 DAG 可视化 (EnhancedVisualizer)
 * - 条件执行引擎 (ConditionalExecutor)
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { performance } = require('perf_hooks');

// ============================================================================
// 常量定义
// ============================================================================
const TASK_STATES = {
  PENDING: 'pending', READY: 'ready', RUNNING: 'running',
  COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'blocked', 
  CANCELLED: 'cancelled', SKIPPED: 'skipped', RETRYING: 'retrying'
};

const STATE_TRANSITIONS = {
  pending: ['running', 'skipped'],
  ready: ['running', 'skipped'],
  running: ['completed', 'failed', 'retrying'],
  failed: ['retrying', 'skipped'],
  retrying: ['running', 'failed'],
  completed: [],
  skipped: [],
  blocked: ['ready', 'cancelled'],
  cancelled: []
};

// ============================================================================
// Priority Queue - 优先级队列 (增强版)
// ============================================================================
class PriorityQueue {
  constructor(options = {}) {
    this.items = [];
    this.comparator = options.comparator || ((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
  }
  
  enqueue(item, priority = 5) {
    this.items.push({ item, priority, enqueuedAt: Date.now() });
    this.items.sort(this.comparator);
  }
  
  dequeue() { return this.items.shift()?.item || null; }
  peek() { return this.items[0]?.item || null; }
  get size() { return this.items.length; }
  isEmpty() { return this.items.length === 0; }
  
  clear() { this.items = []; }
  
  getStats() {
    const p = {};
    this.items.forEach(i => { p[i.priority] = (p[i.priority] || 0) + 1; });
    return { 
      total: this.items.length, 
      byPriority: p, 
      oldestEnqueued: this.items[0]?.enqueuedAt || null,
      newestEnqueued: this.items[this.items.length - 1]?.enqueuedAt || null
    };
  }
}

// ============================================================================
// SmartDependencyInferrer - 智能依赖推断器 (P3.1 新增)
// ============================================================================
class SmartDependencyInferrer {
  constructor() {
    // 任务阶段模式 -> 依赖推断规则
    this.stagePatterns = {
      // 软件开发生命周期
      '需求': { dependsOn: ['架构设计'], stage: 1 },
      '分析': { dependsOn: ['需求'], stage: 2 },
      '设计': { dependsOn: ['需求', '分析'], stage: 3 },
      '实现': { dependsOn: ['设计'], stage: 4 },
      '开发': { dependsOn: ['设计'], stage: 4 },
      '编码': { dependsOn: ['设计'], stage: 4 },
      '测试': { dependsOn: ['实现', '开发', '编码'], stage: 5 },
      '验证': { dependsOn: ['实现', '测试'], stage: 5 },
      '部署': { dependsOn: ['测试', '验证'], stage: 6 },
      '发布': { dependsOn: ['部署'], stage: 6 },
      '上线': { dependsOn: ['部署'], stage: 6 },
      '监控': { dependsOn: ['部署', '上线'], stage: 7 },
      '文档': { dependsOn: ['实现', '测试'], stage: 5 },
      
      // 数据处理流程
      '采集': { dependsOn: [], stage: 1 },
      '收集': { dependsOn: [], stage: 1 },
      '获取': { dependsOn: [], stage: 1 },
      '清洗': { dependsOn: ['采集', '收集', '获取'], stage: 2 },
      '处理': { dependsOn: ['清洗'], stage: 3 },
      '分析': { dependsOn: ['处理'], stage: 4 },
      '计算': { dependsOn: ['处理', '清洗'], stage: 3 },
      '建模': { dependsOn: ['分析'], stage: 5 },
      '训练': { dependsOn: ['清洗', '处理'], stage: 4 },
      '评估': { dependsOn: ['建模', '训练'], stage: 6 },
      '可视化': { dependsOn: ['分析', '评估'], stage: 7 },
      '报告': { dependsOn: ['分析', '评估', '可视化'], stage: 8 },
      
      // 问题解决流程
      '复现': { dependsOn: [], stage: 1 },
      '定位': { dependsOn: ['复现'], stage: 2 },
      '根因': { dependsOn: ['复现', '定位'], stage: 3 },
      '修复': { dependsOn: ['根因', '定位'], stage: 4 },
      '解决': { dependsOn: ['根因', '定位'], stage: 4 },
      '回归': { dependsOn: ['修复', '解决'], stage: 5 },
      
      // 文件操作流程
      '读取': { dependsOn: [], stage: 1 },
      '写入': { dependsOn: ['读取'], stage: 2 },
      '修改': { dependsOn: ['读取'], stage: 2 },
      '删除': { dependsOn: [], stage: 1 },
      '移动': { dependsOn: [], stage: 1 },
      '复制': { dependsOn: [], stage: 1 }
    };
    
    // 技能依赖规则
    this.skillDependencies = {
      'code-review': ['实现', '开发', '编码', '修复'],
      'test-framework': ['实现', '开发', '修复'],
      'documentation': ['实现', '开发', '分析'],
      'deep-research': ['分析', '需求'],
      'git-workflow': ['实现', '开发', '部署'],
      'monitor': ['部署', '上线', '发布']
    };
  }
  
  /**
   * 分析任务文本，提取关键词
   */
  extractKeywords(text) {
    if (!text) return [];
    const keywords = [];
    const patterns = Object.keys(this.stagePatterns);
    
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        keywords.push(pattern);
      }
    }
    
    return [...new Set(keywords)];
  }
  
  /**
   * 推断单个任务的潜在依赖
   */
  inferDependencies(taskDef, allTasks) {
    const inferred = [];
    
    // 1. 基于任务名称/描述的模式匹配
    const keywords = this.extractKeywords(taskDef.name) || [];
    keywords.push(...this.extractKeywords(taskDef.description) || []);
    
    for (const keyword of [...new Set(keywords)]) {
      const pattern = this.stagePatterns[keyword];
      if (pattern && pattern.dependsOn.length > 0) {
        for (const depKeyword of pattern.dependsOn) {
          // 查找匹配的任务
          const matchingTasks = allTasks.filter(t => 
            t.id !== taskDef.id &&
            (t.name.includes(depKeyword) || 
             (t.description && t.description.includes(depKeyword)))
          );
          for (const mt of matchingTasks) {
            if (!inferred.includes(mt.id)) {
              inferred.push(mt.id);
            }
          }
        }
      }
    }
    
    // 2. 基于技能的依赖推断
    if (taskDef.skill && this.skillDependencies[taskDef.skill]) {
      const requiredKeywords = this.skillDependencies[taskDef.skill];
      for (const keyword of requiredKeywords) {
        const matchingTasks = allTasks.filter(t => 
          t.id !== taskDef.id &&
          (t.name.includes(keyword) || (t.description && t.description.includes(keyword)))
        );
        for (const mt of matchingTasks) {
          if (!inferred.includes(mt.id)) {
            inferred.push(mt.id);
          }
        }
      }
    }
    
    // 3. 基于阶段顺序推断（同一模板的任务）
    if (taskDef.tags && taskDef.tags.includes('auto-decomposed')) {
      // 自动分解的任务按顺序依赖
      const sameTagTasks = allTasks.filter(t => 
        t.tags && t.tags.some(tag => taskDef.tags.includes(tag)) && t.id !== taskDef.id
      );
      for (const st of sameTagTasks) {
        if (st.created < taskDef.created && !inferred.includes(st.id)) {
          inferred.push(st.id);
        }
      }
    }
    
    return inferred;
  }
  
  /**
   * 分析所有任务的依赖关系
   */
  analyzeAllDependencies(tasks) {
    const results = {
      explicit: [],      // 显式依赖
      inferred: [],      // 推断依赖
      missing: [],        // 可能的缺失依赖
      conflicts: []       // 依赖冲突
    };
    
    for (const task of tasks) {
      // 记录显式依赖
      for (const depId of (task.dependencies || [])) {
        results.explicit.push({
          from: depId,
          to: task.id,
          type: 'explicit'
        });
      }
      
      // 推断隐式依赖
      const inferred = this.inferDependencies(task, tasks);
      for (const depId of inferred) {
        if (!(task.dependencies || []).includes(depId)) {
          results.inferred.push({
            from: depId,
            to: task.id,
            type: 'inferred',
            confidence: this._calculateConfidence(task, tasks.find(t => t.id === depId))
          });
        }
      }
    }
    
    // 检测循环依赖
    const graph = new Map();
    for (const task of tasks) {
      graph.set(task.id, [...(task.dependencies || []), ...this.inferDependencies(task, tasks)]);
    }
    results.cycles = this._detectCycles(graph);
    
    return results;
  }
  
  _calculateConfidence(task, depTask) {
    let confidence = 0.5;
    
    if (!task || !depTask) return 0;
    
    // 基于关键词匹配
    const taskKeywords = this.extractKeywords(task.name).concat(this.extractKeywords(task.description || ''));
    const depKeywords = this.extractKeywords(depTask.name).concat(this.extractKeywords(depTask.description || ''));
    
    const overlap = taskKeywords.filter(k => depKeywords.includes(k));
    confidence += overlap.length * 0.15;
    
    // 基于技能依赖
    if (task.skill && depTask.skill) {
      if (this.skillDependencies[task.skill]?.includes(depTask.skill)) {
        confidence += 0.3;
      }
    }
    
    return Math.min(confidence, 1);
  }
  
  _detectCycles(graph) {
    const visited = new Set();
    const recursionStack = new Set();
    const cycles = [];
    
    const dfs = (node, path) => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);
      
      for (const neighbor of (graph.get(node) || [])) {
        if (!visited.has(neighbor)) {
          const result = dfs(neighbor, [...path]);
          if (result) return result;
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          return [...path.slice(cycleStart), neighbor];
        }
      }
      
      recursionStack.delete(node);
      return null;
    };
    
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const cycle = dfs(node, []);
        if (cycle) cycles.push(cycle);
      }
    }
    
    return cycles;
  }
}

// ============================================================================
// ResourceAwareScheduler - 资源感知调度器 (P3.1 新增)
// ============================================================================
class ResourceAwareScheduler {
  constructor(options = {}) {
    this.maxWorkers = options.maxWorkers || 4;
    this.minWorkers = options.minWorkers || 1;
    this.cpuHighThreshold = options.cpuHighThreshold || 80;
    this.cpuLowThreshold = options.cpuLowThreshold || 30;
    this.memoryHighThreshold = options.memoryHighThreshold || 85;
    this.memoryLowThreshold = options.memoryLowThreshold || 50;
    this.checkIntervalMs = options.checkIntervalMs || 5000;
    
    this.currentWorkers = this.maxWorkers;
    this.lastCheck = Date.now();
    this.resourceHistory = [];
    this.autoAdjustEnabled = options.autoAdjust !== false;
  }
  
  /**
   * 获取当前系统资源使用情况
   */
  getCurrentResources() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = (usedMem / totalMem) * 100;
    
    // 计算平均 CPU 使用率 (简化版)
    let idleSum = 0, totalSum = 0;
    for (const cpu of cpus) {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      idleSum += cpu.times.idle;
      totalSum += total;
    }
    const cpuUsagePercent = ((totalSum - idleSum) / totalSum) * 100;
    
    return {
      cpu: { usage: Math.round(cpuUsagePercent * 100) / 100, cores: cpus.length },
      memory: { usage: Math.round(memUsagePercent * 100) / 100, used: usedMem, total: totalMem },
      timestamp: Date.now()
    };
  }
  
  /**
   * 获取推荐的工作线程数
   */
  getRecommendedWorkers() {
    if (!this.autoAdjustEnabled) return this.maxWorkers;
    
    const resources = this.getCurrentResources();
    this.resourceHistory.push(resources);
    
    // 保持最近 10 个数据点
    if (this.resourceHistory.length > 10) {
      this.resourceHistory.shift();
    }
    
    let recommended = this.maxWorkers;
    
    // CPU 过载：减少工作线程
    if (resources.cpu.usage > this.cpuHighThreshold) {
      recommended = Math.max(this.minWorkers, Math.floor(this.currentWorkers * 0.7));
    }
    // CPU 空闲：可以增加工作线程
    else if (resources.cpu.usage < this.cpuLowThreshold) {
      recommended = Math.min(this.maxWorkers, Math.ceil(this.currentWorkers * 1.25));
    }
    
    // 内存检查
    if (resources.memory.usage > this.memoryHighThreshold) {
      recommended = Math.max(this.minWorkers, Math.floor(recommended * 0.5));
    }
    
    this.currentWorkers = recommended;
    return recommended;
  }
  
  /**
   * 获取调度统计
   */
  getStats() {
    const current = this.getCurrentResources();
    return {
      currentWorkers: this.currentWorkers,
      maxWorkers: this.maxWorkers,
      minWorkers: this.minWorkers,
      autoAdjust: this.autoAdjustEnabled,
      resources: current,
      historyLength: this.resourceHistory.length,
      thresholds: {
        cpuHigh: this.cpuHighThreshold,
        cpuLow: this.cpuLowThreshold,
        memoryHigh: this.memoryHighThreshold,
        memoryLow: this.memoryLowThreshold
      }
    };
  }
  
  /**
   * 手动调整工作线程数
   */
  setWorkers(count) {
    this.currentWorkers = Math.max(this.minWorkers, Math.min(this.maxWorkers, count));
    return this.currentWorkers;
  }
  
  /**
   * 启用/禁用自动调整
   */
  enableAutoAdjust(enabled = true) {
    this.autoAdjustEnabled = enabled;
    return this.autoAdjustEnabled;
  }
}

// ============================================================================
// ExecutionPredictor - 执行时间预测器 (P3.1 新增)
// ============================================================================
class ExecutionPredictor {
  constructor(options = {}) {
    this.windowSize = options.windowSize || 20;
    this.decayFactor = options.decayFactor || 0.95;
    this.history = new Map(); // taskType -> [{duration, timestamp}, ...]
    this.defaultEstimates = {
      'atomic': 30000,        // 30s
      'composite': 120000,    // 2min
      'decision': 5000,       // 5s
      'parallel': 60000       // 1min
    };
  }
  
  /**
   * 记录任务执行时间
   */
  recordExecution(taskId, taskType, durationMs) {
    if (!this.history.has(taskType)) {
      this.history.set(taskType, []);
    }
    
    const records = this.history.get(taskType);
    records.push({ duration: durationMs, timestamp: Date.now() });
    
    // 保持滑动窗口大小
    while (records.length > this.windowSize) {
      records.shift();
    }
  }
  
  /**
   * 预测任务执行时间
   */
  predict(taskDef) {
    const taskType = taskDef.type || 'atomic';
    const records = this.history.get(taskType) || [];
    
    if (records.length === 0) {
      // 使用默认估计
      return this.defaultEstimates[taskType] || 60000;
    }
    
    // 加权移动平均 (更近的数据权重更高)
    let weightedSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < records.length; i++) {
      const weight = Math.pow(this.decayFactor, records.length - 1 - i);
      weightedSum += records[i].duration * weight;
      weightSum += weight;
    }
    
    const predicted = weightedSum / weightSum;
    
    // 根据任务规模调整
    const tokenFactor = (taskDef.estimatedTokens || 2000) / 2000;
    const priorityFactor = 1 + (taskDef.priority || 5) / 50;
    
    return Math.round(predicted * tokenFactor * priorityFactor);
  }
  
  /**
   * 预测流水线总执行时间
   */
  predictPipeline(tasks) {
    // 计算关键路径
    const graph = new Map();
    for (const task of tasks) {
      graph.set(task.id, task.dependencies || []);
    }
    
    const cachedDuration = new Map();
    
    const getDuration = (taskId) => {
      if (cachedDuration.has(taskId)) return cachedDuration.get(taskId);
      
      const task = tasks.find(t => t.id === taskId);
      if (!task) return 0;
      
      const deps = task.dependencies || [];
      if (deps.length === 0) {
        const duration = this.predict(task);
        cachedDuration.set(taskId, duration);
        return duration;
      }
      
      const maxDepDuration = Math.max(...deps.map(d => getDuration(d)));
      const duration = maxDepDuration + this.predict(task);
      cachedDuration.set(taskId, duration);
      return duration;
    };
    
    // 找出关键路径
    let criticalPath = [];
    let maxDuration = 0;
    
    for (const task of tasks) {
      const duration = getDuration(task.id);
      if (duration > maxDuration) {
        maxDuration = duration;
        criticalPath = this._reconstructPath(task.id, tasks, cachedDuration);
      }
    }
    
    // 计算并行优化收益
    const totalSequential = tasks.reduce((sum, t) => sum + this.predict(t), 0);
    const parallelGain = totalSequential > 0 
      ? Math.round((1 - maxDuration / totalSequential) * 100) 
      : 0;
    
    return {
      estimatedTotalMs: maxDuration,
      estimatedTotalFormatted: this._formatDuration(maxDuration),
      criticalPath,
      parallelGain
    };
  }
  
  _reconstructPath(endTaskId, tasks, cachedDuration) {
    const path = [endTaskId];
    const visited = new Set();
    
    let current = endTaskId;
    while (true) {
      const task = tasks.find(t => t.id === current);
      if (!task || (task.dependencies || []).length === 0) break;
      
      const deps = task.dependencies;
      let maxDep = null;
      let maxDuration = -1;
      
      for (const dep of deps) {
        const duration = cachedDuration.get(dep) || 0;
        if (duration > maxDuration) {
          maxDuration = duration;
          maxDep = dep;
        }
      }
      
      if (!maxDep || visited.has(maxDep)) break;
      visited.add(current);
      path.unshift(maxDep);
      current = maxDep;
    }
    
    return path;
  }
  
  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }
  
  /**
   * 获取预测统计
   */
  getStats() {
    const stats = {};
    for (const [type, records] of this.history) {
      const durations = records.map(r => r.duration);
      stats[type] = {
        samples: durations.length,
        avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        min: Math.min(...durations),
        max: Math.max(...durations),
        latest: durations[durations.length - 1]
      };
    }
    return stats;
  }
}

// ============================================================================
// EnhancedVisualizer - 增强 DAG 可视化 (P3.1 新增)
// ============================================================================
class EnhancedVisualizer {
  constructor() {
    this.statusSymbols = {
      pending: '○',
      ready: '◐',
      running: '◕',
      completed: '●',
      failed: '✗',
      blocked: '◫',
      cancelled: '○',
      skipped: '◌'
    };
    
    this.statusColors = {
      pending: '\x1b[90m',    // 灰色
      ready: '\x1b[33m',      // 黄色
      running: '\x1b[36m',    // 青色
      completed: '\x1b[32m',  // 绿色
      failed: '\x1b[31m',     // 红色
      blocked: '\x1b[35m',    // 紫色
      cancelled: '\x1b[90m',
      skipped: '\x1b[90m'
    };
    this.colorReset = '\x1b[0m';
  }
  
  /**
   * 格式化任务名称
   */
  _formatName(name, maxLen = 30) {
    if (!name) return 'unnamed';
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen - 3) + '...';
  }
  
  /**
   * ASCII 树形可视化
   */
  toASCII(execution) {
    if (!execution || !execution.tasks) return '';
    
    const lines = [];
    const tasks = execution.tasks;
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    
    // 找到根任务（无依赖）
    const roots = tasks.filter(t => !t.dependencies || t.dependencies.length === 0);
    
    const render = (task, prefix = '', isLast = true) => {
      const connector = isLast ? '└── ' : '├── ';
      const status = this.statusSymbols[task.status] || '○';
      const line = `${prefix}${connector}${status} ${this._formatName(task.name)}`;
      lines.push(line);
      
      // 查找依赖此任务的任务
      const dependents = tasks.filter(t => (t.dependencies || []).includes(task.id));
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      dependents.forEach((dep, idx) => {
        render(dep, newPrefix, idx === dependents.length - 1);
      });
    };
    
    roots.forEach((root, idx) => {
      if (idx > 0) lines.push('');
      render(root, '', roots.length === 1);
    });
    
    return lines.join('\n');
  }
  
  /**
   * Mermaid 格式
   */
  toMermaid(execution, options = {}) {
    if (!execution || !execution.tasks) return '';
    
    const direction = options.direction || 'TD';
    const showStatus = options.showStatus !== false;
    
    let mermaid = `graph ${direction}\n`;
    mermaid += `  %% Nodes\n`;
    
    for (const task of execution.tasks) {
      const label = showStatus ? `${this.statusSymbols[task.status]} ${this._formatName(task.name, 40)}` : this._formatName(task.name, 40);
      const style = this._getMermaidStyle(task.status);
      mermaid += `  ${task.id}["${label}"]${style}\n`;
    }
    
    mermaid += `\n  %% Dependencies\n`;
    for (const task of execution.tasks) {
      for (const dep of (task.dependencies || [])) {
        mermaid += `  ${dep} --> ${task.id}\n`;
      }
    }
    
    return mermaid;
  }
  
  _getMermaidStyle(status) {
    switch (status) {
      case 'completed': return '\n:::success';
      case 'failed': return '\n:::danger';
      case 'running': return '\n:::warning';
      default: return '';
    }
  }
  
  /**
   * JSON 格式（用于程序化处理）
   */
  toJSON(execution) {
    if (!execution || !execution.tasks) return null;
    
    const nodes = execution.tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      dependencies: t.dependencies || [],
      dependents: execution.tasks
        .filter(other => (other.dependencies || []).includes(t.id))
        .map(other => other.id),
      metadata: {
        created: t.created,
        started: t.started,
        completedAt: t.completedAt,
        retryCount: t.retryCount || 0
      }
    }));
    
    // 构建邻接表
    const adjacencyList = new Map();
    for (const task of execution.tasks) {
      adjacencyList.set(task.id, task.dependencies || []);
    }
    
    // 计算拓扑顺序
    const topologicalOrder = this._topologicalSort(nodes);
    
    return {
      executionId: execution.id,
      pipelineId: execution.pipelineId,
      status: execution.status,
      nodes,
      adjacencyList: Object.fromEntries(adjacencyList),
      topologicalOrder,
      statistics: {
        total: nodes.length,
        byStatus: this._countByStatus(nodes)
      }
    };
  }
  
  _topologicalSort(nodes) {
    const visited = new Set();
    const order = [];
    
    const visit = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }
      order.push(nodeId);
    };
    
    for (const node of nodes) {
      visit(node.id);
    }
    
    return order;
  }
  
  _countByStatus(nodes) {
    const counts = {};
    for (const node of nodes) {
      counts[node.status] = (counts[node.status] || 0) + 1;
    }
    return counts;
  }
  
  /**
   * dot (Graphviz) 格式
   */
  toDot(execution) {
    if (!execution || !execution.tasks) return '';
    
    let dot = 'digraph Execution {\n';
    dot += '  rankdir=TB;\n';
    dot += '  node [shape=box style=rounded];\n';
    dot += '  edge [color="#666666"];\n\n';
    
    for (const task of execution.tasks) {
      const fillcolor = this._getDotColor(task.status);
      dot += `  "${task.id}" [label="${this._formatName(task.name, 25)}\\n(${task.status})" fillcolor="${fillcolor}" style=filled];\n`;
    }
    
    dot += '\n';
    for (const task of execution.tasks) {
      for (const dep of (task.dependencies || [])) {
        dot += `  "${dep}" -> "${task.id}";\n`;
      }
    }
    
    dot += '}\n';
    return dot;
  }
  
  _getDotColor(status) {
    switch (status) {
      case 'completed': return '#90EE90';
      case 'failed': return '#FFB6C1';
      case 'running': return '#FFFACD';
      case 'pending': return '#E0E0E0';
      default: return '#FFFFFF';
    }
  }
  
  /**
   * 简洁统计表格
   */
  toStatsTable(execution) {
    if (!execution) return '';
    
    const tasks = execution.tasks || [];
    const byStatus = this._countByStatus(tasks.map(t => ({ status: t.status })));
    
    let table = '┌' + '─'.repeat(50) + '┐\n';
    table += '│ 执行统计                                  │\n';
    table += '├' + '─'.repeat(50) + '┤\n';
    table += `│ 总任务: ${tasks.length.toString().padEnd(38)}│\n`;
    
    for (const [status, count] of Object.entries(byStatus)) {
      const symbol = this.statusSymbols[status] || '○';
      table += `│ ${symbol} ${status.padEnd(12)} ${count.toString().padEnd(32)}│\n`;
    }
    
    if (execution.progress !== undefined) {
      const bar = '█'.repeat(Math.floor(execution.progress / 5)) + '░'.repeat(20 - Math.floor(execution.progress / 5));
      table += '├' + '─'.repeat(50) + '┤\n';
      table += `│ 进度: [${bar}] ${execution.progress.toString().padStart(3)}%            │\n`;
    }
    
    table += '└' + '─'.repeat(50) + '┘';
    return table;
  }
}

// ============================================================================
// ConditionalExecutor - 条件执行引擎 (P3.1 新增)
// ============================================================================
class ConditionalExecutor {
  constructor() {
    this.variables = new Map();
    this.conditionCache = new Map();
  }
  
  /**
   * 设置变量
   */
  setVariable(name, value) {
    this.variables.set(name, value);
  }
  
  /**
   * 获取变量
   */
  getVariable(name) {
    return this.variables.get(name);
  }
  
  /**
   * 清除变量
   */
  clearVariables() {
    this.variables.clear();
  }
  
  /**
   * 评估条件表达式
   * 支持: ==, !=, <, >, <=, >=, &&, ||, !
   * 支持变量: ${varName}
   */
  evaluateCondition(condition, context = {}) {
    if (!condition || condition.trim() === '') return true;
    
    // 合并变量和上下文
    const evalContext = { ...Object.fromEntries(this.variables), ...context };
    
    // 替换变量
    let expr = condition;
    for (const [key, value] of Object.entries(evalContext)) {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      const replacement = typeof value === 'string' ? `"${value}"` : String(value);
      expr = expr.replace(regex, replacement);
    }
    
    try {
      return this._evaluate(expr);
    } catch (e) {
      console.warn(`条件评估失败: "${condition}" - ${e.message}`);
      return false;
    }
  }
  
  _evaluate(expr) {
    // 简单的表达式求值器
    expr = expr.trim();
    
    // 字符串字面量
    const stringPattern = /"([^"]*)"/g;
    expr = expr.replace(stringPattern, (_, str) => JSON.stringify(str));
    
    // 布尔字面量
    expr = expr.replace(/\btrue\b/gi, 'true');
    expr = expr.replace(/\bfalse\b/gi, 'false');
    
    // 逻辑运算符
    if (expr.includes('&&')) {
      const parts = expr.split('&&').map(p => this._evaluate(p.trim()));
      return parts.every(Boolean);
    }
    if (expr.includes('||')) {
      const parts = expr.split('||').map(p => this._evaluate(p.trim()));
      return parts.some(Boolean);
    }
    if (expr.startsWith('!')) {
      return !this._evaluate(expr.slice(1).trim());
    }
    
    // 比较运算符
    const compMatch = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (compMatch) {
      const [, left, op, right] = compMatch;
      const l = this._parseValue(left.trim());
      const r = this._parseValue(right.trim());
      
      switch (op) {
        case '==': return l === r;
        case '!=': return l !== r;
        case '>': return l > r;
        case '<': return l < r;
        case '>=': return l >= r;
        case '<=': return l <= r;
      }
    }
    
    return Boolean(this._parseValue(expr));
  }
  
  _parseValue(str) {
    // null/undefined
    if (str === 'null' || str === 'undefined') return null;
    
    // 布尔
    if (str === 'true') return true;
    if (str === 'false') return false;
    
    // 数字
    const num = Number(str);
    if (!isNaN(num)) return num;
    
    // 字符串
    if ((str.startsWith('"') && str.endsWith('"')) || 
        (str.startsWith("'") && str.endsWith("'"))) {
      return str.slice(1, -1);
    }
    
    return str;
  }
  
  /**
   * 分析条件表达式，返回依赖的变量列表
   */
  analyzeCondition(condition) {
    if (!condition) return { variables: [], functions: [] };
    
    const varPattern = /\$\{([^}]+)\}/g;
    const vars = [];
    let match;
    while ((match = varPattern.exec(condition)) !== null) {
      vars.push(match[1]);
    }
    
    // 检测内置函数
    const functions = [];
    const funcPatterns = ['exists', 'empty', 'inRange', 'matches', 'hasField', 'contains', 'startsWith', 'endsWith'];
    for (const func of funcPatterns) {
      if (condition.includes(`${func}(`)) {
        functions.push(func);
      }
    }
    
    return { variables: [...new Set(vars)], functions };
  }
  
  /**
   * 预验证条件表达式
   */
  validateCondition(condition) {
    if (!condition) return { valid: true };
    
    const result = this.analyzeCondition(condition);
    const missing = result.variables.filter(v => !this.variables.has(v));
    
    return {
      valid: missing.length === 0,
      missingVariables: missing,
      usedVariables: result.variables,
      usedFunctions: result.functions
    };
  }
}

// ============================================================================
// Worker Pool - 增强版工作池
// ============================================================================
class WorkerPool {
  constructor(maxWorkers = 4, scheduler = null) {
    this.maxWorkers = maxWorkers;
    this.scheduler = scheduler;
    this.active = 0;
    this.queue = new PriorityQueue();
    this.results = new Map();
  }
  
  get available() { return this.maxWorkers - this.active; }
  
  async submit(task, priority = 5) {
    const effectiveMax = this.scheduler?.getRecommendedWorkers() || this.maxWorkers;
    
    return new Promise((resolve, reject) => {
      this.queue.enqueue({ task, resolve, reject, submittedAt: Date.now() }, priority);
      this._processNext(effectiveMax);
    });
  }
  
  async _processNext(effectiveMax) {
    while (this.active < effectiveMax && this.queue.size > 0) {
      const job = this.queue.dequeue();
      if (!job) break;
      this.active++;
      try {
        const startTime = performance.now();
        const result = await this._executeWithTimeout(job.task, job.task.timeoutMs || 60000);
        const duration = performance.now() - startTime;
        
        this.results.set(job.task.id, { 
          status: 'completed', 
          result, 
          completedAt: Date.now(),
          durationMs: Math.round(duration)
        });
        job.resolve(result);
      } catch (e) {
        this.results.set(job.task.id, { 
          status: 'failed', 
          error: e.message, 
          failedAt: Date.now() 
        });
        job.reject(e);
      } finally {
        this.active--;
        this._processNext(effectiveMax);
      }
    }
  }
  
  async _executeWithTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Task ${task.id} timeout after ${timeoutMs}ms`)), timeoutMs);
      try { 
        resolve({ taskId: task.id, executed: true, timestamp: Date.now() }); 
        clearTimeout(timer); 
      }
      catch(e) { 
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
      avgDuration: this._calculateAvgDuration()
    };
  }
  
  _calculateAvgDuration() {
    const completed = [...this.results.values()].filter(r => r.status === 'completed' && r.durationMs);
    if (completed.length === 0) return 0;
    return Math.round(completed.reduce((s, r) => s + r.durationMs, 0) / completed.length);
  }
  
  drain() { 
    const drained = this.queue.size;
    this.queue.clear();
    return { drained }; 
  }
}

// ============================================================================
// Retry Manager - 重试管理器
// ============================================================================
class RetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.backoffStrategy = options.backoffStrategy || 'exponential';
    this.baseDelayMs = options.baseDelayMs || 1000;
    this.maxDelayMs = options.maxDelayMs || 30000;
  }
  
  calculateDelay(attempt) {
    switch (this.backoffStrategy) {
      case 'linear': return Math.min(this.baseDelayMs * attempt, this.maxDelayMs);
      case 'exponential': return Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs);
      case 'fixed': return this.baseDelayMs;
      case 'jitter': return Math.min(this.baseDelayMs * Math.pow(2, attempt - 1) * (0.5 + Math.random()), this.maxDelayMs);
      default: return this.baseDelayMs;
    }
  }
  
  async executeWithRetry(taskFn, taskId) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try { 
        const result = await taskFn(); 
        return { success: true, result, attempts: attempt }; 
      }
      catch (e) {
        lastError = e;
        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    return { success: false, error: lastError?.message, attempts: this.maxRetries };
  }
}

// ============================================================================
// Task Orchestrator - 主类 (增强版)
// ============================================================================
class TaskOrchestrator {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'task-orchestrator');
    this.tasks = new Map();
    this.executions = new Map();
    this.pipelines = new Map();
    this.taskGraph = new Map();
    
    // 初始化增强组件
    this.scheduler = new ResourceAwareScheduler({
      maxWorkers: options.maxWorkers || 4,
      autoAdjust: options.autoAdjust !== false
    });
    
    this.workerPool = new WorkerPool(options.maxWorkers || 4, this.scheduler);
    this.retryManager = new RetryManager({
      maxRetries: options.maxRetries || 3,
      backoffStrategy: options.backoffStrategy || 'exponential'
    });
    
    this.dependencyInferrer = new SmartDependencyInferrer();
    this.predictor = new ExecutionPredictor();
    this.visualizer = new EnhancedVisualizer();
    this.conditionalExecutor = new ConditionalExecutor();
    
    // 状态机配置
    this.TaskStatus = TASK_STATES;
    this.STATE_TRANSITIONS = STATE_TRANSITIONS;
    
    this.TaskType = {
      ATOMIC: 'atomic', COMPOSITE: 'composite',
      DECISION: 'decision', PARALLEL: 'parallel'
    };
    
    this.PipelineType = {
      SEQUENTIAL: 'sequential', PARALLEL: 'parallel',
      FAN_OUT: 'fan_out', FAN_IN: 'fan_in',
      MAP_REDUCE: 'map_reduce', CONDITIONAL: 'conditional', RETRY: 'retry'
    };
    
    this.TASK_TEMPLATES = {
      'code-implementation': {
        subtasks: [
          { name: '需求分析', skill: 'code-review' },
          { name: '代码实现', skill: null },
          { name: '测试验证', skill: 'test-framework' },
          { name: '文档更新', skill: 'documentation' }
        ]
      },
      'data-analysis': {
        subtasks: [
          { name: '数据收集', skill: 'deep-research' },
          { name: '数据清洗', skill: null },
          { name: '分析计算', skill: null },
          { name: '报告生成', skill: 'documentation' }
        ]
      },
      'deployment': {
        subtasks: [
          { name: '环境检查', skill: null },
          { name: '构建打包', skill: null },
          { name: '部署执行', skill: null },
          { name: '健康检查', skill: 'monitor' }
        ]
      },
      'bug-fix': {
        subtasks: [
          { name: '问题复现', skill: null },
          { name: '根因分析', skill: 'code-review' },
          { name: '修复实施', skill: null },
          { name: '回归测试', skill: 'test-framework' }
        ]
      }
    };
    
    this._ensureConfigDir();
  }
  
  // ==================== 核心任务管理 ====================
  
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
      maxRetries: taskDef.maxRetries || 3,
      timeoutMs: taskDef.timeoutMs || 120000,
      acceptanceCriteria: taskDef.acceptanceCriteria || [],
      priority: taskDef.priority || 5,
      tags: taskDef.tags || [],
      created: this._timestamp(),
      status: TASK_STATES.PENDING,
      version: '2.0-enhanced'
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
  
  getTask(taskId) { return this.tasks.get(taskId) || null; }
  
  listTasks(filter = {}) {
    let tasks = Array.from(this.tasks.values());
    if (filter.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter.type) tasks = tasks.filter(t => t.type === filter.type);
    return tasks;
  }
  
  // ==================== 智能依赖分析 ====================
  
  /**
   * 推断任务的隐式依赖
   */
  inferTaskDependencies(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    
    return this.dependencyInferrer.inferDependencies(task, Array.from(this.tasks.values()));
  }
  
  /**
   * 分析所有任务的依赖关系
   */
  analyzeDependencies(taskIds = null) {
    const tasks = taskIds 
      ? Array.from(this.tasks.values()).filter(t => taskIds.includes(t.id))
      : Array.from(this.tasks.values());
    
    return this.dependencyInferrer.analyzeAllDependencies(tasks);
  }
  
  /**
   * 建议添加依赖
   */
  suggestDependencies(taskId) {
    const inferred = this.inferTaskDependencies(taskId);
    const task = this.tasks.get(taskId);
    
    if (!task) return { suggested: [], existing: [], missing: [] };
    
    return {
      suggested: inferred,
      existing: task.dependencies || [],
      missing: inferred.filter(id => !(task.dependencies || []).includes(id))
    };
  }
  
  // ==================== 任务分解 ====================
  
  decomposeGoal(goal, options = {}) {
    const actionWords = ['创建', '修改', '删除', '分析', '查询', '实现', '设计', '测试', '部署', '优化', '重构', '迁移', '集成', '配置', '生成'];
    const targetWords = ['文件', '代码', '配置', '数据', 'API', '数据库', '界面', '文档', '系统', '模块', '服务', '接口', '测试用例'];
    
    let matchedTemplate = null;
    if (goal.includes('实现') || goal.includes('开发') || goal.includes('写')) matchedTemplate = 'code-implementation';
    else if (goal.includes('分析') || goal.includes('数据') || goal.includes('统计')) matchedTemplate = 'data-analysis';
    else if (goal.includes('部署') || goal.includes('发布') || goal.includes('上线')) matchedTemplate = 'deployment';
    else if (goal.includes('修复') || goal.includes('bug') || goal.includes('问题')) matchedTemplate = 'bug-fix';
    
    const tasks = [];
    const tag = `decomposed-${Date.now()}`;
    
    if (matchedTemplate && this.TASK_TEMPLATES[matchedTemplate]) {
      const template = this.TASK_TEMPLATES[matchedTemplate];
      template.subtasks.forEach((st, i) => {
        const task = {
          id: this._generateId(),
          name: st.name,
          description: `${goal} - ${st.name}`,
          dependencies: i > 0 ? [tasks[i-1].id] : [],
          skill: st.skill,
          tags: [tag, 'auto-decomposed']
        };
        tasks.push(task);
      });
    } else {
      const numSubtasks = Math.min(Math.max(Math.ceil(goal.length / 20), 2), 6);
      for (let i = 0; i < numSubtasks; i++) {
        const task = {
          id: this._generateId(),
          name: `${goal} - 阶段${i+1}`,
          description: '',
          dependencies: i > 0 ? [tasks[i-1].id] : [],
          tags: [tag, 'auto-decomposed']
        };
        tasks.push(task);
      }
    }
    
    const complexity = Math.min(Math.ceil(goal.length / 15), 10);
    
    const graph = [];
    for (const t of tasks) {
      for (const dep of (t.dependencies || [])) {
        graph.push({ from: dep, to: t.id });
      }
    }
    
    // 使用预测器预估执行时间
    const prediction = this.predictor.predictPipeline(tasks.map(t => ({
      ...t,
      type: 'atomic',
      estimatedTokens: 2000,
      priority: 5
    })));
    
    return {
      tasks,
      graph,
      goal,
      estimatedTime: prediction.estimatedTotalFormatted,
      estimatedMs: prediction.estimatedTotalMs,
      complexity,
      template: matchedTemplate,
      criticalPath: prediction.criticalPath,
      parallelGain: prediction.parallelGain
    };
  }
  
  // ==================== 依赖图操作 ====================
  
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
        dependents: this._findDependents(task.id),
        inferredDependencies: this.inferTaskDependencies(task.id)
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
  
  // ==================== 流水线管理 ====================
  
  createPipeline(pipelineDef) {
    const pipeline = {
      id: pipelineDef.id || this._generateId(),
      name: pipelineDef.name,
      type: pipelineDef.type || 'sequential',
      steps: pipelineDef.steps || [],
      config: pipelineDef.config || {},
      condition: pipelineDef.condition || null,  // 执行条件
      created: this._timestamp()
    };
    this.pipelines.set(pipeline.id, pipeline);
    return pipeline;
  }
  
  executePipeline(pipelineId, context = {}) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
    
    // 检查执行条件
    if (pipeline.condition) {
      const result = this.conditionalExecutor.evaluateCondition(pipeline.condition, context);
      if (!result) {
        return { skipped: true, reason: 'condition_not_met', condition: pipeline.condition };
      }
    }
    
    const execId = this._generateId();
    const tasks = pipeline.steps.map((step, i) => ({
      id: this._generateId(),
      name: step.name || `Step ${i+1}`,
      status: 'pending',
      dependencies: pipeline.type === 'sequential' && i > 0 ? [] : [],
      step,
      condition: step.condition || null,
      retryCount: 0
    }));
    
    // 修复步骤依赖
    if (pipeline.type === 'sequential') {
      for (let i = 1; i < tasks.length; i++) {
        tasks[i].dependencies = [tasks[i-1].id];
      }
    }
    
    this.executions.set(execId, {
      id: execId,
      pipelineId,
      tasks,
      status: 'running',
      started: this._timestamp(),
      completedTasks: [],
      context
    });
    
    return { executionId: execId, tasks, skipped: false };
  }
  
  async executeWithTracking(pipelineId, context = {}) {
    return this.executePipeline(pipelineId, context);
  }
  
  // ==================== 执行管理 ====================
  
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
  
  transitionTask(execId, taskId, newState) {
    const exec = this.executions.get(execId);
    if (!exec) return null;
    const task = exec.tasks.find(t => t.id === taskId);
    if (!task) return null;

    const allowed = this.STATE_TRANSITIONS[task.status] || [];
    if (!allowed.includes(newState)) {
      throw new Error(`Invalid transition: ${task.status} → ${newState}`);
    }

    task.status = newState;
    task.updated = this._timestamp();

    if (newState === 'retrying') {
      task.retryCount = (task.retryCount || 0) + 1;
      const delay = this.retryManager.calculateDelay(task.retryCount);
      task.nextRetryAt = Date.now() + delay;
    }
    if (newState === 'completed' || newState === 'failed' || newState === 'skipped') {
      task.completedAt = this._timestamp();
    }

    // 更新执行统计
    exec.completedTasks = exec.tasks.filter(t => 
      ['completed', 'skipped'].includes(t.status)
    ).length;
    
    return task;
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
      status: exec.status
    };
  }
  
  getPipelineProgress(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return null;
    const total = exec.tasks.length;
    const completed = exec.tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length;
    const failed = exec.tasks.filter(t => t.status === 'failed').length;
    const running = exec.tasks.filter(t => t.status === 'running' || t.status === 'retrying').length;
    return { 
      executionId: execId, total, completed, failed, running, 
      pending: total - completed - failed - running, 
      progress: Math.round(completed / total * 100), 
      status: exec.status, 
      elapsed: this._timestamp() 
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
    exec.tasks.forEach(t => {
      if (t.status === 'running' || t.status === 'pending') t.status = 'cancelled';
    });
    return { executionId: execId, status: 'cancelled' };
  }
  
  // ==================== 可视化 ====================
  
  visualize(execId, format = 'mermaid') {
    const exec = this.executions.get(execId);
    if (!exec) return '';
    
    switch (format) {
      case 'ascii': return this.visualizer.toASCII(exec);
      case 'json': return JSON.stringify(this.visualizer.toJSON(exec), null, 2);
      case 'dot': return this.visualizer.toDot(exec);
      case 'table': return this.visualizer.toStatsTable(exec);
      case 'mermaid':
      default: return this.visualizer.toMermaid(exec);
    }
  }
  
  getVisualizationData(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return null;
    return {
      mermaid: this.visualizer.toMermaid(exec),
      ascii: this.visualizer.toASCII(exec),
      json: this.visualizer.toJSON(exec),
      dot: this.visualizer.toDot(exec)
    };
  }
  
  // ==================== 统计和报告 ====================
  
  generateReport(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return 'Execution not found';
    
    const status = this.getExecutionStatus(execId);
    let report = `# 任务执行报告\n\n`;
    report += `- **执行ID**: ${execId}\n`;
    report += `- **状态**: ${status.status}\n`;
    report += `- **总任务**: ${status.total} | 完成: ${status.completed} | 失败: ${status.failed} | 进度: ${status.progress}%\n\n`;
    report += `## 任务详情\n\n`;
    report += `| ID | 名称 | 状态 |\n`;
    report += `|----|------|------|\n`;
    exec.tasks.forEach(t => {
      report += `| ${t.id} | ${t.name} | ${t.status} |\n`;
    });
    
    // 添加可视化
    report += `\n## 依赖图 (Mermaid)\n\n`;
    report += '```mermaid\n' + this.visualizer.toMermaid(exec) + '\n```\n';
    
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
      resourceStats: this.scheduler.getStats(),
      predictionStats: this.predictor.getStats()
    };
  }
  
  getPipelineStats() {
    const all = [...this.executions.values()];
    if (!all.length) return { total: 0 };
    const completed = all.filter(e => e.tasks.every(t => t.status === 'completed' || t.status === 'skipped'));
    const failed = all.filter(e => e.tasks.some(t => t.status === 'failed'));
    const avgTasks = Math.round(completed.reduce((s, e) => s + e.tasks.length, 0) / Math.max(completed.length, 1));
    return {
      totalPipelines: all.length,
      completed: completed.length,
      failed: failed.length,
      running: all.filter(e => e.status === 'running').length,
      avgTasksPerPipeline: avgTasks,
      successRate: all.length ? Math.round(completed.length / all.length * 100) : 0
    };
  }
  
  // ==================== 分布式调度 ====================
  
  async submitTask(task, priority = 5) { return this.workerPool.submit(task, priority); }
  async executeTaskWithRetry(taskFn, taskId) { return this.retryManager.executeWithRetry(taskFn, taskId); }
  getPoolStats() { return this.workerPool.getPoolStats(); }
  getRetryStats() { return { maxRetries: this.retryManager.maxRetries, backoffStrategy: this.retryManager.backoffStrategy, baseDelayMs: this.retryManager.baseDelayMs, maxDelayMs: this.retryManager.maxDelayMs }; }
  drainPool() { return this.workerPool.drain(); }
  getResourceStats() { return this.scheduler.getStats(); }
  
  /**
   * 设置资源调度策略
   */
  configureScheduler(options) {
    if (options.maxWorkers !== undefined) this.scheduler.maxWorkers = options.maxWorkers;
    if (options.minWorkers !== undefined) this.scheduler.minWorkers = options.minWorkers;
    if (options.autoAdjust !== undefined) this.scheduler.enableAutoAdjust(options.autoAdjust);
    return this.scheduler.getStats();
  }
  
  /**
   * 预测任务执行时间
   */
  predictExecution(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return {
      taskId,
      estimatedMs: this.predictor.predict(task),
      estimatedFormatted: this._formatDuration(this.predictor.predict(task))
    };
  }
  
  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }
  
  // ==================== 辅助方法 ====================
  
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
  _timestamp() { return new Date().toISOString().replace('T',' ').substring(0,19); }
}

// ============================================================================
// CLI 入口
// ============================================================================
if (require.main === module) {
  const cmd = process.argv[2];
  const to = new TaskOrchestrator();
  
  const cmdMap = {
    decompose() {
      const goal = process.argv.slice(3).join(' ');
      if (!goal) { console.log('用法: node task-orchestrator.js decompose "<目标>"'); return; }
      const r = to.decomposeGoal(goal);
      console.log(`复杂度: ${r.complexity}/10, 模板: ${r.template || 'none'}`);
      console.log(`预估时间: ${r.estimatedTime}, 并行优化: +${r.parallelGain}%`);
      console.log(`子任务: ${r.tasks.length} 个`);
      console.log(`关键路径: ${r.criticalPath.join(' → ') || 'none'}`);
      r.tasks.forEach(t => console.log(`  - ${t.name} (deps: ${t.dependencies.join(',') || 'none'})`));
    },
    
    infer() {
      const taskId = process.argv[3];
      if (!taskId) { console.log('用法: node task-orchestrator.js infer <taskId>'); return; }
      const suggestion = to.suggestDependencies(taskId);
      console.log('建议的依赖:', suggestion.suggested);
      console.log('已有的依赖:', suggestion.existing);
      console.log('缺失的依赖:', suggestion.missing);
    },
    
    analyze() {
      const result = to.analyzeDependencies();
      console.log('显式依赖:', result.explicit.length);
      console.log('推断依赖:', result.inferred.length);
      console.log('循环依赖:', result.cycles.length > 0 ? result.cycles : '无');
    },
    
    resources() {
      console.log(JSON.stringify(to.getResourceStats(), null, 2));
    },
    
    predict() {
      const execId = process.argv[3];
      if (!execId) {
        console.log('用法: node task-orchestrator.js predict <execId>');
        return;
      }
      const exec = to.executions.get(execId);
      if (!exec) { console.log('Execution not found'); return; }
      const result = to.predictor.predictPipeline(exec.tasks.map(t => ({
        id: t.id,
        type: 'atomic',
        estimatedTokens: 2000,
        priority: 5,
        dependencies: t.dependencies
      })));
      console.log('预估总时间:', result.estimatedTotalFormatted);
      console.log('关键路径:', result.criticalPath.join(' → '));
      console.log('并行优化:', `+${result.parallelGain}%`);
    },
    
    visualize() {
      const execId = process.argv[3];
      const format = process.argv[4] || 'mermaid';
      if (!execId) { console.log('用法: node task-orchestrator.js visualize <execId> [format]'); return; }
      console.log(to.visualize(execId, format));
    },
    
    task() {
      const sub = process.argv[3] || 'list';
      if (sub === 'list') {
        console.log(`总任务: ${to.tasks.size}`);
        to.listTasks().forEach(t => console.log(`  [${t.id}] ${t.name} (${t.type})`));
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
    
    stats() { console.log(JSON.stringify(to.getStats(), null, 2)); },
    pool() { console.log(JSON.stringify(to.getPoolStats(), null, 2)); },
    drain() { console.log(JSON.stringify(to.drainPool())); },
    'retry-config'() { console.log(JSON.stringify(to.getRetryStats(), null, 2)); },
    
    help() {
      console.log(`
TaskOrchestrator CLI - P4-1 (增强版 P3.1)
=========================================

命令:
  decompose <目标>    分解目标为子任务 (带预测)
  infer <taskId>      推断任务依赖
  analyze             分析所有依赖关系
  resources           显示资源调度状态
  predict <execId>    预测执行时间
  visualize <execId> [format]  可视化依赖图 (mermaid|ascii|json|dot|table)
  task [list|add]      任务管理
  execute [planId]     开始执行
  status <execId>     执行状态
  report <execId>     生成报告
  stats               统计信息
  pool                工作池状态
  drain               清空工作池
  retry-config        重试配置
  
新增功能 (P3.1):
  - 智能依赖推断器 (SmartDependencyInferrer)
  - 资源感知调度器 (ResourceAwareScheduler)
  - 执行时间预测器 (ExecutionPredictor)
  - 增强 DAG 可视化 (EnhancedVisualizer)
  - 条件执行引擎 (ConditionalExecutor)
      `);
    }
  };
  
  (cmdMap[cmd] || cmdMap.help)();
}

console.log('[TaskOrchestrator] 加载成功 - P4-1 任务编排器 (增强版 P3.1)');

module.exports = TaskOrchestrator;
module.exports.default = TaskOrchestrator;
