/* Local ledger UI. Raw values never enter chat, browser storage, or a model request. */
const _budget = {
  catalog: null, report: null, entity: '', currency: '', year: new Date().getFullYear(), displayedScope: '',
  tab: 'overview', offset: 0, rows: [], busy: false, epoch: 0, reopen: false,
  source: null, preview: null, page: [], pageOffset: 0, decisions: new Map(),
  drafts: new Map(), ids: new Map(), expanded: new Map(), editing: null, splits: 1, warning: '',
};
const _budgetEl = id => document.getElementById(`budget-${id}`);
const _budgetActive = () => _budgetEl('view')?.classList.contains('active');
const _budgetAccounts = () => (_budget.catalog?.accounts || []).filter(a => a.entity_id === _budget.entity && a.currency === _budget.currency);
const _budgetCategories = () => (_budget.catalog?.categories || []).filter(c => c.entity_id === _budget.entity);
const _budgetPeriod = () => ({ entityId: _budget.entity, currency: _budget.currency, year: _budget.year });
const _budgetScope = () => `${_budget.entity}:${_budget.currency}:${_budget.year}`;
const _budgetPrecision = () => _budgetAccounts()[0]?.minor_digits ?? 2;
const _budgetToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

function _budgetDecimal(value, precision = _budgetPrecision()) {
  const amount = BigInt(value), negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(precision+1,'0');
  return `${negative ? '-' : ''}${precision ? `${digits.slice(0,-precision)}.${digits.slice(-precision)}` : digits}`;
}
function _budgetMoney(value) { return value == null ? 'Not entered' : `${_budget.currency} ${_budgetDecimal(value)}`; }
function _budgetMinor(value, precision = _budgetPrecision()) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[3]?.length || 0) > precision) throw new Error(`Use a plain amount with at most ${precision} decimal places, no commas or currency symbol.`);
  const minor = BigInt(match[2]) * 10n ** BigInt(precision) + BigInt((match[3] || '').padEnd(precision,'0') || '0');
  if (minor > 9000000000000n) throw new Error('Amount exceeds the supported limit.');
  return Number(match[1] ? -minor : minor);
}
function _budgetNode(tag, text, className) {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text);
  if (className) node.className = className; return node;
}
function _budgetButton(text, action, primary = false) {
  const button = _budgetNode('button',text,primary ? 'budget-primary' : 'budget-button'); button.type = 'button';
  button.addEventListener('click',() => { Promise.resolve().then(action).catch(_budgetError); }); return button;
}
function _budgetError(error) {
  _budgetEl('error').hidden = false;
  _budgetEl('error').textContent = error instanceof Error ? error.message : 'Finance unavailable. Retry without changing your inputs.';
}
async function _budgetApi(method, value) {
  const response = await window.pocketAgent.finance[method](value);
  if (!response?.success) throw new Error(response?.error || 'Finance unavailable. Retry without changing your inputs.');
  if (response.data?.backupWarning) _budget.warning = response.data.backupWarning;
  return response.data;
}
const _budgetRequest = command => _budgetApi('request',command);
function _budgetRemember() {
  for (const form of _budgetEl('body').querySelectorAll('form')) {
    const key = `${_budgetScope()}:${form.id}`;
    if (!_budget.drafts.has(key) && _budget.drafts.size >= 128) throw new Error('Too many retained forms. Save existing drafts before opening another scope.');
    _budget.drafts.set(key,Array.from(form.elements).filter(e => e.name).map(e => [e.name,e.type === 'checkbox' ? e.checked : e.value]));
  }
}
function _budgetRestore() {
  for (const form of _budgetEl('body').querySelectorAll('form')) {
    for (const [name,value] of _budget.drafts.get(`${_budgetScope()}:${form.id}`) || []) {
      const element = form.elements.namedItem(name); if (!element) continue;
      if (element.type === 'checkbox') element.checked = value; else element.value = value;
    }
  }
}
function _budgetId(form) {
  const key = `${_budgetScope()}:${form.id}`;
  if (!_budget.ids.has(key)) _budget.ids.set(key,crypto.randomUUID());
  return _budget.ids.get(key);
}
async function _budgetRun(action, status = 'Working locally…') {
  if (_budget.busy) return;
  try { _budgetRemember(); } catch (error) { _budgetError(error); return; }
  _budget.busy = true; const epoch = _budget.epoch;
  _budgetEl('notice').textContent = '';
  const focus = document.activeElement;
  const controls = [..._budgetEl('view').querySelectorAll('button,input,select,textarea')].filter(e => !e.hasAttribute('data-budget-cancel'));
  const disabled = controls.map(e => e.disabled); controls.forEach(e => { e.disabled = true; });
  _budgetEl('view').setAttribute('aria-busy','true'); _budgetEl('error').hidden = true; _budgetEl('status').textContent = status;
  try { await action(epoch); }
  catch (error) { if (_budgetActive() && epoch === _budget.epoch) _budgetError(error); }
  finally {
    _budget.busy = false; _budgetEl('view').setAttribute('aria-busy','false');
    controls.forEach((e,i) => { if (e.isConnected) e.disabled = disabled[i]; });
    _budgetEl('export').disabled = !_budget.report; _budgetEl('analyze').disabled = !_budget.report;
    _budgetEl('warning').textContent = _budget.warning; _budgetEl('warning').hidden = !_budget.warning;
    if (epoch === _budget.epoch) {
      _budgetEl('status').textContent = 'Local ledger. Coverage remains unverified.';
      if (_budgetActive() && document.activeElement === document.body) {
        const restored = focus?.isConnected ? focus : focus?.id ? document.getElementById(focus.id) : null;
        (restored || _budgetEl('title')).focus();
      }
    }
    if (_budget.reopen && _budgetActive()) { _budget.reopen = false; void _budgetRun(_budgetLoad); }
  }
}
async function _budgetLoad(epoch) {
  const clearChangedScope = () => {
    if (_budget.displayedScope === _budgetScope()) return;
    _budget.report = null; _budget.rows = [];
    _budgetEl('body').replaceChildren(_budgetNode('p','Selected ledger has not loaded yet. Retry Refresh if loading fails.'));
  };
  clearChangedScope();
  const catalog = await _budgetRequest({action:'catalog'});
  if (epoch !== _budget.epoch || !_budgetActive()) return;
  _budget.catalog = catalog; _budget.warning = catalog.backupWarning || _budget.warning;
  if (!catalog.entities.some(e => e.id === _budget.entity)) _budget.entity = catalog.entities[0]?.id || '';
  const currencies = [...new Set(catalog.accounts.filter(a => a.entity_id === _budget.entity).map(a => a.currency))].sort();
  if (!currencies.includes(_budget.currency)) _budget.currency = currencies[0] || '';
  clearChangedScope();
  _budget.report = _budget.currency ? await _budgetRequest({action:'report',..._budgetPeriod()}) : null;
  if (epoch !== _budget.epoch || !_budgetActive()) return;
  if (_budget.tab === 'transactions' && _budget.report) {
    _budget.rows = await _budgetRequest({action:'transactions',..._budgetPeriod(),offset:_budget.offset});
    if (epoch !== _budget.epoch || !_budgetActive()) return;
  }
  _budgetOptions(_budgetEl('entity'),catalog.entities.map(e => [e.id,e.name]),_budget.entity);
  _budgetOptions(_budgetEl('currency'),currencies.map(c => [c,c]),_budget.currency);
  _budgetEl('year').value = _budget.year;
  _budgetRender(); _budget.displayedScope = _budgetScope();
}
function _budgetOptions(select, options, value) {
  select.replaceChildren();
  for (const [id,label] of options) { const option = _budgetNode('option',label); option.value = id; select.append(option); }
  select.value = value;
}
function _budgetSection(title, open = false) {
  const section = _budgetNode('details'); section.open = _budget.expanded.get(title) ?? open; section.append(_budgetNode('summary',title));
  section.addEventListener('toggle',() => { if (section.isConnected) _budget.expanded.set(title,section.open); });
  _budgetEl('body').append(section); return section;
}
function _budgetField(form, name, label, options = {}) {
  const wrap = _budgetNode('div',null,'budget-field');
  const input = _budgetNode(options.options ? 'select' : 'input'); input.name = name; input.id = `${form.id}-${name}`;
  if (options.options) _budgetOptions(input,options.options,options.value ?? options.options[0]?.[0] ?? '');
  else { input.type = options.type || 'text'; input.value = options.value ?? ''; input.maxLength = options.maxLength || 160; input.autocomplete = 'off'; }
  input.required = !options.optional; if (options.min != null) input.min = options.min; if (options.max != null) input.max = options.max;
  if (options.readOnly) input.readOnly = true;
  if (options.money) { input.inputMode = 'decimal'; input.placeholder = '0.00'; input.maxLength = 24; }
  const labelNode = _budgetNode('label',label); labelNode.htmlFor = input.id; wrap.append(labelNode,input);
  if (options.help) { const help = _budgetNode('small',options.help); help.id = `${input.id}-help`; input.setAttribute('aria-describedby',help.id); wrap.append(help); }
  form.append(wrap); return input;
}
function _budgetForm(section, id, label, save) {
  const form = _budgetNode('form',null,'budget-form'); form.id = `budget-form-${id}`; section.append(form);
  form.addEventListener('submit',event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    void _budgetRun(async epoch => {
      await save(form,epoch);
    },'Review the exact local change before confirming.');
  });
  const button = _budgetNode('button',label,'budget-primary'); button.type = 'submit';
  const footer = _budgetNode('div',null,'budget-form-actions'); footer.append(button); section.append(footer); button.setAttribute('form',form.id);
  return form;
}
function _budgetValue(form,name) { return form.elements.namedItem(name).value; }
async function _budgetSave(form, command, epoch) {
  const result = await _budgetRequest(command);
  const key = `${_budgetScope()}:${form.id}`; _budget.drafts.delete(key); _budget.ids.delete(key);
  if (epoch === _budget.epoch) await _budgetLoad(epoch);
  return result;
}
function _budgetTable(parent, caption, headers, rows) {
  const wrap = _budgetNode('div',null,'budget-table-scroll'); wrap.tabIndex = 0; wrap.setAttribute('role','region'); wrap.setAttribute('aria-label',caption);
  const table = _budgetNode('table'); table.append(_budgetNode('caption',caption));
  const head = _budgetNode('thead'), tr = _budgetNode('tr');
  headers.forEach(label => { const th = _budgetNode('th',label); th.scope = 'col'; tr.append(th); }); head.append(tr); table.append(head);
  const body = _budgetNode('tbody');
  for (const values of rows) { const row = _budgetNode('tr'); for (const value of values) { const cell = _budgetNode('td'); if (value instanceof Node) cell.append(value); else cell.textContent = String(value ?? 'Not entered'); row.append(cell); } body.append(row); }
  table.append(body); wrap.append(table); parent.append(wrap);
  if (!rows.length) parent.append(_budgetNode('p','No records in this scope.'));
}
function _budgetPagedTable(parent, caption, headers, rows) {
  let offset = 0; const container = _budgetNode('div'); parent.append(container);
  const draw = () => {
    container.replaceChildren(); _budgetTable(container,`${caption} (${rows.length} rows)`,headers,rows.slice(offset,offset+100));
    if (rows.length > 100) {
      const actions = _budgetNode('div',null,'budget-actions');
      const previous = _budgetButton('Previous rows',() => { offset -= 100; draw(); container.querySelector('[role="region"]').focus(); }); previous.disabled = offset === 0;
      const next = _budgetButton('Next rows',() => { offset += 100; draw(); container.querySelector('[role="region"]').focus(); }); next.disabled = offset+100 >= rows.length;
      actions.append(previous,_budgetNode('span',`${offset+1}–${Math.min(offset+100,rows.length)} of ${rows.length}`),next); container.append(actions);
    }
  }; draw();
}
function _budgetRender() {
  const body = _budgetEl('body'); body.replaceChildren();
  for (const button of _budgetEl('nav').querySelectorAll('button')) button.setAttribute('aria-pressed',String(button.dataset.budgetTab === _budget.tab));
  _budgetEl('export').disabled = !_budget.report; _budgetEl('analyze').disabled = !_budget.report;
  if (!_budget.catalog?.entities.length) {
    body.append(_budgetNode('h2','Start a local personal ledger'),_budgetNode('p','No bank login is needed. Add an account alias, then review a CSV or enter a transaction.'));
    _budgetSetup(true); _budgetRestore(); return;
  }
  const titles = {overview:'Overview',transactions:'Transactions',import:'Import',plan:'Plan & setup'};
  body.append(_budgetNode('h2',titles[_budget.tab]));
  if (_budget.tab === 'plan') _budgetSetup(false);
  else if (!_budgetAccounts().length) { body.append(_budgetNode('p','Add an account alias and currency in Plan & setup first.')); }
  else if (_budget.tab === 'overview') _budgetOverview();
  else if (_budget.tab === 'transactions') _budgetTransactions();
  else _budgetImport();
  _budgetRestore();
}
function _budgetOverview() {
  const r = _budget.report, body = _budgetEl('body');
  body.append(_budgetNode('p',`${r.transactionCount} included transactions; ${r.excludedTransactionCount} excluded. ${r.coverage}`,'budget-notice'));
  _budgetTable(body,'Entered actuals, not verified account coverage',['Measure','Amount'],[
    ['Income',_budgetMoney(r.incomeMinor)],['Expenses (refunds deducted)',_budgetMoney(r.expenseMinor)],
    ['Transfer/card-payment net (not spending)',_budgetMoney(r.transferNetMinor)],['Uncategorized net',_budgetMoney(r.uncategorizedNetMinor)],
  ]);
  body.append(_budgetNode('p',`${r.uncategorizedCount} uncategorized transactions; ${r.missingReceiptReferenceCount} expenses without receipt references; ${r.unavailableReceiptCount} unavailable referenced files.`));
  _budgetPagedTable(_budgetSection('Category by month',true),'Category/month actuals',['Month','Category','Type','Amount'],r.categoryMonths.map(row => [row.month,row.category,row.kind,_budgetMoney(row.amountMinor)]));
  _budgetPagedTable(_budgetSection('Actual versus budget'),'Independent budgets (never add overlapping periods)',['Start','Months','Category','Budget','Actual','Favorable variance'],r.budgetComparison.map(row => [row.period_start,row.months,row.name,_budgetMoney(row.amount_minor),_budgetMoney(row.actualMinor),_budgetMoney(row.favorableVarianceMinor)]));
  _budgetPagedTable(_budgetSection('Reconciliation'),'Calculated minus entered statements; completeness unverified',['Account','Statement date','Statement','Calculated','Difference'],r.reconciliations.map(row => [row.alias,row.statementDate,_budgetMoney(row.statementBalanceMinor),_budgetMoney(row.calculatedMinor),_budgetMoney(row.differenceMinor)]));
  const recurring = _budgetSection('Recurring charge candidates'); recurring.append(_budgetNode('p',r.recurrenceCoverageLimited ? 'Coverage limited by the bounded scan. Candidates only, not confirmed subscriptions.' : 'Candidates only, not confirmed subscriptions. Up to 100 are shown.'));
  _budgetTable(recurring,'Equal-cost patterns',['Description','Cost','Evidence'],r.recurring.map(row => [row.description,_budgetMoney(row.amountMinor),row.reason]));
  const exceptions = _budgetSection('Review exceptions'); exceptions.append(_budgetNode('p',r.exceptionsLimited ? 'First 100 exceptions only; totals above include all observed exceptions.' : 'Observed exceptions only; unimported records are unknown.'));
  _budgetTable(exceptions,'Review exceptions',['Date','Reason'],r.exceptions.map(row => [row.date,row.reason]));
  const receipts = _budgetSection('Receipt index'); receipts.append(_budgetNode('p',`References are not backups.${r.receiptsLimited ? ' First 5,000 references only.' : ''}`));
  _budgetPagedTable(receipts,'Local receipt references',['Name','Path','Status'],r.receiptIndex.map(row => [row.name,row.path_ref,row.status]));
  _budgetSection('Methodology').append(_budgetNode('p',r.methodology));
}
function _budgetTransactions() {
  const body = _budgetEl('body');
  body.append(_budgetNode('p','Original amounts and dates cannot be rewritten. Void and replace corrections; edit balanced allocations separately. Negative means outflow; positive means inflow.'));
  const rows = _budget.rows.map(row => {
    const actions = _budgetNode('div',null,'budget-actions');
    actions.append(_budgetButton('Edit allocations',() => { _budgetRemember(); _budget.editing = row; _budget.splits = Math.max(1,row.allocations.length); _budgetRender(); document.getElementById(`budget-form-entry-${row.id}-split-category-0`)?.focus(); }));
    const voided = Boolean(row.voided_at);
    actions.append(_budgetButton(voided ? 'Restore transaction' : 'Void transaction',() => _budgetRun(async epoch => { await _budgetRequest({action:'void',entityId:_budget.entity,type:'transaction',id:row.id,voided:!voided}); await _budgetLoad(epoch); })));
    actions.append(_budgetButton('Reference receipt',() => _budgetRun(async epoch => { await _budgetApi('selectReceipt',{entityId:_budget.entity,transactionId:row.id,id:crypto.randomUUID()}); await _budgetLoad(epoch); })));
    const notes = [row.source_name ? `${row.source_name}, row ${row.source_row}` : 'Manual entry',row.batch_voided_at ? 'Batch voided' : '',voided ? 'Transaction voided' : '',...row.suggestions.map(s => `${s.category}: ${s.reason}`)].filter(Boolean).join('\n');
    return [row.transaction_date,row.alias,row.description,_budgetMoney(row.amount_minor),row.allocations.map(a => `${a.category}: ${_budgetMoney(a.amountMinor)}`).join('\n'),notes,actions];
  });
  _budgetTable(body,`Transactions ${_budget.offset+1} onward (up to 100 per page)`,['Date','Account','Description','Signed amount','Allocations','Evidence/status','Actions'],rows);
  const pager = _budgetNode('div',null,'budget-actions');
  const previous = _budgetButton('Previous transactions',() => _budgetRun(async epoch => { _budget.offset -= 100; await _budgetLoad(epoch); })); previous.disabled = _budget.offset === 0;
  const next = _budgetButton('Next transactions',() => _budgetRun(async epoch => { _budget.offset += 100; await _budgetLoad(epoch); })); next.disabled = rows.length < 100;
  pager.append(previous,next); body.append(pager);
  _budgetEntryForm();
}
function _budgetEntryForm() {
  const edit = _budget.editing, section = _budgetSection(edit ? 'Review allocation correction' : 'Manual transaction',Boolean(edit));
  const saved = _budget.drafts.get(`${_budgetScope()}:budget-form-entry-${edit?.id || 'new'}`);
  _budget.splits = Number(saved?.find(([name]) => name === 'split-count')?.[1] || edit?.allocations.length || 1);
  let form;
  form = _budgetForm(section,`entry-${edit?.id || 'new'}`,'Review and save locally',async (f,epoch) => {
    const allocations = Array.from({length:_budget.splits},(_,i) => ({categoryId:_budgetValue(f,`split-category-${i}`),amountMinor:_budgetMinor(_budgetValue(f,`split-amount-${i}`))}));
    const command = edit ? {action:'allocate',entityId:_budget.entity,id:edit.id,revision:edit.revision,allocations} : {
      action:'manualEntry',entityId:_budget.entity,accountId:_budgetValue(f,'account'),id:_budgetId(f),date:_budgetValue(f,'date'),amount:_budgetMinor(_budgetValue(f,'amount')),description:_budgetValue(f,'description'),allocations,
    };
    await _budgetRequest(command); const key = `${_budgetScope()}:${f.id}`; _budget.drafts.delete(key); _budget.ids.delete(key);
    _budget.editing = null; _budget.splits = 1; await _budgetLoad(epoch);
  });
  const splitCount = _budgetNode('input'); splitCount.type = 'hidden'; splitCount.name = 'split-count'; splitCount.value = _budget.splits; form.append(splitCount);
  if (!edit) _budgetField(form,'account','Account alias',{options:_budgetAccounts().map(a => [a.id,a.alias])});
  _budgetField(form,'date','Transaction date',{type:'date',value:edit?.transaction_date || _budgetToday(),readOnly:Boolean(edit),min:'1900-01-01',max:'2200-12-31'});
  _budgetField(form,'description','Description',{value:edit?.description,maxLength:2000,readOnly:Boolean(edit)});
  _budgetField(form,'amount',`Signed amount (${_budget.currency})`,{money:true,value:edit ? _budgetDecimal(edit.amount_minor) : '',readOnly:Boolean(edit),help:'Use a minus for purchases or card payments; a plus/unsigned amount for deposits or refunds. Enter without a plus sign.'});
  const categories = _budgetCategories();
  for (let i=0;i<_budget.splits;i++) {
    const allocation = edit?.allocations[i];
    _budgetField(form,`split-category-${i}`,`Allocation ${i+1} category`,{options:categories.map(c => [c.id,`${c.name} (${c.kind})`]),value:allocation?.categoryId || categories.find(c => c.kind === 'uncategorized')?.id});
    _budgetField(form,`split-amount-${i}`,`Allocation ${i+1} signed amount`,{money:true,value:allocation ? _budgetDecimal(allocation.amountMinor) : '',help:'All allocations must sum exactly to the original signed amount.'});
  }
  const add = _budgetButton('Add split',() => { splitCount.value = _budget.splits+1; _budgetRemember(); _budgetRender(); document.getElementById(`${form.id}-split-category-${_budget.splits-1}`)?.focus(); }); add.disabled = _budget.splits >= 100;
  const remove = _budgetButton('Remove last split',() => { splitCount.value = _budget.splits-1; _budgetRemember(); _budgetRender(); }); remove.disabled = _budget.splits <= 1;
  section.append(add,remove);
  if (edit) section.append(_budgetButton('Discard allocation edit',() => { _budget.drafts.delete(`${_budgetScope()}:${form.id}`); _budget.editing = null; _budget.splits = 1; _budgetRender(); }));
}
function _budgetImport() {
  const body = _budgetEl('body');
  const stages = _budgetNode('ol',null,'budget-stages');
  for (const [i,label] of ['Select & map','Review rows','Confirm local import'].entries()) { const li = _budgetNode('li',label); if (i === (_budget.preview ? 1 : 0)) li.setAttribute('aria-current','step'); stages.append(li); } body.append(stages);
  body.append(_budgetNode('p','UTF-8 CSV, up to 8 MiB / 50,000 rows. Nothing is imported until row review and native confirmation. Preview expires after 10 minutes. Extend it before expiry for more review time, or cancel/reselect.'));
  if (!_budget.preview) {
    const section = _budgetSection('Select and map a CSV',true);
    const form = _budgetForm(section,'import-map','Preview rows',async (f,epoch) => {
      if (!_budget.source) throw new Error('Select a CSV first.');
      const mode = _budgetValue(f,'amountMode'); const mapping = {delimiter:_budget.source.delimiter,dateColumn:Number(_budgetValue(f,'dateColumn')),descriptionColumn:Number(_budgetValue(f,'descriptionColumn')),amountMode:mode,dateOrder:_budgetValue(f,'dateOrder'),decimal:_budgetValue(f,'decimal')};
      if (mode === 'debit-credit') { mapping.debitColumn = Number(_budgetValue(f,'debitColumn')); mapping.creditColumn = Number(_budgetValue(f,'creditColumn')); } else mapping.amountColumn = Number(_budgetValue(f,'amountColumn'));
      const currencyColumn = _budgetValue(f,'currencyColumn'); if (currencyColumn !== '') mapping.currencyColumn = Number(currencyColumn);
      const preview = await _budgetRequest({action:'previewImport',entityId:_budget.entity,accountId:_budgetValue(f,'account'),mapping});
      if (epoch !== _budget.epoch) return;
      _budget.preview = preview; _budget.pageOffset = 0; _budget.decisions.clear(); await _budgetPreviewPage(epoch);
    });
    _budgetField(form,'account',`Account (${_budget.currency})`,{options:_budgetAccounts().map(a => [a.id,a.alias])});
    const delimiter = _budgetField(form,'delimiter','CSV delimiter',{options:[[',','Comma'],[';','Semicolon'],['\t','Tab']],value:_budget.source?.delimiter || ','}); delimiter.disabled = Boolean(_budget.source);
    section.append(_budgetButton(_budget.source ? 'Replace CSV' : 'Choose CSV',() => _budgetRun(async epoch => {
      const selected = await _budgetApi('selectCsv',delimiter.value); if (!selected || epoch !== _budget.epoch) return;
      _budget.source = {...selected,delimiter:delimiter.value}; _budget.drafts.delete(`${_budgetScope()}:${form.id}`); _budgetRender();
    })));
    const columns = (_budget.source?.headers || []).map((label,i) => [String(i),`${i+1}: ${label}`]);
    _budgetField(form,'dateColumn','Date column',{options:columns,value:'0'});
    _budgetField(form,'descriptionColumn','Description column',{options:columns,value:'1'});
    _budgetField(form,'amountMode','Amount convention',{options:[['signed','Signed: negative outflow'],['expense-positive','Positive purchases, negative refunds'],['debit-credit','Separate debit and credit columns']]});
    _budgetField(form,'amountColumn','Amount column (single-column modes)',{options:columns,value:'2',optional:true});
    _budgetField(form,'debitColumn','Debit column (separate-column mode)',{options:columns,value:'2',optional:true});
    _budgetField(form,'creditColumn','Credit column (separate-column mode)',{options:columns,value:'3',optional:true});
    _budgetField(form,'dateOrder','Date convention',{options:[['ymd','Year / month / day'],['mdy','Month / day / year'],['dmy','Day / month / year']]});
    _budgetField(form,'decimal','Decimal separator',{options:[['.','Point'],[',','Comma']]});
    _budgetField(form,'currencyColumn','Currency column (when present)',{options:[['','No currency column: account currency applies'],...columns],optional:true,help:`Every imported amount must be ${_budget.currency}. No currency conversion. Map the posted currency, not a foreign original amount.`});
    if (_budget.source) _budgetTable(section,`${_budget.source.name}: first ${_budget.source.sample.length} of ${_budget.source.rowCount} data rows`,_budget.source.headers,_budget.source.sample);
  } else {
    const p = _budget.preview;
    body.append(_budgetNode('p',`${p.sourceName}: ${p.rowCount} rows, ${p.invalidCount} invalid, ${p.duplicateCount} duplicate candidates. Valid-row total before exclusions: ${p.currency} ${_budgetDecimal(p.totalMinor,p.minorDigits)}.`,'budget-notice'));
    const rows = _budget.page.map(row => {
      const choice = _budgetNode('select'); choice.setAttribute('aria-label',`Decision for source row ${row.row}`);
      _budgetOptions(choice,[['',row.error || row.existingMatches || row.repeatedInFile ? 'Review required' : 'Include valid row'],...(!row.error ? [['keep','Keep this purchase']] : []),['skip','Exclude this row']],_budget.decisions.get(row.row) || '');
      choice.addEventListener('change',() => { if (choice.value) _budget.decisions.set(row.row,choice.value); else _budget.decisions.delete(row.row); });
      return [row.row,row.date || '',row.description || '',row.amount == null ? '' : _budgetMoney(row.amount),row.error || (row.existingMatches || row.repeatedInFile ? 'Candidate duplicate; equal purchases may be legitimate.' : 'Valid'),choice,row.cells.join(' | ')];
    });
    _budgetTable(body,'Source rows and explicit decisions',['Row','Date','Description','Amount','Finding','Decision','Original cells'],rows);
    body.append(_budgetButton('Extend preview by 10 minutes',() => _budgetRun(async () => {
      const renewed = await _budgetRequest({action:'extendPreview',entityId:_budget.entity,id:p.id}); p.expiresAt = renewed.expiresAt;
      _budgetEl('notice').textContent = 'Preview extended by 10 minutes. Existing row decisions retained.';
    })));
    const actions = _budgetNode('div',null,'budget-actions');
    const previous = _budgetButton('Previous preview rows',() => _budgetRun(async epoch => { _budget.pageOffset -= 100; await _budgetPreviewPage(epoch); })); previous.disabled = _budget.pageOffset === 0;
    const next = _budgetButton('Next preview rows',() => _budgetRun(async epoch => { _budget.pageOffset += 100; await _budgetPreviewPage(epoch); })); next.disabled = _budget.pageOffset+100 >= p.rowCount;
    actions.append(previous,_budgetNode('span',`${_budget.pageOffset+1}–${Math.min(_budget.pageOffset+100,p.rowCount)} of ${p.rowCount}`),next,
      _budgetButton('Review totals and import',() => _budgetRun(async epoch => {
        const result = await _budgetRequest({action:'commitImport',entityId:_budget.entity,id:p.id,decisions:[..._budget.decisions].map(([row,action]) => ({row,action}))});
        if (epoch !== _budget.epoch) return;
        _budgetClearImport(); await _budgetApi('cancel'); _budget.tab = 'transactions'; _budget.offset = 0; await _budgetLoad(epoch);
        _budgetEl('notice').textContent = `Rows imported: ${result.result.imported}. Change Year if source dates fall outside the selected year. Originals retained.`;
      }),true)); body.append(actions);
  }
  body.append(_budgetButton('Cancel import and discard preview',() => _budgetRun(async () => { await _budgetApi('cancel'); _budgetClearImport(); _budgetRender(); })));
  const imports = _budgetSection('Import history and reversible corrections');
  imports.append(_budgetNode('p',`All years for this entity/currency. ${_budget.report.importsLimited ? 'First 1,000 batches only.' : ''} Voiding excludes a batch from totals without deleting its originals.`));
  _budgetPagedTable(imports,'Import batches',['Source','Imported rows','Status','Action'],_budget.report.imports.map(row => [row.source_name,row.imported_row_count,row.voided_at ? 'Voided' : row.state,_budgetButton(row.voided_at ? 'Restore batch' : 'Void batch',() => _budgetRun(async epoch => { await _budgetRequest({action:'void',entityId:_budget.entity,type:'import_batch',id:row.id,voided:!row.voided_at}); await _budgetLoad(epoch); }))]));
}
async function _budgetPreviewPage(epoch) {
  const rows = await _budgetRequest({action:'previewPage',entityId:_budget.entity,id:_budget.preview.id,offset:_budget.pageOffset});
  if (epoch !== _budget.epoch) return; _budget.page = rows; _budgetRender();
}
function _budgetClearImport() { _budget.source = null; _budget.preview = null; _budget.page = []; _budget.decisions.clear(); _budget.pageOffset = 0; }
function _budgetSetup(first) {
  const entitySection = _budgetSection('Personal ledger / reporting boundary',first);
  const entityForm = _budgetForm(entitySection,'entity','Review and create ledger',async (form,epoch) => {
    const result = await _budgetRequest({action:'createEntity',id:_budgetId(form),name:_budgetValue(form,'name'),kind:_budgetValue(form,'kind')});
    const key = `${_budgetScope()}:${form.id}`; _budget.drafts.delete(key); _budget.ids.delete(key);
    _budget.entity = result.result; _budget.currency = ''; await _budgetLoad(epoch);
  });
  _budgetField(entityForm,'name','Ledger name',{value:'Personal'});
  _budgetField(entityForm,'kind','Reporting boundary',{options:[['personal','Personal'],['business','Business (optional separate boundary)']]});
  if (first) return;
  const accountSection = _budgetSection('Add an account alias',!_budgetAccounts().length);
  accountSection.append(_budgetNode('p','No login, bank credentials or card numbers. Opening balance is immediately before transactions on the opening date. Debt is negative.'));
  const accountForm = _budgetForm(accountSection,'account','Review account opening balance',async (form,epoch) => {
    const precision = Number(_budgetValue(form,'precision'));
    await _budgetSave(form,{action:'createAccount',id:_budgetId(form),entityId:_budget.entity,alias:_budgetValue(form,'alias'),currency:_budgetValue(form,'currency').toUpperCase(),precision,balance:_budgetMinor(_budgetValue(form,'balance'),precision),date:_budgetValue(form,'date')},epoch);
  });
  _budgetField(accountForm,'alias','Account alias'); _budgetField(accountForm,'currency','Currency code',{value:_budget.currency || 'USD',maxLength:3});
  _budgetField(accountForm,'precision','Decimal places',{type:'number',min:0,max:4,value:2,help:'Use 2 for USD; verify the scale for other currencies. This cannot be changed after creation.'});
  _budgetField(accountForm,'balance','Signed opening balance',{money:true,value:'0'}); _budgetField(accountForm,'date','Opening date',{type:'date',value:_budgetToday(),min:'1900-01-01',max:'2200-12-31'});
  const categorySection = _budgetSection('Add a category');
  const categoryForm = _budgetForm(categorySection,'category','Review category',async (form,epoch) => _budgetSave(form,{action:'createCategory',id:_budgetId(form),entityId:_budget.entity,name:_budgetValue(form,'name'),kind:_budgetValue(form,'kind')},epoch));
  _budgetField(categoryForm,'name','Category name'); _budgetField(categoryForm,'kind','Category treatment',{options:[['expense','Expense (refunds reduce spending)'],['income','Income'],['transfer','Transfer / card payment (not spending)']]});
  if (!_budget.report) return;
  const categories = _budgetCategories();
  const budgetSection = _budgetSection('Monthly or annual budget');
  const budgetForm = _budgetForm(budgetSection,'budget','Review budget',async (form,epoch) => {
    const months = Number(_budgetValue(form,'months')), categoryId = _budgetValue(form,'category'), start = `${_budget.year}-${months === 12 ? '01' : _budgetValue(form,'month')}-01`;
    const before = _budget.report.budgetComparison.find(b => b.category_id === categoryId && b.period_start === start && b.months === months);
    await _budgetSave(form,{action:'saveBudget',entityId:_budget.entity,categoryId,currency:_budget.currency,start,months,amount:_budgetMinor(_budgetValue(form,'amount')),expected:before?.amount_minor ?? null},epoch);
  });
  _budgetField(budgetForm,'category','Income or expense category',{options:categories.filter(c => ['income','expense'].includes(c.kind)).map(c => [c.id,c.name])});
  _budgetField(budgetForm,'months','Period',{options:[['1','Monthly'],['12','Calendar year']]});
  _budgetField(budgetForm,'month','Month (ignored for annual)',{options:Array.from({length:12},(_,i) => [String(i+1).padStart(2,'0'),String(i+1)])});
  _budgetField(budgetForm,'amount',`Budget amount (${_budget.currency})`,{money:true,help:'Nonnegative target. Zero keeps a zero target; overlapping monthly/yearly budgets are independent.'});
  const statementSection = _budgetSection('Enter a statement balance');
  const statementForm = _budgetForm(statementSection,'statement','Review statement balance',async (form,epoch) => {
    const accountId = _budgetValue(form,'account'), date = _budgetValue(form,'date');
    const before = await _budgetRequest({action:'statement',entityId:_budget.entity,accountId,date});
    await _budgetSave(form,{action:'saveStatement',entityId:_budget.entity,accountId,date,balance:_budgetMinor(_budgetValue(form,'balance')),expected:before?.statement_balance_minor ?? null},epoch);
  });
  _budgetField(statementForm,'account','Account alias',{options:_budgetAccounts().map(a => [a.id,a.alias])});
  _budgetField(statementForm,'date','Statement date',{type:'date',min:'1900-01-01',max:'2200-12-31'});
  _budgetField(statementForm,'balance',`Signed statement balance (${_budget.currency})`,{money:true,help:'Manually entered, not verified with a bank. Debt is negative.'});
  const rules = _budgetSection('Merchant suggestions');
  rules.append(_budgetNode('p','Rules suggest categories only. Apply a suggestion through Edit allocations; nothing is categorized automatically.'));
  const ruleForm = _budgetForm(rules,'rule','Review suggestion rule',async (form,epoch) => {
    const match = _budgetValue(form,'match').trim().toLowerCase(); const before = _budget.report.rules.find(r => r.match_text === match);
    await _budgetSave(form,{action:'saveRule',entityId:_budget.entity,id:before?.id || _budgetId(form),match,categoryId:_budgetValue(form,'category'),enabled:_budgetValue(form,'enabled') === 'yes'},epoch);
  });
  _budgetField(ruleForm,'match','Description contains (case insensitive)');
  _budgetField(ruleForm,'category','Suggested category',{options:categories.map(c => [c.id,c.name])});
  _budgetField(ruleForm,'enabled','Show suggestions',{options:[['no','Disabled'],['yes','Enabled (review every allocation)']]});
  _budgetTable(rules,'Existing rules',['Contains','Category','Enabled'],_budget.report.rules.map(r => [r.match_text,categories.find(c => c.id === r.category_id)?.name,r.enabled ? 'Yes' : 'No']));
  _budgetScenario();
}
function _budgetScenario() {
  const section = _budgetSection('What-if scenarios');
  section.append(_budgetNode('p','Only entered assumptions are projected. These are not bank balances, predictions, tax advice or verified income.'));
  const command = form => ({action:'saveScenario',entityId:_budget.entity,id:_budgetId(form),name:_budgetValue(form,'name'),assumptions:{currency:_budget.currency,openingBalanceMinor:_budgetMinor(_budgetValue(form,'opening')),monthlyIncomeMinor:_budgetMinor(_budgetValue(form,'income')),monthlyExpenseMinor:_budgetMinor(_budgetValue(form,'expense')),months:Number(_budgetValue(form,'months'))}});
  const form = _budgetForm(section,'scenario','Review and save scenario',async (f,epoch) => _budgetSave(f,command(f),epoch));
  _budgetField(form,'name','Scenario name'); _budgetField(form,'opening','Signed starting balance',{money:true});
  _budgetField(form,'income','Monthly income assumption',{money:true}); _budgetField(form,'expense','Monthly expense assumption',{money:true});
  _budgetField(form,'months','Number of months',{type:'number',min:1,max:60,value:12});
  const output = _budgetNode('div');
  const preview = assumptions => _budgetRun(async () => {
    const result = await _budgetRequest(assumptions); output.replaceChildren(); output.append(_budgetNode('p',result.label));
    _budgetTable(output,'Calculated what-if balances',['Month','Balance'],result.balances.map(row => [row.month,_budgetMoney(row.balanceMinor)]));
  });
  section.append(_budgetButton('Preview without saving',() => { if (form.reportValidity()) return preview({...command(form),action:'projectScenario'}); }),output);
  _budgetTable(section,'Saved scenarios (latest 100)',['Name','Action'],_budget.report.scenarios.map(row => [row.name,_budgetButton('View projection',() => preview({action:'projectScenario',entityId:_budget.entity,id:row.id,name:row.name,assumptions:JSON.parse(row.assumptions_json)}))]));
}
function showBudgetPanel() {
  _dismissOtherPanels('budget-view'); document.getElementById('chat-view').classList.add('hidden');
  _budgetEl('view').classList.add('active'); document.getElementById('sidebar-budget-btn').classList.add('active');
  window._sidebarEnterPanelMode?.(); _budgetEl('title').focus();
  if (_budget.busy) _budget.reopen = true; else void _budgetRun(_budgetLoad,'Loading local ledger…');
}
function budgetPanelDismissed() {
  _budgetRemember(); _budget.epoch++; _budgetClearImport();
  void _budgetApi('cancel').catch(() => { /* No consent is inferred from a missing renderer. */ });
  _budgetEl('ai-result').replaceChildren();
}
function hideBudgetPanel() {
  budgetPanelDismissed(); _budgetEl('view').classList.remove('active');
  document.getElementById('chat-view').classList.remove('hidden'); document.getElementById('sidebar-budget-btn').classList.remove('active');
  window._sidebarExitPanelMode?.(); document.getElementById('sidebar-budget-btn').focus();
}
function toggleBudgetPanel() { if (_budgetActive()) hideBudgetPanel(); else showBudgetPanel(); }

_budgetEl('back').addEventListener('click',hideBudgetPanel);
_budgetEl('refresh').addEventListener('click',() => { void _budgetRun(_budgetLoad,'Refreshing local ledger…'); });
_budgetEl('stop').addEventListener('click',() => {
  _budget.epoch++; _budgetClearImport();
  void _budgetApi('cancel').then(() => { _budgetEl('status').textContent = 'Canceled pending previews/AI. A confirmed atomic write may already be saved; refresh to check.'; }).catch(_budgetError);
});
for (const button of _budgetEl('nav').querySelectorAll('button')) button.addEventListener('click',() => {
  if (_budget.busy) return;
  void _budgetRun(async epoch => { _budget.tab = button.dataset.budgetTab; await _budgetLoad(epoch); });
});
for (const name of ['entity','currency','year']) _budgetEl(name).addEventListener('change',() => {
  void _budgetRun(async epoch => {
    const value = _budgetEl(name).value;
    if (name === 'year' && (!/^\d{4}$/.test(value) || Number(value) < 1900 || Number(value) > 2200)) throw new Error('Choose a year between 1900 and 2200.');
    await _budgetApi('cancel'); _budgetClearImport(); _budget.editing = null; _budget.splits = 1; _budget.offset = 0;
    _budget[name] = name === 'year' ? Number(value) : value; await _budgetLoad(epoch);
  });
});
_budgetEl('backup').addEventListener('click',() => { void _budgetRun(async () => {
  const result = await _budgetRequest({action:'backup'}); _budget.warning = result.backupWarning || '';
  _budgetEl('notice').textContent = 'Local finance backup completed. Receipt files are references only; this does not protect against loss of the Mac.';
}); });
_budgetEl('export').addEventListener('click',() => { void _budgetRun(async () => {
  const result = await _budgetApi('export',_budgetPeriod());
  if (result) _budgetEl('notice').textContent = `Accountant-preparation packet saved locally: ${result.directory}. Unencrypted; not audited statements or tax filing.`;
}); });
_budgetEl('analyze').addEventListener('click',() => { void _budgetRun(async epoch => {
  const result = await _budgetApi('analyze',_budgetPeriod());
  if (epoch !== _budget.epoch) return;
  const output = _budgetEl('ai-result'); output.replaceChildren(_budgetNode('h2','AI interpretation (not the ledger)'),_budgetNode('p',result.notice),_budgetNode('pre',result.response));
  output.append(_budgetButton('Open approved-aggregate chat',async () => {
    hideBudgetPanel(); if (typeof switchSession === 'function') await switchSession(result.sessionId);
  }));
},'Awaiting approval of the exact aggregate and provider. No raw rows are sent.'); });
