import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
test('shared report selector renders AntD options with string values and disabled options', async () => {
 const vite = await createServer({ server: { middlewareMode: true } });
 try {
  const { ReportSelect, ReportDate } = await vite.ssrLoadModule('/app/report-controls.tsx');
  const dateHtml=renderToStaticMarkup(React.createElement(ReportDate,{value:'2026-09-21',min:'2026-09-01'}));
  assert.match(dateHtml,/ant-picker/);
  assert.match(dateHtml,/2026-09-21/);
  const html=renderToStaticMarkup(React.createElement(ReportSelect,{value:'A003','aria-label':'项目'},[
   React.createElement('option',{key:'a',value:'A003'},'A003 · App'),
   React.createElement('option',{key:'b',value:'A004',disabled:true},'Unavailable')
  ]));
  assert.match(html,/ant-select/);
  assert.match(html,/A003 · App/);
  assert.doesNotMatch(html,/<select\b/);
 } finally { await vite.close(); }
});
