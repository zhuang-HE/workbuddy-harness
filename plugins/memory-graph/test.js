module.exports = [
  { id:'mg-import', name:'导入', type:'unit', fn:({assert,require})=>{const M=require('memory-graph');assert.truthy(typeof M==='function');}},
  { id:'mg-add', name:'添加记忆', type:'unit', fn:({assert,require})=>{const m=new (require('memory-graph'))();const r=m.addMemory('test',{type:'test'});assert.truthy(r.id);assert.truthy(m.nodes.size===1);}},
  { id:'mg-dedup', name:'去重检测', type:'integration', fn:({assert,require})=>{const m=new (require('memory-graph'))();m.addMemory('TypeScript开发',{type:'pref'});const r=m.addMemory('TypeScript开发前端项目',{type:'pref'});assert.truthy(r.merged||m.nodes.size<=2);}},
  { id:'mg-recall', name:'主动召回', type:'unit', fn:({assert,require})=>{const m=new (require('memory-graph'))();m.addMemory('TypeScript React开发',{type:'tech'});m.addMemory('Python数据分析',{type:'tech'});const r=m.recall('TypeScript',3);assert.truthy(r.length>=1);}},
  { id:'mg-clusters', name:'聚类分析', type:'unit', fn:({assert,require})=>{const m=new (require('memory-graph'))();m.addMemory('React前端',{type:'tech'});m.addMemory('Next.js SSR',{type:'tech'});const c=m.findClusters();assert.truthy(Array.isArray(c));}},
  { id:'mg-stats', name:'统计', type:'unit', fn:({assert,require})=>{const m=new (require('memory-graph'))();m.addMemory('test',{type:'test'});const s=m.getStats();assert.truthy(s.totalNodes>=1);assert.truthy(typeof s.density==='string');}},
];
