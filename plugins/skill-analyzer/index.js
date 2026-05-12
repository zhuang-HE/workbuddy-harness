#!/usr/bin/env node
/**
 * skill-analyzer - P4-11 (P2) 技能分析器
 * 维度: D3-Skills | 使用热力图·依赖图谱·质量评分·死技能检测
 * 增强: 从90%→95%
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

class SkillAnalyzer {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'skill-analyzer');
    this.skillsDir = options.skillsDir || path.join(os.homedir(), '.workbuddy', 'skills');
    this.skills = [];        // all skills metadata
    this.dependencies = new Map(); // skill → [depends_on]
    this.usageLog = [];      // usage history
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
      }
    } catch (e) {}
  }
  _saveState() {
    fs.writeFileSync(path.join(this.configDir, 'state.json'), JSON.stringify({
      usageLog: this.usageLog.slice(-500),
      dependencies: Object.fromEntries(this.dependencies),
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
          complexity: meta.complexity || '?',
          metadata: meta.metadata || {},
          fileSize: stats.size,
          lastModified: stats.mtime.toISOString(),
          hasRefs: fs.existsSync(path.join(skillDir, 'references')),
          hasScripts: fs.existsSync(path.join(skillDir, 'scripts')),
          allowedTools: meta['allowed-tools'] || [],
          dependencies: meta.dependencies || [],
          tags: meta.tags || []
        };

        // Parse references for dependencies
        if (meta.references) {
          for (const ref of (Array.isArray(meta.references) ? meta.references : [meta.references])) {
            const refName = ref.replace(/^(references\/|scripts\/)/, '').replace(/\.\w+$/, '');
            if (this.skills.some(s => s.id === refName || s.name === refName)) {
              if (!skill.dependencies.includes(refName)) skill.dependencies.push(refName);
            }
          }
        }

        this.skills.push(skill);
      } catch (e) { /* skip broken skills */ }
    }

    this._buildDependencyGraph();
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
        // Parse arrays in brackets
        if (val.startsWith('[') && val.endsWith(']')) {
          try { val = JSON.parse(val); } catch (e) { val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
        }
        // Parse inline lists
        if (val.startsWith('- ')) {
          val = val.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
        }
        meta[key] = val;
      }
    });
    return meta;
  }

  _buildDependencyGraph() {
    this.dependencies.clear();
    for (const skill of this.skills) {
      if (skill.dependencies.length > 0) {
        this.dependencies.set(skill.id, skill.dependencies);
      }
    }
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
      let score = 50; // base

      // Has triggers: +15
      if (skill.triggers.length > 0) score += 15;
      if (skill.triggers.length > 5) score += 5;

      // Has description: +10
      if (skill.description.length > 20) score += 10;

      // Has version: +5
      if (skill.version && skill.version !== '0.0.0') score += 5;

      // Has references: +8
      if (skill.hasRefs) score += 8;

      // Has scripts: +5
      if (skill.hasScripts) score += 5;

      // File is reasonably sized (2-30KB): +7
      if (skill.fileSize > 2000 && skill.fileSize < 30000) score += 7;
      else if (skill.fileSize < 500) score -= 10; // Too small → likely broken

      // Complexity rating: +5
      if (skill.complexity && skill.complexity !== '?') score += 5;

      // Recently modified (30 days): +5
      const daysSinceMod = (Date.now() - new Date(skill.lastModified).getTime()) / 86400000;
      if (daysSinceMod < 30) score += 5;
      if (daysSinceMod > 180) score -= 10; // Stale

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
    if (skill.fileSize < 500) issues.push('文件异常小(可能损坏)');
    if (skill.version === '0.0.0' || !skill.version) issues.push('无版本号');
    const daysSinceMod = (Date.now() - new Date(skill.lastModified).getTime()) / 86400000;
    if (daysSinceMod > 180) issues.push('超过半年未更新');
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

    let md = '# Skill 分析报告\n\n';
    md += '**扫描时间**: ' + this._ts() + '\n';
    md += '**总技能数**: ' + this.skills.length + '\n\n';

    md += '## 质量分布\n';
    const grades = { A: 0, B: 0, C: 0, D: 0 };
    scores.forEach(s => grades[s.grade]++);
    md += `A级: ${grades.A} | B级: ${grades.B} | C级: ${grades.C} | D级: ${grades.D}\n\n`;

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
  const sa = new SkillAnalyzer(); const cmd = process.argv[2];
  const cmds = {
    scan() {
      const skills = sa.scan(true);
      console.log('Scanned: ' + skills.length + ' skills');
      skills.slice(0, 10).forEach(s => console.log('  ' + s.id + ' v' + s.version + ' [' + s.triggers.length + ' triggers]'));
    },
    score() {
      sa.scan();
      const scores = sa.scoreSkills();
      console.log('Quality Scores:');
      scores.slice(0, 20).forEach(s => console.log('  [' + s.grade + '] ' + s.name + ' (' + s.score + ')' + (s.issues.length ? ' ⚠' + s.issues.join(',') : '')));
      const grades = { A: 0, B: 0, C: 0, D: 0 };
      scores.forEach(s => grades[s.grade]++);
      console.log('\nA:' + grades.A + ' B:' + grades.B + ' C:' + grades.C + ' D:' + grades.D);
    },
    dead() {
      sa.scan();
      const d = sa.findDeadSkills();
      console.log('Dead skills (' + d.length + '):');
      d.forEach(s => console.log('  ' + s.name));
    },
    deps() {
      sa.scan();
      const skillId = process.argv[3];
      if (skillId) {
        console.log(JSON.stringify(sa.getDependencyTree(skillId), null, 2));
      } else {
        console.log('Skills with dependencies:');
        sa.skills.filter(s => s.dependencies.length > 0).forEach(s => console.log('  ' + s.id + ' → ' + s.dependencies.join(', ')));
      }
    },
    cycles() {
      sa.scan();
      const c = sa.findCircularDeps();
      console.log(c.length > 0 ? 'Circular deps: ' + JSON.stringify(c) : 'No circular dependencies');
    },
    report() { console.log(sa.generateReport()); },
    help() { console.log('SkillAnalyzer CLI\n命令: scan, score, dead, deps, cycles, report, help'); }
  };
  (cmds[cmd] || cmds.help)();
}

module.exports = SkillAnalyzer;
console.log('[SkillAnalyzer] 加载成功 - P4-11 技能分析器(质量·依赖·热力图)');
