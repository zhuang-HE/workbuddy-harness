module.exports = [
  { id:'fr-import', name:'模块导入', type:'unit', fn:({assert,require})=>{const FR=require('fusion-router');assert.truthy(typeof FR==='function');}},
  { id:'fr-instance', name:'实例化', type:'unit', fn:({assert,require})=>{const fr=new (require('fusion-router'))();assert.truthy(fr.ROUTE_TARGET);assert.truthy(fr.rules.length>0);}},
  { id:'fr-route-wb', name:'WB路由', type:'unit', fn:({assert,require})=>{const fr=new (require('fusion-router'))();const r=fr.route({description:'分析贵州茅台股票走势'});assert.truthy(r.winner==='workbuddy');}},
  { id:'fr-route-hm', name:'HERMES路由', type:'unit', fn:({assert,require})=>{const fr=new (require('fusion-router'))();const r=fr.route({description:'打开百度搜索AI新闻'});assert.truthy(r.winner==='hermes');}},
  { id:'fr-batch', name:'批量路由', type:'integration', fn:({assert,require})=>{const fr=new (require('fusion-router'))();const r=fr.batchRoute([{description:'分析股票'},{description:'打开网页'}]);assert.truthy(r.length===2);}},
  { id:'fr-stats', name:'统计', type:'unit', fn:({assert,require})=>{const fr=new (require('fusion-router'))();fr.route({description:'test'});const s=fr.getStats();assert.truthy(s.total>=1);}},
];
