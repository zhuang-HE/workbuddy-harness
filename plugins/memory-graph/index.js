#!/usr/bin/env node
/**
 * memory-graph - P4-10 (P2) 记忆关系图谱
 * 维度: D2-Memory | 记忆去重·关系发现·主动召回
 * 增强: 从90%→95%
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class MemoryGraph {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'memory-graph');
    this.nodes = new Map();     // id → {content, type, tags, links}
    this.edges = new Map();     // source→target → {type, weight}
    this.embeddings = new Map(); // id → keyword vector (simple TF)
    this._ensureDirs();
    this._load();
  }

  _ensureDirs() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
  }
  _gid() { return crypto.randomBytes(4).toString('hex'); }
  _ts() { return new Date().toISOString(); }

  _load() {
    try {
      const p = path.join(this.configDir, 'graph.json');
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        this.nodes = new Map(Object.entries(d.nodes || {}));
        this.edges = new Map(Object.entries(d.edges || {}));
      }
    } catch (e) {}
  }

  _save() {
    fs.writeFileSync(path.join(this.configDir, 'graph.json'), JSON.stringify({
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      updated: this._ts()
    }, null, 2));
  }

  // ==================== 记忆注册与去重 ====================

  addMemory(content, metadata = {}) {
    const id = 'mem_' + this._gid();
    const keywords = this._extractKeywords(content);
    const hash = this._contentHash(content);

    // 去重检测
    const dup = this._findDuplicate(hash, keywords);
    if (dup) {
      // 合并: 保留更详细的版本，更新权重
      const existing = this.nodes.get(dup.id);
      existing.accessCount = (existing.accessCount || 0) + 1;
      existing.lastAccess = this._ts();
      if (content.length > existing.content.length) existing.content = content;
      existing.mergedFrom = [...(existing.mergedFrom || []), id];
      this._save();
      return { id: dup.id, merged: true, duplicateOf: dup.id, similarity: dup.similarity };
    }

    const node = {
      id, content, type: metadata.type || 'general',
      importance: metadata.importance || 3,
      tags: [...keywords, ...(metadata.tags || [])],
      hash, keywords,
      created: this._ts(), accessCount: 1, lastAccess: this._ts(),
      mergedFrom: [], links: []
    };

    this.nodes.set(id, node);
    this.embeddings.set(id, keywords);

    // 自动发现关系
    this._discoverRelations(id);

    this._save();
    return { id, created: true };
  }

  _extractKeywords(text) {
    // Simple keyword extraction: split by common delimiters, filter short words
    const words = text.replace(/[，,。.；;：:！!？?\s\n\r]+/g, ' ')
      .split(' ')
      .filter(w => w.length >= 2 && w.length <= 10)
      .slice(0, 15);
    return [...new Set(words)];
  }

  _contentHash(content) {
    return crypto.createHash('md5').update(content.trim().toLowerCase()).digest('hex');
  }

  _findDuplicate(hash, keywords) {
    for (const [id, node] of this.nodes) {
      if (node.hash === hash) return { id, similarity: 100 };
      // Keyword overlap > 50% (降低阈值以提高去重召回) → likely duplicate
      const overlap = keywords.filter(k => node.keywords.includes(k)).length;
      const similarity = overlap / Math.max(keywords.length, node.keywords.length);
      if (similarity > 0.5) return { id, similarity: Math.round(similarity * 100) };
    }
    return null;
  }

  // ==================== 关系发现 ====================

  _discoverRelations(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    for (const [otherId, other] of this.nodes) {
      if (otherId === nodeId) continue;

      // Tag overlap → related
      const sharedTags = node.tags.filter(t => other.tags.includes(t));
      if (sharedTags.length >= 2) {
        this._addEdge(nodeId, otherId, 'tag_overlap', sharedTags.length);
      }

      // Keyword overlap
      const sharedKW = node.keywords.filter(k => other.keywords.includes(k));
      if (sharedKW.length >= 3) {
        this._addEdge(nodeId, otherId, 'keyword_overlap', sharedKW.length * 2);
      }

      // Same type
      if (node.type === other.type && node.type !== 'general') {
        this._addEdge(nodeId, otherId, 'same_type', 1);
      }
    }
  }

  _addEdge(from, to, type, weight) {
    const key = [from, to].sort().join('::');
    const existing = this.edges.get(key);
    if (existing) {
      existing.weight = Math.max(existing.weight, weight);
      existing.types = [...new Set([...(existing.types || [existing.type]), type])];
    } else {
      this.edges.set(key, { from, to, type, weight, types: [type] });
    }
    // Update node links
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    if (fromNode && !fromNode.links.includes(to)) fromNode.links.push(to);
    if (toNode && !toNode.links.includes(from)) toNode.links.push(from);
  }

  // ==================== 主动召回 ====================

  recall(context, limit = 5, options = {}) {
    const ctxKeywords = this._extractKeywords(context);
    const scored = [];
    const { includeType, minImportance, boostRecent } = options;

    for (const [id, node] of this.nodes) {
      // 过滤条件
      if (includeType && node.type !== includeType) continue;
      if (minImportance && node.importance < minImportance) continue;

      // Relevance score: keyword match + importance + recency
      const kwMatch = ctxKeywords.filter(k => node.keywords.includes(k)).length;
      const kwScore = ctxKeywords.length > 0 ? kwMatch / ctxKeywords.length : 0;
      const impScore = node.importance / 5;
      let decay = this._timeDecay(node.lastAccess);
      
      // 近期访问加成
      if (boostRecent && decay > 0.8) decay *= 1.2;

      // Also boost if linked nodes match
      let linkBonus = 0;
      for (const linkId of node.links) {
        const linked = this.nodes.get(linkId);
        if (linked) {
          const linkMatch = ctxKeywords.filter(k => linked.keywords.includes(k)).length;
          if (linkMatch > 0) linkBonus += 0.15;
        }
      }

      // Semantic boost: 检查内容是否直接包含上下文
      let semanticBoost = 0;
      if (node.content.toLowerCase().includes(context.toLowerCase().substring(0, 20))) {
        semanticBoost = 0.2;
      }

      const score = kwScore * 0.4 + impScore * 0.2 + decay * 0.2 + linkBonus * 0.15 + semanticBoost;
      if (score > 0.1) {
        scored.push({ 
          id, 
          content: node.content, 
          type: node.type, 
          score: Math.round(score * 100) / 100, 
          keywords: node.keywords.slice(0, 5), 
          relatedCount: node.links.length,
          importance: node.importance
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  _timeDecay(lastAccess) {
    if (!lastAccess) return 1;
    const hours = (Date.now() - new Date(lastAccess).getTime()) / 3600000;
    return Math.exp(-hours / 168); // 7-day half-life for access recency
  }

  // ==================== 图谱查询 ====================

  getRelated(memoryId, depth = 1) {
    const visited = new Set([memoryId]);
    const queue = [{ id: memoryId, depth: 0 }];
    const result = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth > depth) continue;
      const node = this.nodes.get(current.id);
      if (!node) continue;

      for (const linkId of node.links || []) {
        if (!visited.has(linkId)) {
          visited.add(linkId);
          const linked = this.nodes.get(linkId);
          if (linked) {
            result.push({
              id: linkId, content: linked.content.substring(0, 100),
              type: linked.type, depth: current.depth + 1,
              edge: this._findEdge(current.id, linkId)
            });
          }
          queue.push({ id: linkId, depth: current.depth + 1 });
        }
      }
    }
    return result;
  }

  _findEdge(a, b) {
    const key = [a, b].sort().join('::');
    const e = this.edges.get(key);
    return e ? { type: e.type, weight: e.weight } : null;
  }

  findClusters() {
    const visited = new Set();
    const clusters = [];

    for (const [id] of this.nodes) {
      if (visited.has(id)) continue;
      const cluster = [];
      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        const node = this.nodes.get(current);
        if (node) for (const link of node.links || []) {
          if (!visited.has(link)) stack.push(link);
        }
      }
      if (cluster.length > 1) clusters.push({ size: cluster.length, members: cluster, topTags: this._clusterTags(cluster) });
    }

    return clusters.sort((a, b) => b.size - a.size);
  }

  _clusterTags(memberIds) {
    const tagCount = {};
    memberIds.forEach(id => {
      const node = this.nodes.get(id);
      if (node) node.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
    });
    return Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => ({ tag: t, count: c }));
  }

  getStats() {
    const clusters = this.findClusters();
    const types = {};
    for (const [, node] of this.nodes) { types[node.type] = (types[node.type] || 0) + 1; }
    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      clusters: clusters.length,
      largestCluster: clusters[0]?.size || 0,
      avgLinks: this.nodes.size > 0 ? Math.round([...this.nodes.values()].reduce((s, n) => s + (n.links || []).length, 0) / this.nodes.size * 10) / 10 : 0,
      types,
      density: this.nodes.size > 1 ? Math.round(this.edges.size / (this.nodes.size * (this.nodes.size - 1) / 2) * 1000) / 10 + '%' : '0%'
    };
  }

  visualize(format = 'mermaid') {
    if (format === 'mermaid') {
      let m = 'graph LR\n';
      for (const [, edge] of this.edges) {
        const w = Math.min(5, Math.ceil(edge.weight));
        m += `  ${edge.from}["${edge.from.substring(0,8)}"] -- "${edge.type}" --> ${edge.to}["${edge.to.substring(0,8)}"]\n`;
      }
      for (const [id, node] of this.nodes) {
        if (![...this.edges.values()].some(e => e.from === id || e.to === id)) {
          m += `  ${id}["${id.substring(0,8)}"]\n`;
        }
      }
      return m || 'graph LR\n  empty["暂无数据"]';
    }
    return JSON.stringify({ nodes: Object.fromEntries(this.nodes), edges: Object.fromEntries(this.edges) }, null, 2);
  }

  // ==================== CLI ====================
}

if (require.main === module) {
  const mg = new MemoryGraph(); const cmd = process.argv[2];

  const demoData = () => {
    mg.addMemory('用户偏好使用TypeScript开发前端项目', { type: 'preference', importance: 5 });
    mg.addMemory('项目使用React 18 + Next.js作为前端框架', { type: 'technical', importance: 4 });
    mg.addMemory('后端使用Express.js + MongoDB', { type: 'technical', importance: 4 });
    mg.addMemory('用户喜欢简洁的代码风格，不要过度抽象', { type: 'preference', importance: 5 });
    mg.addMemory('数据库连接字符串在.env文件中', { type: 'config', importance: 3 });
    mg.addMemory('MongoDB使用Atlas云服务，需要配置IP白名单', { type: 'config', importance: 3 });
    mg.addMemory('TypeScript配置使用strict模式', { type: 'technical', importance: 4 });
    console.log('Demo data loaded: ' + mg.nodes.size + ' memories');
  };

  const cmds = {
    demo() { demoData(); },
    add() {
      const content = process.argv.slice(3).join(' ');
      if (!content) { console.log('Usage: add <content>'); return; }
      const r = mg.addMemory(content, { type: process.argv[3] === '--type' ? process.argv[4] : 'general' });
      console.log(r.created ? 'Created: ' + r.id : 'Merged: ' + r.id + ' (sim=' + r.similarity + '%)');
    },
    dedup() {
      const content = process.argv.slice(3).join(' ') || 'TypeScript开发';
      const r = mg.addMemory(content);
      console.log(r.created ? 'New' : 'Dedup: ' + r.similarity + '% match with ' + r.id);
    },
    recall() {
      const query = process.argv.slice(3).join(' ') || 'TypeScript React';
      const results = mg.recall(query, 5);
      console.log('Recall for "' + query + '":');
      results.forEach((r, i) => console.log('  ' + (i + 1) + '. [' + r.score + '] ' + r.type + ': ' + r.content.substring(0, 60) + ' (links:' + r.relatedCount + ')'));
    },
    related() {
      const id = process.argv[3];
      if (!id) { console.log('Usage: related <memoryId>'); return; }
      const r = mg.getRelated(id, 2);
      console.log('Related to ' + id + ':');
      r.forEach(item => console.log('  depth=' + item.depth + ' [' + item.type + '] ' + item.content));
    },
    clusters() {
      const c = mg.findClusters();
      console.log('Memory Clusters (' + c.length + '):');
      c.forEach((cl, i) => {
        console.log('  Cluster ' + (i + 1) + ': ' + cl.size + ' memories');
        console.log('    Tags: ' + cl.topTags.map(t => t.tag + '(' + t.count + ')').join(', '));
      });
    },
    stats() { console.log(JSON.stringify(mg.getStats(), null, 2)); },
    viz() { console.log(mg.visualize('mermaid')); },
    help() { console.log('MemoryGraph CLI\n命令: demo, add, dedup, recall, related, clusters, stats, viz, help'); }
  };
  (cmds[cmd] || cmds.help)();
}

module.exports = MemoryGraph;
console.log('[MemoryGraph] 加载成功 - P4-10 记忆关系图谱(去重+召回+聚类)');
