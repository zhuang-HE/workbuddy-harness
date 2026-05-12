module.exports = [
  { id:'hc-import', name:'导入', type:'unit', fn:({assert,require})=>{const H=require('harness-coordinator');assert.truthy(typeof H==='function');}},
  { id:'hc-dimensions', name:'维度列表', type:'unit', fn:({assert,require})=>{const h=new (require('harness-coordinator'))();const d=h.listDimensions();assert.truthy(Array.isArray(d));assert.truthy(d.length>=9);}},
  { id:'hc-maturity', name:'成熟度计算', type:'unit', fn:({assert,require})=>{const h=new (require('harness-coordinator'))();const m=h.getOverallMaturity();assert.truthy(typeof m==='number');assert.truthy(m>=0&&m<=100);}},
  { id:'hc-health', name:'健康报告生成', type:'integration', fn:({assert,require})=>{const h=new (require('harness-coordinator'))();const r=h.generateHealthReport();assert.truthy(r.includes('维度'));assert.truthy(r.includes('Harness'));}},
  { id:'hc-process', name:'任务处理', type:'integration', fn:({assert,require})=>{const h=new (require('harness-coordinator'))();const r=h.processTask('分析股票走势');assert.truthy(r.goal);assert.truthy(Array.isArray(r.trace?.phases));}},
  { id:'hc-context', name:'上下文传递', type:'integration', fn:({assert,require})=>{const h=new (require('harness-coordinator'))();const r=h.processTask('生成PPT报告');assert.truthy(r.context);assert.truthy(typeof r.ready==='number');}},
];
