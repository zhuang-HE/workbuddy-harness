#!/usr/bin/env node
/**
 * skill-analyzer - P4-11 技能分析器增强版
 * 维度: D3-Skills | 使用热力图·依赖图谱·质量评分·死技能检测·语义路由
 * 增强: 40% → 75%
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class SkillAnalyzer {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'skill-analyzer');
    this.skillsDir = options.skillsDir || path.join(os.homedir(), '.workbuddy', 'skills');
    this.skills = [];
    this.dependencies = new Map();
    this.usageLog = [];
    this.routingCache = new Map();
    this.triggerHistory = [];
    this._ensureDirs();
    this._loadState();
  }

  _ensureDirs() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
  }
  _ts() { return new Date().toISOString(); }

  _loadState() {
    try {
      const p = path.join(this.configDir, 'state.json');
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        this.usageLog = d.usageLog || [];
        this.dependencies = new Map(Object.entries(d.dependencies || {}));
        this.triggerHistory = d.triggerHistory || [];
      }
    } catch (e) {}
  }
  _saveState() {
    fs.writeFileSync(path.join(this.configDir, 'state.json'), JSON.stringify({
      usageLog: this.usageLog.slice(-500),
      dependencies: Object.fromEntries(this.dependencies),
      triggerHistory: this.triggerHistory.slice(-100),
      updated: this._ts()
    }, null, 2));
  }

  // ==================== 技能扫描 ====================

  scan(force = false) {
    if (this.skills.length > 0 && !force) return this.skills;

    this.skills = [];
    if (!fs.existsSync(this.skillsDir)) return [];

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillDir = path.join(this.skillsDir, e.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      const metaFile = path.join(skillDir, '_meta.json');

      if (!fs.existsSync(skillFile)) continue;

      try {
        const content = fs.readFileSync(skillFile, 'utf8');
        const meta = this._parseFrontmatter(content);
        const stats = fs.statSync(skillFile);

        const skill = {
          id: e.name,
          name: meta.name || e.name,
          path: skillDir,
          version: meta.version || '0.0.0',
          description: (meta.description || '').replace(/\n/g, ' ').substring(0, 120),
          triggers: meta.triggers || [],
          triggerPatterns: this._buildTriggerPatterns(meta.triggers || []),
          complexity: meta.complexity || '?',
          metadata: meta.metadata || {},
          fileSize: stats.size,
          lastModified: stats.mtime.toISOString(),
          hasRefs: fs.existsSync(path.join(skillDir, 'references')),
          hasScripts: fs.existsSync(path.join(skillDir, 'scripts')),
          allowedTools: meta['allowed-tools'] || [],
          dependencies: meta.dependencies || [],
          tags: meta.tags || [],
          keywords: this._extractKeywords(meta)
        };

        if (meta.references) {
          for (const ref of (Array.isArray(meta.references) ? meta.references : [meta.references])) {
            const refName = ref.replace(/^(references\/|scripts\/)/, '').replace(/\.\w+$/, '');
            if (this.skills.some(s => s.id === refName || s.name === refName)) {
              if (!skill.dependencies.includes(refName)) skill.dependencies.push(refName);
            }
          }
        }

        this.skills.push(skill);
      } catch (e) {}
    }

    this._buildDependencyGraph();
    // 清除缓存
    this.routingCache.clear();
    return this.skills;
  }

  _parseFrontmatter(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return {};
    const meta = {};
    fmMatch[1].split('\n').forEach(line => {
      const m = line.match(/^(\w[\w-]*):\s*(.+)/);
      if (m) {
        const key = m[1];
        let val = m[2].trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          try { val = JSON.parse(val); } catch (e) { val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
        }
        if (val.startsWith('- ')) {
          val = val.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
        }
        meta[key] = val;
      }
    });
    return meta;
  }

  _extractKeywords(meta) {
    const keywords = new Set();
    
    // 从名称提取
    if (meta.name) {
      meta.name.split(/[\s-_]/).forEach(w => { if (w.length > 2) keywords.add(w.toLowerCase()); });
    }
    
    // 从描述提取
    if (meta.description) {
      meta.description.split(/[\s,，。、]/).forEach(w => { if (w.length > 2) keywords.add(w.toLowerCase()); });
    }
    
    // 从标签提取
    if (meta.tags) {
      (Array.isArray(meta.tags) ? meta.tags : [meta.tags]).forEach(t => keywords.add(t.toLowerCase()));
    }
    
    // 从触发词提取
    if (meta.triggers) {
      (Array.isArray(meta.triggers) ? meta.triggers : [meta.triggers]).forEach(t => {
        t.split(/[\s,，。]/).forEach(w => { if (w.length > 1) keywords.add(w.toLowerCase()); });
      });
    }
    
    return [...keywords];
  }

  _buildTriggerPatterns(triggers) {
    return triggers.map(t => ({
      original: t,
      normalized: t.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ''),
      keywords: t.split(/[\s,，。]/).filter(w => w.length > 1).map(w => w.toLowerCase())
    }));
  }

  _buildDependencyGraph() {
    this.dependencies.clear();
    for (const skill of this.skills) {
      if (skill.dependencies.length > 0) {
        this.dependencies.set(skill.id, skill.dependencies);
      }
    }
  }

  // ==================== 语义路由 ====================

  /**
   * 语义路由 - 根据用户输入推荐最合适的 Skill
   * @param {string} query - 用户输入
   * @param {Object} options - 路由选项
   */
  route(query, options = {}) {
    const { limit = 5, threshold = 0.3, includeFallback = true } = options;
    
    // 检查缓存
    const cacheKey = `${query}:${limit}:${threshold}`;
    if (this.routingCache.has(cacheKey)) {
      return this.routingCache.get(cacheKey);
    }

    if (this.skills.length === 0) this.scan();

    const queryKeywords = this._extractQueryKeywords(query);
    const scores = [];

    for (const skill of this.skills) {
      const score = this._calculateMatchScore(query, queryKeywords, skill);
      if (score >= threshold) {
        scores.push({
          skillId: skill.id,
          name: skill.name,
          score: Math.round(score * 100) / 100,
          matchType: this._getMatchType(score),
          matchedKeywords: this._getMatchedKeywords(queryKeywords, skill),
          confidence: this._getConfidenceLabel(score)
        });
      }
    }

    // 排序并限制结果
    scores.sort((a, b) => b.score - a.score);
    const result = scores.slice(0, limit);

    // 添加兜底选项
    if (includeFallback && result.length === 0) {
      result.push({
        skillId: 'general',
        name: '通用助手',
        score: 0,
        matchType: 'fallback',
        matchedKeywords: [],
        confidence: 'none'
      });
    }

    // 缓存结果
    if (this.routingCache.size > 50) {
      const firstKey = this.routingCache.keys().next().value;
      this.routingCache.delete(firstKey);
    }
    this.routingCache.set(cacheKey, result);

    return result;
  }

  _extractQueryKeywords(query) {
    return query
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }

  _calculateMatchScore(query, queryKeywords, skill) {
    let score = 0;
    let weight = 0;

    // 1. 触发词匹配 (权重 0.4)
    const triggerScore = this._matchTriggers(query, skill);
    score += triggerScore * 0.4;
    weight += 0.4;

    // 2. 关键词匹配 (权重 0.3)
    const keywordScore = this._matchKeywords(queryKeywords, skill);
    score += keywordScore * 0.3;
    weight += 0.3;

    // 3. 描述匹配 (权重 0.2)
    const descScore = this._matchDescription(query, skill);
    score += descScore * 0.2;
    weight += 0.2;

    // 4. 使用频率加成 (权重 0.1)
    const usageBoost = this._getUsageBoost(skill.id);
    score += usageBoost * 0.1;
    weight += 0.1;

    return weight > 0 ? score / weight : 0;
  }

  _matchTriggers(query, skill) {
    const queryNorm = query.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');
    let maxScore = 0;

    for (const pattern of skill.triggerPatterns || []) {
      // 完全匹配
      if (queryNorm.includes(pattern.normalized)) {
        maxScore = Math.max(maxScore, 1);
        break;
      }
      // 关键词匹配
      const matchedKeywords = pattern.keywords.filter(k => queryNorm.includes(k));
      if (matchedKeywords.length > 0) {
        maxScore = Math.max(maxScore, matchedKeywords.length / pattern.keywords.length);
      }
    }

    return maxScore;
  }

  _matchKeywords(queryKeywords, skill) {
    if (queryKeywords.length === 0 || skill.keywords.length === 0) return 0;

    const matched = queryKeywords.filter(qk =>
      skill.keywords.some(sk => sk.includes(qk) || qk.includes(sk))
    );

    return matched.length / Math.max(queryKeywords.length, skill.keywords.length);
  }

  _matchDescription(query, skill) {
    const queryLower = query.toLowerCase();
    const descLower = (skill.description || '').toLowerCase();
    
    if (descLower.includes(queryLower.substring(0, Math.min(10, queryLower.length)))) {
      return 0.8;
    }

    const queryWords = queryLower.split(/\s+/);
    const descWords = descLower.split(/\s+/);
    const intersection = queryWords.filter(w => descWords.includes(w));

    return intersection.length / queryWords.length;
  }

  _getUsageBoost(skillId) {
    const recent = this.usageLog.filter(e => e.skillId === skillId);
    const daysSinceLast = recent.length > 0
      ? (Date.now() - new Date(recent[recent.length - 1].timestamp).getTime()) / 86400000
      : 999;

    // 近期使用加成
    if (daysSinceLast < 1) return 0.8;
    if (daysSinceLast < 7) return 0.5;
    if (daysSinceLast < 30) return 0.2;
    return 0;
  }

  _getMatchType(score) {
    if (score >= 0.8) return 'exact';
    if (score >= 0.6) return 'strong';
    if (score >= 0.4) return 'partial';
    return 'weak';
  }

  _getConfidenceLabel(score) {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    if (score >= 0.3) return 'low';
    return 'none';
  }

  _getMatchedKeywords(queryKeywords, skill) {
    const matched = [];
    for (const qk of queryKeywords) {
      if (skill.keywords.some(sk => sk.includes(qk) || qk.includes(sk))) {
        matched.push(qk);
      }
    }
    return matched;
  }

  /**
   * 批量路由 - 批量处理多个查询
   */
  routeBatch(queries, options = {}) {
    return queries.map(q => ({
      query: q,
      results: this.route(q, options)
    }));
  }

  /**
   * 路由统计
   */
  getRoutingStats() {
    const stats = {
      totalSkills: this.skills.length,
      cacheSize: this.routingCache.size,
      avgTriggers: 0,
      avgKeywords: 0
    };

    if (this.skills.length > 0) {
      stats.avgTriggers = this.skills.reduce((s, sk) => s + sk.triggers.length, 0) / this.skills.length;
      stats.avgKeywords = this.skills.reduce((s, sk) => s + sk.keywords.length, 0) / this.skills.length;
    }

    return stats;
  }

  // ==================== 触发词自动进化 ====================

  /**
   * 记录触发词使用情况并建议进化
   */
  recordTriggerUsage(skillId, trigger, matched) {
    this.triggerHistory.push({
      skillId,
      trigger,
      matched,
      timestamp: this._ts()
    });

    // 清理旧记录
    if (this.triggerHistory.length > 100) {
      this.triggerHistory = this.triggerHistory.slice(-100);
    }

    // 每10次记录检查一次是否需要进化
    const skillTriggers = this.triggerHistory.filter(h => h.skillId === skillId);
    if (skillTriggers.length >= 10) {
      return this.suggestTriggerEvolution(skillId);
    }

    return null;
  }

  /**
   * 建议触发词进化
   */
  suggestTriggerEvolution(skillId) {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill) return null;

    const skillHistory = this.triggerHistory.filter(h => h.skillId === skillId);
    const matched = skillHistory.filter(h => h.matched);
    const missed = skillHistory.filter(h => !h.matched);

    const suggestions = {
      skillId,
      currentTriggers: skill.triggers,
      stats: {
        totalAttempts: skillHistory.length,
        matchRate: matched.length / skillHistory.length
      },
      suggestions: []
    };

    // 分析未匹配的查询
    if (missed.length > 0) {
      const missedQueries = missed.map(h => h.trigger);
      const newKeywords = this._extractCommonPatterns(missedQueries);
      
      if (newKeywords.length > 0) {
        suggestions.suggestions.push({
          type: 'add',
          keywords: newKeywords,
          reason: '用户多次使用但未匹配的查询'
        });
      }
    }

    // 分析低效触发词
    const triggerStats = {};
    for (const h of matched) {
      triggerStats[h.trigger] = (triggerStats[h.trigger] || 0) + 1;
    }

    const lowUsageTriggers = Object.entries(triggerStats)
      .filter(([, count]) => count <= 1)
      .map(([trigger]) => trigger);

    if (lowUsageTriggers.length > 0) {
      suggestions.suggestions.push({
        type: 'remove',
        triggers: lowUsageTriggers,
        reason: '触发词使用率过低'
      });
    }

    this._saveState();
    return suggestions.suggestions.length > 0 ? suggestions : null;
  }

  _extractCommonPatterns(queries) {
    const patterns = {};
    
    for (const q of queries) {
      const words = q.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ' ').split(/\s+/);
      for (const word of words) {
        if (word.length >= 2) {
          patterns[word] = (patterns[word] || 0) + 1;
        }
      }
    }

    // 返回出现2次以上的词
    return Object.entries(patterns)
      .filter(([, count]) => count >= 2)
      .map(([word]) => word);
  }

  /**
   * 应用触发词进化
   */
  applyTriggerEvolution(skillId, changes) {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill) return { success: false, reason: 'Skill不存在' };

    const skillFile = path.join(skill.path, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      return { success: false, reason: 'SKILL.md不存在' };
    }

    try {
      let content = fs.readFileSync(skillFile, 'utf8');

      for (const change of changes) {
        if (change.type === 'add') {
          // 添加新触发词到 frontmatter
          content = this._addTriggerToFrontmatter(content, change.keywords);
        } else if (change.type === 'remove') {
          content = this._removeTriggerFromFrontmatter(content, change.triggers);
        }
      }

      fs.writeFileSync(skillFile, content);
      
      // 重新扫描
      this.scan(true);

      return { success: true };
    } catch (e) {
      return { success: false, reason: e.message };
    }
  }

  _addTriggerToFrontmatter(content, keywords) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;

    const fm = fmMatch[1];
    let triggers = [];

    const triggersLine = fm.match(/^triggers:\s*(.*)/m);
    if (triggersLine) {
      const existing = triggersLine[1].trim();
      if (existing.startsWith('[')) {
        try { triggers = JSON.parse(existing); } catch {}
      } else {
        triggers = existing.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      }
    }

    triggers = [...new Set([...triggers, ...keywords])];

    const newFm = fm.replace(/^triggers:\s*.*/m, `triggers: [${triggers.join(', ')}]`);
    return content.replace(fmMatch[0], `---\n${newFm}\n---`);
  }

  _removeTriggerFromFrontmatter(content, toRemove) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;

    const fm = fmMatch[1];
    let triggers = [];

    const triggersLine = fm.match(/^triggers:\s*(.*)/m);
    if (triggersLine) {
      const existing = triggersLine[1].trim();
      if (existing.startsWith('[')) {
        try { triggers = JSON.parse(existing); } catch {}
      } else {
        triggers = existing.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      }
    }

    triggers = triggers.filter(t => !toRemove.includes(t));

    const newFm = fm.replace(/^triggers:\s*.*/m, `triggers: [${triggers.join(', ')}]`);
    return content.replace(fmMatch[0], `---\n${newFm}\n---`);
  }

  // ==================== 使用分析 ====================

  recordUsage(skillId, context = {}) {
    const entry = {
      skillId, timestamp: this._ts(),
      taskType: context.taskType || 'unknown',
      success: context.success !== false,
      duration: context.duration || 0
    };
    this.usageLog.push(entry);
    if (this.usageLog.length > 500) this.usageLog = this.usageLog.slice(-500);
    this._saveState();
    return entry;
  }

  getUsageHeatmap(days = 30) {
    const cutoff = Date.now() - days * 86400000;
    const recent = this.usageLog.filter(e => new Date(e.timestamp).getTime() > cutoff);

    const heatmap = {};
    for (const skill of this.skills) {
      const uses = recent.filter(e => e.skillId === skill.id);
      heatmap[skill.id] = {
        name: skill.name,
        totalUses: uses.length,
        successRate: uses.length > 0 ? Math.round(uses.filter(u => u.success).length / uses.length * 100) : 0,
        lastUsed: uses.length > 0 ? uses[uses.length - 1].timestamp : 'never',
        status: uses.length === 0 ? 'dead' : (uses.length < 2 ? 'cold' : (uses.length < 5 ? 'warm' : 'hot')),
        avgDuration: uses.length > 0 ? Math.round(uses.reduce((s, u) => s + u.duration, 0) / uses.length) : 0
      };
    }
    return heatmap;
  }

  findDeadSkills(days = 60) {
    const heatmap = this.getUsageHeatmap(days);
    const dead = [];
    for (const [id, info] of Object.entries(heatmap)) {
      if (info.status === 'dead') dead.push({ id, name: info.name, lastUsed: info.lastUsed });
    }
    return dead;
  }

  // ==================== 质量评分 ====================

  scoreSkills() {
    const scores = [];
    for (const skill of this.skills) {
      let score = 50;

      if (skill.triggers.length > 0) score += 15;
      if (skill.triggers.length > 5) score += 5;
      if (skill.description.length > 20) score += 10;
      if (skill.version && skill.version !== '0.0.0') score += 5;
      if (skill.hasRefs) score += 8;
      if (skill.hasScripts) score += 5;
      if (skill.fileSize > 2000 && skill.fileSize < 30000) score += 7;
      else if (skill.fileSize < 500) score -= 10;
      if (skill.complexity && skill.complexity !== '?') score += 5;

      const daysSinceMod = (Date.now() - new Date(skill.lastModified).getTime()) / 86400000;
      if (daysSinceMod < 30) score += 5;
      if (daysSinceMod > 180) score -= 10;

      // 路由能力加成
      if (skill.keywords.length > 10) score += 5;

      score = Math.max(0, Math.min(100, score));

      scores.push({
        id: skill.id, name: skill.name, score,
        grade: score >= 90 ? 'A' : (score >= 75 ? 'B' : (score >= 60 ? 'C' : 'D')),
        issues: this._identifyIssues(skill, score)
      });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores;
  }

  _identifyIssues(skill, score) {
    const issues = [];
    if (skill.triggers.length === 0) issues.push('缺少触发词');
    if (skill.description.length < 20) issues.push('描述过短');
    if (skill.fileSize < 500) issues.push('文件异常小');
    if (skill.version === '0.0.0' || !skill.version) issues.push('无版本号');
    const daysSinceMod = (Date.now() - new Date(skill.lastModified).getTime()) / 86400000;
    if (daysSinceMod > 180) issues.push('超过半年未更新');
    if (skill.keywords.length < 5) issues.push('关键词过少，影响路由');
    return issues;
  }

  // ==================== 依赖分析 ====================

  getDependencyTree(skillId) {
    const visited = new Set();
    const tree = { id: skillId, dependsOn: [] };

    const traverse = (id, node) => {
      if (visited.has(id)) return;
      visited.add(id);
      const deps = this.dependencies.get(id) || [];
      for (const dep of deps) {
        const child = { id: dep, dependsOn: [] };
        node.dependsOn.push(child);
        traverse(dep, child);
      }
    };

    traverse(skillId, tree);
    return tree;
  }

  findCircularDeps() {
    const cycles = [];
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const colors = new Map();

    for (const skill of this.skills) colors.set(skill.id, WHITE);

    const dfs = (id, path) => {
      colors.set(id, GRAY);
      const deps = this.dependencies.get(id) || [];
      for (const dep of deps) {
        const c = colors.get(dep);
        if (c === GRAY) {
          const cycleStart = path.indexOf(dep);
          cycles.push(path.slice(cycleStart).concat(dep));
        } else if (c === WHITE) {
          dfs(dep, [...path, dep]);
        }
      }
      colors.set(id, BLACK);
    };

    for (const skill of this.skills) {
      if (colors.get(skill.id) === WHITE) dfs(skill.id, [skill.id]);
    }
    return cycles;
  }

  // ==================== 报告 ====================

  generateReport() {
    this.scan();
    const scores = this.scoreSkills();
    const dead = this.findDeadSkills();
    const cycles = this.findCircularDeps();
    const heatmap = this.getUsageHeatmap();
    const routingStats = this.getRoutingStats();

    let md = '# Skill 分析报告\n\n';
    md += '**扫描时间**: ' + this._ts() + '\n';
    md += '**总技能数**: ' + this.skills.length + '\n\n';

    md += '## 质量分布\n';
    const grades = { A: 0, B: 0, C: 0, D: 0 };
    scores.forEach(s => grades[s.grade]++);
    md += `A级: ${grades.A} | B级: ${grades.B} | C级: ${grades.C} | D级: ${grades.D}\n\n`;

    md += '## 语义路由统计\n';
    md += `- 平均触发词数: ${routingStats.avgTriggers.toFixed(1)}\n`;
    md += `- 平均关键词数: ${routingStats.avgKeywords.toFixed(1)}\n`;
    md += `- 路由缓存大小: ${routingStats.cacheSize}\n\n`;

    md += '## Top 10 最高质量\n';
    scores.slice(0, 10).forEach(s => {
      md += `- [${s.grade}] **${s.name}** (${s.score}分)\n`;
    });

    md += '\n## 需改进 (C/D级)\n';
    const low = scores.filter(s => s.grade === 'C' || s.grade === 'D');
    low.slice(0, 10).forEach(s => {
      md += `- [${s.grade}] **${s.name}** (${s.score}分)`;
      if (s.issues.length) md += ': ' + s.issues.join(', ');
      md += '\n';
    });

    if (dead.length > 0) {
      md += '\n## 死技能 (>60天未使用)\n';
      dead.forEach(d => md += `- **${d.name}** (最后使用: ${d.lastUsed})\n`);
    }

    if (cycles.length > 0) {
      md += '\n## ⚠️ 循环依赖\n';
      cycles.forEach(c => md += '- ' + c.join(' → ') + '\n');
    }

    md += '\n## 使用热力图 (Top 10)\n';
    const hot = Object.entries(heatmap)
      .filter(([, v]) => v.totalUses > 0)
      .sort(([, a], [, b]) => b.totalUses - a.totalUses)
      .slice(0, 10);
    hot.forEach(([id, info]) => {
      md += `- 🔥 **${info.name}**: ${info.totalUses}次 (成功率${info.successRate}%, ${info.status})\n`;
    });

    return md;
  }

  getTopSkills(limit = 10) {
    return this.scoreSkills().slice(0, limit);
  }
}

if (require.main === module) {
  const sa = new SkillAnalyzer(); 
  const cmd = process.argv[2];

  const cmds = {
    scan() {
      const skills = sa.scan(true);
      console.log('Scanned: ' + skills.length + ' skills');
      skills.slice(0, 10).forEach(s => console.log('  ' + s.id + ' v' + s.version + ' [' + s.triggers.length + ' triggers, ' + s.keywords.length + ' keywords]'));
    },
    route() {
      const query = process.argv.slice(3).join(' ') || '代码审查';
      const results = sa.route(query);
      console.log('Route for "' + query + '":');
      results.forEach((r, i) => console.log('  ' + (i+1) + '. [' + r.score + '] ' + r.name + ' (' + r.confidence + ')'));
    },
    score() {
      sa.scan();
      const scores = sa.scoreSkills();
      console.log('Quality Scores:');
      scores.slice(0, 20).forEach(s => console.log('  [' + s.grade + '] ' + s.name + ' (' + s.score + ')' + (s.issues.length ? ' ⚠' + s.issues.join(',') : '')));
    },
    dead() {
      sa.scan();
      const d = sa.findDeadSkills();
      console.log('Dead skills (' + d.length + '):');
      d.forEach(s => console.log('  ' + s.name));
    },
    stats() {
      console.log(JSON.stringify(sa.getRoutingStats(), null, 2));
    },
    report() { console.log(sa.generateReport()); },
    help() { 
      console.log('SkillAnalyzer CLI (Enhanced)\n命令: scan, route <query>, score, dead, stats, report, help');
    }
  };
  (cmds[cmd] || cmds.help)();
}

module.exports = SkillAnalyzer;
console.log('[SkillAnalyzer] 加载成功 - P4-11 技能分析器(增强版: 语义路由+触发词进化)');
