#!/usr/bin/env node
/**
 * memory-graph - P4-10 记忆关系图谱增强版
 * 维度: D2-Memory | 记忆去重·关系发现·主动召回·图查询引擎
 * 增强: 45% → 85%
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
    this.queryCache = new Map(); // 查询缓存
    this.pathCache = new Map();  // 路径缓存
    this.stats = { queries: 0, hits: 0, lastCleanup: Date.now() };
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

    // 清除查询缓存
    this._clearCache();

    this._save();
    return { id, created: true };
  }

  _extractKeywords(text) {
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

      const sharedTags = node.tags.filter(t => other.tags.includes(t));
      if (sharedTags.length >= 2) {
        this._addEdge(nodeId, otherId, 'tag_overlap', sharedTags.length);
      }

      const sharedKW = node.keywords.filter(k => other.keywords.includes(k));
      if (sharedKW.length >= 3) {
        this._addEdge(nodeId, otherId, 'keyword_overlap', sharedKW.length * 2);
      }

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
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    if (fromNode && !fromNode.links.includes(to)) fromNode.links.push(to);
    if (toNode && !toNode.links.includes(from)) toNode.links.push(from);
  }

  // ==================== 主动召回 ====================

  recall(context, limit = 5, options = {}) {
    this.stats.queries++;
    
    // 查询缓存
    const cacheKey = `${context}:${limit}:${JSON.stringify(options)}`;
    if (this.queryCache.has(cacheKey)) {
      this.stats.hits++;
      return this.queryCache.get(cacheKey);
    }

    const ctxKeywords = this._extractKeywords(context);
    const scored = [];
    const { includeType, minImportance, boostRecent } = options;

    for (const [id, node] of this.nodes) {
      if (includeType && node.type !== includeType) continue;
      if (minImportance && node.importance < minImportance) continue;

      const kwMatch = ctxKeywords.filter(k => node.keywords.includes(k)).length;
      const kwScore = ctxKeywords.length > 0 ? kwMatch / ctxKeywords.length : 0;
      const impScore = node.importance / 5;
      let decay = this._timeDecay(node.lastAccess);
      
      if (boostRecent && decay > 0.8) decay *= 1.2;

      let linkBonus = 0;
      for (const linkId of node.links) {
        const linked = this.nodes.get(linkId);
        if (linked) {
          const linkMatch = ctxKeywords.filter(k => linked.keywords.includes(k)).length;
          if (linkMatch > 0) linkBonus += 0.15;
        }
      }

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
    const result = scored.slice(0, limit);
    
    // 缓存结果
    if (this.queryCache.size > 100) {
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
    }
    this.queryCache.set(cacheKey, result);
    
    return result;
  }

  _timeDecay(lastAccess) {
    if (!lastAccess) return 1;
    const hours = (Date.now() - new Date(lastAccess).getTime()) / 3600000;
    return Math.exp(-hours / 168);
  }

  // ==================== 增强图谱查询引擎 ====================

  /**
   * 高级查询 - 支持多条件组合
   * @param {Object} query - 查询条件
   * @param {Object} query.types - 类型过滤数组
   * @param {Object} query.tags - 标签过滤数组
   * @param {Object} query.minImportance - 最小重要性
   * @param {Object} query.maxAge - 最大年龄（小时）
   * @param {Object} query.hasLinks - 必须有连接
   */
  advancedQuery(query, limit = 20) {
    const { types, tags, minImportance, maxAge, hasLinks, keyword } = query;
    const results = [];

    for (const [id, node] of this.nodes) {
      // 类型过滤
      if (types && types.length > 0 && !types.includes(node.type)) continue;
      
      // 标签过滤
      if (tags && tags.length > 0 && !tags.some(t => node.tags.includes(t))) continue;
      
      // 重要性过滤
      if (minImportance && node.importance < minImportance) continue;
      
      // 年龄过滤
      if (maxAge) {
        const age = (Date.now() - new Date(node.created).getTime()) / 3600000;
        if (age > maxAge) continue;
      }
      
      // 连接过滤
      if (hasLinks && node.links.length === 0) continue;
      
      // 关键词过滤
      if (keyword) {
        const kws = this._extractKeywords(keyword);
        if (!kws.some(k => node.keywords.includes(k) || node.content.includes(k))) continue;
      }

      results.push({
        id,
        content: node.content.substring(0, 100),
        type: node.type,
        importance: node.importance,
        links: node.links.length,
        tags: node.tags.slice(0, 5),
        created: node.created
      });
    }

    return results.sort((a, b) => b.importance - a.importance).slice(0, limit);
  }

  /**
   * 查找两个节点间的最短路径
   */
  findPath(sourceId, targetId, maxDepth = 5) {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return { found: false, message: '节点不存在' };
    }

    const cacheKey = `${sourceId}:${targetId}:${maxDepth}`;
    if (this.pathCache.has(cacheKey)) {
      return this.pathCache.get(cacheKey);
    }

    // BFS 查找最短路径
    const visited = new Set([sourceId]);
    const queue = [{ id: sourceId, path: [sourceId], depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      
      if (current.id === targetId) {
        const result = { found: true, path: current.path, depth: current.depth };
        this.pathCache.set(cacheKey, result);
        return result;
      }

      if (current.depth >= maxDepth) continue;

      const node = this.nodes.get(current.id);
      for (const linkId of node?.links || []) {
        if (!visited.has(linkId)) {
          visited.add(linkId);
          queue.push({
            id: linkId,
            path: [...current.path, linkId],
            depth: current.depth + 1
          });
        }
      }
    }

    const result = { found: false, message: '路径不存在' };
    this.pathCache.set(cacheKey, result);
    return result;
  }

  /**
   * 查找所有可达节点
   */
  getReachable(nodeId, direction = 'both', maxDepth = 3) {
    if (!this.nodes.has(nodeId)) {
      return { nodes: [], count: 0 };
    }

    const visited = new Set([nodeId]);
    const queue = [{ id: nodeId, depth: 0 }];
    const reachable = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth > maxDepth) continue;

      const node = this.nodes.get(current.id);
      const neighbors = direction === 'in' 
        ? this._getIncoming(nodeId)
        : direction === 'out'
        ? node.links
        : [...node.links, ...this._getIncoming(nodeId)];

      for (const linkId of neighbors) {
        if (!visited.has(linkId)) {
          visited.add(linkId);
          const linked = this.nodes.get(linkId);
          if (linked) {
            reachable.push({
              id: linkId,
              content: linked.content.substring(0, 50),
              depth: current.depth + 1
            });
            queue.push({ id: linkId, depth: current.depth + 1 });
          }
        }
      }
    }

    return { nodes: reachable, count: reachable.length };
  }

  _getIncoming(nodeId) {
    const incoming = [];
    for (const [key, edge] of this.edges) {
      if (edge.to === nodeId && !edge.from === nodeId) {
        incoming.push(edge.from);
      }
    }
    return incoming;
  }

  // ==================== 节点关系分析 ====================

  /**
   * 计算节点中心性 - 识别最重要的节点
   * @param {string} method - 'degree' | 'betweenness' | 'eigenvector'
   */
  computeCentrality(method = 'degree') {
    const scores = new Map();

    if (method === 'degree') {
      // 度中心性：连接数越多越重要
      for (const [id, node] of this.nodes) {
        scores.set(id, node.links.length);
      }
    } else if (method === 'betweenness') {
      // 介数中心性：作为桥梁的次数
      for (const [id] of this.nodes) {
        let betweenness = 0;
        for (const [src] of this.nodes) {
          for (const [tgt] of this.nodes) {
            if (src !== id && tgt !== id && src !== tgt) {
              const path = this.findPath(src, tgt, 5);
              if (path.found && path.path.includes(id)) {
                betweenness++;
              }
            }
          }
        }
        scores.set(id, betweenness);
      }
    } else if (method === 'eigenvector') {
      // 特征向量中心性：与重要节点连接的节点更重要
      const iterations = 10;
      const initial = 1 / this.nodes.size;
      
      // 初始化分数
      for (const [id] of this.nodes) {
        scores.set(id, initial);
      }

      // 迭代计算
      for (let i = 0; i < iterations; i++) {
        const newScores = new Map();
        for (const [id, node] of this.nodes) {
          let sum = 0;
          for (const linkId of node.links) {
            sum += scores.get(linkId) || 0;
          }
          newScores.set(id, sum);
        }
        
        // 归一化
        const max = Math.max(...newScores.values()) || 1;
        for (const [id] of this.nodes) {
          scores.set(id, newScores.get(id) / max);
        }
      }
    }

    // 排序并返回结果
    const sorted = [...scores.entries()]
      .map(([id, score]) => ({ id, score: Math.round(score * 100) / 100 }))
      .sort((a, b) => b.score - a.score);

    return {
      method,
      rankings: sorted.slice(0, 20),
      top5: sorted.slice(0, 5).map(item => {
        const node = this.nodes.get(item.id);
        return {
          id: item.id,
          score: item.score,
          content: node?.content.substring(0, 50),
          type: node?.type
        };
      })
    };
  }

  /**
   * 节点影响力分析
   */
  analyzeInfluence(nodeId) {
    if (!this.nodes.has(nodeId)) {
      return { error: '节点不存在' };
    }

    const node = this.nodes.get(nodeId);
    
    // 1. 直接影响力：连接数
    const directInfluence = node.links.length;

    // 2. 间接影响力：可达节点数
    const reachable = this.getReachable(nodeId, 'out', 2);
    const indirectInfluence = reachable.count;

    // 3. 聚类影响：同一簇中的节点数
    const cluster = this.findClusters().find(c => c.members.includes(nodeId));
    const clusterInfluence = cluster?.size || 0;

    // 4. 重要性分数
    const importanceScore = node.importance * (1 + directInfluence * 0.1);

    return {
      nodeId,
      directInfluence,
      indirectInfluence,
      clusterInfluence,
      importanceScore: Math.round(importanceScore * 100) / 100,
      connections: node.links.slice(0, 10),
      metrics: {
        degree: directInfluence,
        reach: indirectInfluence,
        cluster: clusterInfluence,
        importance: node.importance
      }
    };
  }

  /**
   * 关系强度分析
   */
  analyzeRelationships() {
    const relationshipTypes = {};
    const strongRelationships = [];

    for (const [key, edge] of this.edges) {
      // 统计关系类型
      for (const type of edge.types || [edge.type]) {
        relationshipTypes[type] = (relationshipTypes[type] || 0) + 1;
      }

      // 强关系 (weight > 5)
      if (edge.weight > 5) {
        const fromNode = this.nodes.get(edge.from);
        const toNode = this.nodes.get(edge.to);
        strongRelationships.push({
          from: edge.from,
          to: edge.to,
          type: edge.type,
          weight: edge.weight,
          fromContent: fromNode?.content.substring(0, 40),
          toContent: toNode?.content.substring(0, 40)
        });
      }
    }

    return {
      typeDistribution: relationshipTypes,
      totalTypes: Object.keys(relationshipTypes).length,
      strongRelationships: strongRelationships.sort((a, b) => b.weight - a.weight),
      avgWeight: [...this.edges.values()].reduce((s, e) => s + e.weight, 0) / (this.edges.size || 1)
    };
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
      density: this.nodes.size > 1 ? Math.round(this.edges.size / (this.nodes.size * (this.nodes.size - 1) / 2) * 1000) / 10 + '%' : '0%',
      cacheStats: {
        queries: this.stats.queries,
        hits: this.stats.hits,
        hitRate: this.stats.queries > 0 ? Math.round(this.stats.hits / this.stats.queries * 100) + '%' : '0%'
      }
    };
  }

  // ==================== 增强可视化 ====================

  /**
   * 可视化 - 支持多种格式
   * @param {string} format - 'mermaid' | 'd3' | 'graphviz' | 'json'
   */
  visualize(format = 'mermaid', options = {}) {
    const { maxNodes = 50, showLabels = true, colorBy = 'type' } = options;

    if (format === 'mermaid') {
      let m = 'graph LR\n';
      
      // 添加节点定义
      const nodeColors = {
        general: 'fill:#e1f5ff',
        preference: 'fill:#fff3e0',
        technical: 'fill:#e8f5e9',
        config: 'fill:#fce4ec',
        memory: 'fill:#f3e5f5'
      };

      for (const [id, node] of this.nodes) {
        if (this.edges.size === 0 || [...this.edges.values()].some(e => e.from === id || e.to === id)) {
          const color = nodeColors[node.type] || 'fill:#f5f5f5';
          const label = showLabels ? node.content.substring(0, 20) : id.substring(0, 8);
          m += `  ${id}["${label}" style=filled,${color}]\n`;
        }
      }

      // 添加边
      for (const [, edge] of this.edges) {
        const w = Math.min(5, Math.ceil(edge.weight));
        const arrow = edge.type === 'same_type' ? '-.->' : '-->';
        m += `  ${edge.from} ${arrow} "${edge.type}(${w})" ${edge.to}\n`;
      }

      return m || 'graph LR\n  empty["暂无数据"]';
    }

    if (format === 'd3') {
      // D3.js 兼容的 JSON 格式
      const nodes = [...this.nodes.values()].slice(0, maxNodes).map(n => ({
        id: n.id,
        name: n.content.substring(0, 30),
        group: n.type,
        importance: n.importance
      }));

      const links = [...this.edges.values()]
        .filter(e => nodes.some(n => n.id === e.from) && nodes.some(n => n.id === e.to))
        .map(e => ({
          source: e.from,
          target: e.to,
          type: e.type,
          value: e.weight
        }));

      return JSON.stringify({ nodes, links }, null, 2);
    }

    if (format === 'graphviz') {
      let gv = 'digraph MemoryGraph {\n  rankdir=LR;\n  node [shape=box];\n\n';
      
      for (const [id, node] of this.nodes) {
        const label = node.content.substring(0, 30).replace(/"/g, "'");
        gv += `  "${id}" [label="${label}"];\n`;
      }
      
      for (const [, edge] of this.edges) {
        gv += `  "${edge.from}" -> "${edge.to}" [label="${edge.type}"];\n`;
      }
      
      return gv + '}';
    }

    // 默认 JSON
    return JSON.stringify({ 
      nodes: Object.fromEntries(this.nodes), 
      edges: Object.fromEntries(this.edges) 
    }, null, 2);
  }

  /**
   * 生成 HTML 可视化页面
   */
  visualizeHTML(options = {}) {
    const { title = 'Memory Graph', fullscreen = false } = options;
    const d3Data = this.visualize('d3');
    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body { margin: 0; padding: 20px; font-family: Arial, sans-serif; ${fullscreen ? 'height: 100vh; overflow: hidden;' : ''} }
    #graph { width: ${fullscreen ? '100vw' : '100%'}; height: ${fullscreen ? '100vh' : '600px'}; border: 1px solid #ddd; }
    .node rect { cursor: pointer; }
    .node text { font-size: 10px; pointer-events: none; }
    .link { stroke: #999; stroke-opacity: 0.6; }
    .tooltip { position: absolute; background: white; padding: 8px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); font-size: 12px; max-width: 300px; }
    .legend { position: absolute; top: 10px; right: 10px; background: white; padding: 10px; border-radius: 4px; }
    .stats { position: absolute; top: 10px; left: 10px; background: white; padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="stats" id="stats"></div>
  <div class="legend" id="legend"></div>
  <div id="graph"></div>
  <script>
    const data = ${d3Data};
    const stats = ${JSON.stringify(this.getStats())};
    
    // 显示统计
    document.getElementById('stats').innerHTML = \`
      <b>图谱统计</b><br>
      节点: \${stats.totalNodes}<br>
      边: \${stats.totalEdges}<br>
      聚类: \${stats.clusters}
    \`;
    
    // 颜色映射
    const colors = {
      general: '#e1f5ff',
      preference: '#fff3e0',
      technical: '#e8f5e9',
      config: '#fce4ec',
      memory: '#f3e5f5'
    };
    
    // 图例
    const legendHtml = Object.entries(colors).map(([k, v]) => 
      \`<div style="display:flex;align-items:center;margin:2px;">
        <div style="width:16px;height:16px;background:\${v};margin-right:4px;"></div>
        \${k}
      </div>\`
    ).join('');
    document.getElementById('legend').innerHTML = '<b>类型</b><br>' + legendHtml;
    
    // D3 力导向图
    const width = document.getElementById('graph').clientWidth;
    const height = document.getElementById('graph').clientHeight;
    
    const svg = d3.select('#graph')
      .append('svg')
      .attr('width', width)
      .attr('height', height);
    
    const simulation = d3.forceSimulation(data.nodes)
      .force('link', d3.forceLink(data.links).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2));
    
    const link = svg.append('g')
      .selectAll('line')
      .data(data.links)
      .enter().append('line')
      .attr('class', 'link')
      .attr('stroke-width', d => Math.sqrt(d.value));
    
    const node = svg.append('g')
      .selectAll('g')
      .data(data.nodes)
      .enter().append('g')
      .attr('class', 'node')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));
    
    node.append('rect')
      .attr('rx', 4)
      .attr('fill', d => colors[d.group] || '#f5f5f5')
      .attr('width', d => Math.min(d.name.length * 6 + 10, 150))
      .attr('height', 20);
    
    node.append('text')
      .attr('dx', 6)
      .attr('dy', 14)
      .text(d => d.name.substring(0, 20));
    
    node.append('title')
      .text(d => d.name + '\\n类型: ' + d.group);
    
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
      
      node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });
    
    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    
    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    
    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
  </script>
</body>
</html>`;
  }

  // ==================== 缓存管理 ====================

  _clearCache() {
    if (this.queryCache.size > 0) this.queryCache.clear();
    if (this.pathCache.size > 100) this.pathCache.clear();
  }

  clearAllCache() {
    this.queryCache.clear();
    this.pathCache.clear();
    this.stats = { queries: 0, hits: 0, lastCleanup: Date.now() };
    return { success: true };
  }

  // ==================== CLI ====================
}

if (require.main === module) {
  const mg = new MemoryGraph(); 
  const cmd = process.argv[2];

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
    recall() {
      const query = process.argv.slice(3).join(' ') || 'TypeScript React';
      const results = mg.recall(query, 5);
      console.log('Recall for "' + query + '":');
      results.forEach((r, i) => console.log('  ' + (i + 1) + '. [' + r.score + '] ' + r.type + ': ' + r.content.substring(0, 60)));
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
    centrality() {
      const result = mg.computeCentrality('degree');
      console.log('Top 5 Centrality:');
      result.top5.forEach((n, i) => console.log('  ' + (i+1) + '. [' + n.score + '] ' + n.type + ': ' + n.content));
    },
    influence() {
      const [id] = process.argv.slice(3);
      if (!id) { console.log('Usage: influence <memoryId>'); return; }
      const result = mg.analyzeInfluence(id);
      console.log(JSON.stringify(result, null, 2));
    },
    path() {
      const [from, to] = process.argv.slice(3);
      if (!from || !to) { console.log('Usage: path <fromId> <toId>'); return; }
      const result = mg.findPath(from, to);
      console.log(result.found ? 'Path: ' + result.path.join(' → ') : result.message);
    },
    query() {
      const result = mg.advancedQuery({ type: 'technical', minImportance: 4 });
      console.log('Advanced Query Results:');
      result.forEach(r => console.log('  [' + r.type + '] ' + r.content));
    },
    stats() { console.log(JSON.stringify(mg.getStats(), null, 2)); },
    viz() { console.log(mg.visualize('mermaid')); },
    html() { 
      const fs = require('fs');
      const html = mg.visualizeHTML({ title: 'Memory Graph' });
      fs.writeFileSync('/tmp/memory-graph.html', html);
      console.log('HTML saved to /tmp/memory-graph.html');
    },
    help() { 
      console.log('MemoryGraph CLI (Enhanced)\n命令: demo, add, recall, related, clusters, centrality, influence, path, query, stats, viz, html, help');
    }
  };
  (cmds[cmd] || cmds.help)();
}

module.exports = MemoryGraph;
console.log('[MemoryGraph] 加载成功 - P4-10 记忆关系图谱(增强版: 查询引擎+中心性分析+可视化)');
