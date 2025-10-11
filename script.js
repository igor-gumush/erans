// Setup dayjs with timezone
dayjs.extend(dayjs_plugin_utc); 
dayjs.extend(dayjs_plugin_timezone); 
dayjs.extend(dayjs_plugin_customParseFormat);
dayjs.extend(dayjs_plugin_isSameOrBefore);
dayjs.extend(dayjs_plugin_minMax);
const TZ = 'Asia/Jerusalem';

// In-memory store
/** @type {Array<{id:string,title:string,factory:string,workers:string[],factoryManager:string,maintenanceManager:string,priority:string,equipmentNumber:string,serviceCall:string,department:string,start:string,end:string,notes:string,dependsOn:string,finished:boolean}>} */
let JOBS = [];
let nextId = 1;

// Store for factories, workers, managers, and departments
let FACTORIES = new Set();
let WORKERS = new Set();
let FACTORY_MANAGERS = new Set();
let MAINTENANCE_MANAGERS = new Set();
let DEPARTMENTS = new Set();

// Column visibility settings
let COLUMN_VISIBILITY = {
  title: true,
  factory: true,
  worker: true,
  factoryManager: true,
  maintenanceManager: true,
  priority: true,
  equipmentNumber: true,
  serviceCall: true,
  department: true,
  start: true,
  end: true,
  duration: true,
  notes: true,
  flags: true,
  actions: true
};

// DOM helpers
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

function uid(){ return String(nextId++); }

function toLocal(dt){ return dayjs.tz(dt, TZ); }

function fmt(dt){ 
  if(!dt) return '';
  const date = toLocal(dt);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '';
}

function durationStr(a, b){
  if(!a || !b) return '';
  const startDate = dayjs(a);
  const endDate = dayjs(b);
  if(!startDate.isValid() || !endDate.isValid()) return '';
  const mins = endDate.diff(startDate, 'minute');
  const h = Math.floor(mins/60), m = mins%60; 
  return `${h}h ${m}m`;
}

function roundTo15(dateStr){
  if(!dateStr) return dateStr;
  const d = dayjs(dateStr);
  const m = d.minute();
  const rounded = Math.round(m/15)*15; // to nearest 15
  return d.minute(rounded).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
}

function isOverlap(aStart, aEnd, bStart, bEnd){
  return (dayjs(aStart).isBefore(dayjs(bEnd)) && dayjs(bStart).isBefore(dayjs(aEnd)));
}

function isShabbat(dt){
  const d = dayjs(dt);
  const wd = d.day(); // 0=Sun ... 5=Fri 6=Sat
  if(wd === 6) return true; // Saturday
  if(wd === 5 && d.hour()>=18) return true; // Friday 18:00+
  return false;
}

function jobTouchesShabbat(job){
  if(!job.start || !job.end) return false;
  const startDate = dayjs(job.start);
  const endDate = dayjs(job.end);
  if(!startDate.isValid() || !endDate.isValid()) return false;
  return isShabbat(job.start) || isShabbat(job.end) || (startDate.day()===5 && endDate.day()===6);
}

function recomputeConflicts(){
  // For each worker, check overlapping intervals
  const byWorker = new Map();
  JOBS.forEach(j=>{
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    workers.forEach(worker => {
      if(!byWorker.has(worker)) byWorker.set(worker, []);
      byWorker.get(worker).push(j);
    });
  });
  const conflicted = new Set();
  for(const [w, arr] of byWorker){
    arr.sort((a,b)=> dayjs(a.start).valueOf()-dayjs(b.start).valueOf());
    // Check all pairs, not just consecutive ones
    for(let i=0; i<arr.length; i++){
      for(let j=i+1; j<arr.length; j++){
        if(isOverlap(arr[i].start, arr[i].end, arr[j].start, arr[j].end)){
          conflicted.add(arr[i].id);
          conflicted.add(arr[j].id);
        }
      }
    }
  }
  return conflicted;
}

function recomputeDependencyIssues(){
  // Check if jobs that depend on others start before their dependencies end
  const issues = new Set();
  JOBS.forEach(job => {
    if(job.dependsOn && job.start && job.end){
      const dependency = JOBS.find(j => j.id === job.dependsOn);
      if(dependency && dependency.start && dependency.end){
        const jobStart = dayjs(job.start);
        const depEnd = dayjs(dependency.end);
        if(jobStart.isValid() && depEnd.isValid() && jobStart.isBefore(depEnd)){
          issues.add(job.id);
          issues.add(dependency.id);
        }
      }
    }
  });
  return issues;
}

function unique(list){ return Array.from(new Set(list.filter(Boolean))).sort(); }

function updateColumnVisibility(){
  // Update table headers
  $$('thead th[data-column]').forEach(th => {
    const column = th.dataset.column;
    th.style.display = COLUMN_VISIBILITY[column] ? '' : 'none';
  });
  
  // Update table body cells
  $$('tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    cells.forEach((cell, index) => {
      if(index === 0) return; // Skip row number
      const header = $$('thead th')[index];
      if(header && header.dataset.column) {
        const column = header.dataset.column;
        cell.style.display = COLUMN_VISIBILITY[column] ? '' : 'none';
      }
    });
  });
  
  // Update checkboxes
  $$('.column-controls input[type="checkbox"]').forEach(checkbox => {
    const column = checkbox.dataset.column;
    checkbox.checked = COLUMN_VISIBILITY[column];
  });
}

function saveColumnVisibility(){
  localStorage.setItem('columnVisibility', JSON.stringify(COLUMN_VISIBILITY));
}

function loadColumnVisibility(){
  const saved = localStorage.getItem('columnVisibility');
  if(saved) {
    COLUMN_VISIBILITY = { ...COLUMN_VISIBILITY, ...JSON.parse(saved) };
  }
}

function updateFormDropdowns(){
  // Update factory dropdown
  const fSel = $('#f-factory');
  const currentFactory = fSel.value;
  const factories = Array.from(FACTORIES).sort();
  fSel.innerHTML = '<option value="">בחר מפעל...</option>' + 
    factories.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מפעל חדש</option>';
  if(currentFactory && FACTORIES.has(currentFactory)) {
    fSel.value = currentFactory;
  }

  // Update worker multi-select checkboxes
  const wOptions = $('#f-worker-options');
  const currentWorkers = getSelectedWorkers();
  const workers = Array.from(WORKERS).sort();
  wOptions.innerHTML = workers.map(v=>`
    <div class="multi-select-option">
      <input type="checkbox" id="worker-${escapeHtml(v)}" value="${escapeHtml(v)}" ${currentWorkers.includes(v) ? 'checked' : ''}>
      <label for="worker-${escapeHtml(v)}">${escapeHtml(v)}</label>
    </div>
  `).join('');
  
  // Update selected workers display
  updateWorkerDisplay();

  // Update factory manager dropdown
  const fmSel = $('#f-factoryManager');
  const currentFactoryManager = fmSel.value;
  const factoryManagers = Array.from(FACTORY_MANAGERS).sort();
  fmSel.innerHTML = '<option value="">בחר מפקח עבודה...</option>' + 
    factoryManagers.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מפקח עבודה חדש</option>';
  if(currentFactoryManager && FACTORY_MANAGERS.has(currentFactoryManager)) {
    fmSel.value = currentFactoryManager;
  }

  // Update maintenance manager dropdown
  const mmSel = $('#f-maintenanceManager');
  const currentMaintenanceManager = mmSel.value;
  const maintenanceManagers = Array.from(MAINTENANCE_MANAGERS).sort();
  mmSel.innerHTML = '<option value="">בחר מנהל עבודה...</option>' + 
    maintenanceManagers.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מנהל עבודה חדש</option>';
  if(currentMaintenanceManager && MAINTENANCE_MANAGERS.has(currentMaintenanceManager)) {
    mmSel.value = currentMaintenanceManager;
  }

  // Update department dropdown
  const deptSel = $('#f-department');
  const currentDepartment = deptSel.value;
  const departments = Array.from(DEPARTMENTS).sort();
  deptSel.innerHTML = '<option value="">בחר מחלקה...</option>' + 
    departments.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') +
    '<option value="__add_new__">➕ הוסף מחלקה חדשה</option>';
  if(currentDepartment && DEPARTMENTS.has(currentDepartment)) {
    deptSel.value = currentDepartment;
  }

  // Update depends on dropdown
  const dSel = $('#f-dependsOn');
  const currentDep = dSel.value;
  dSel.innerHTML = '<option value="">ללא תלות</option>' + 
    JOBS.map(j=>{
      const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
      const workersStr = workers.length > 0 ? workers.join(', ') : 'ללא עובד מבצע';
      return `<option value="${j.id}">${escapeHtml(j.title||'ללא כותרת')} (${escapeHtml(workersStr)})</option>`;
    }).join('');
  if(currentDep) {
    dSel.value = currentDep;
  }
}

function refreshFilters(){
  const factories = unique(JOBS.map(j=>j.factory));
  // Collect all workers from all jobs (flattening the arrays)
  const workersSet = new Set();
  JOBS.forEach(j => {
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    workers.forEach(w => { if(w) workersSet.add(w); });
  });
  const workers = Array.from(workersSet).filter(Boolean).sort();
  const factoryManagers = unique(JOBS.map(j=>j.factoryManager));
  const maintenanceManagers = unique(JOBS.map(j=>j.maintenanceManager));
  const priorities = unique(JOBS.map(j=>j.priority));
  const departments = unique(JOBS.map(j=>j.department));
  
  const fSel = $('#fltFactory'), wSel = $('#fltWorker');
  const fmSel = $('#fltFactoryManager'), mmSel = $('#fltMaintenanceManager');
  const pSel = $('#fltPriority'), dSel = $('#fltDepartment');
  
  fSel.innerHTML = '<option value="">הכל</option>' + factories.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  wSel.innerHTML = '<option value="">הכל</option>' + workers.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  fmSel.innerHTML = '<option value="">הכל</option>' + factoryManagers.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  mmSel.innerHTML = '<option value="">הכל</option>' + maintenanceManagers.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  pSel.innerHTML = '<option value="">הכל</option>' + priorities.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  dSel.innerHTML = '<option value="">הכל</option>' + departments.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
  
  // Update form dropdowns
  updateFormDropdowns();
}

function passFilters(j){
  const ff = $('#fltFactory').value.trim();
  const fw = $('#fltWorker').value.trim();
  const ffm = $('#fltFactoryManager').value.trim();
  const fmm = $('#fltMaintenanceManager').value.trim();
  const fp = $('#fltPriority').value.trim();
  const fe = $('#fltEquipmentNumber').value.trim();
  const fs = $('#fltServiceCall').value.trim();
  const fd = $('#fltDepartment').value.trim();
  const fstatus = $('#fltStatus').value.trim();
  const q = $('#fltSearch').value.toLowerCase().trim();
  const from = $('#fltFrom').value; const to = $('#fltTo').value;
  const onlyConf = $('#fltConflictsOnly').checked;
  const onlyDepIssues = $('#fltDependencyIssuesOnly').checked;
  const showBoth = $('#fltShowBoth').checked;
  
  const conflicted = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();
  
  if(ff && j.factory!==ff) return false;
  // Check if any of the workers match the filter
  if(fw) {
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    if(!workers.includes(fw)) return false;
  }
  if(ffm && j.factoryManager!==ffm) return false;
  if(fmm && j.maintenanceManager!==fmm) return false;
  if(fp && j.priority!==fp) return false;
  if(fe && !(j.equipmentNumber||'').toLowerCase().includes(fe.toLowerCase())) return false;
  if(fs && !(j.serviceCall||'').toLowerCase().includes(fs.toLowerCase())) return false;
  if(fd && j.department!==fd) return false;
  if(fstatus === 'finished' && !j.finished) return false;
  if(fstatus === 'unfinished' && j.finished) return false;
  if(from && j.end){ 
    const endDate = dayjs(j.end);
    if(endDate.isValid() && endDate.isBefore(dayjs(from))) return false; 
  }
  if(to && j.start){ 
    const startDate = dayjs(j.start);
    if(startDate.isValid() && startDate.isAfter(dayjs(to).endOf('day'))) return false; 
  }
  if(q){ const blob = `${j.title} ${j.notes||''} ${j.priority||''} ${j.equipmentNumber||''} ${j.serviceCall||''} ${j.department||''}`.toLowerCase(); if(!blob.includes(q)) return false; }
  
  // Handle issue filters
  if(showBoth){
    if(!conflicted.has(j.id) && !depIssues.has(j.id)) return false;
  } else {
    if(onlyConf && !conflicted.has(j.id)) return false;
    if(onlyDepIssues && !depIssues.has(j.id)) return false;
  }
  
  return true;
}

function renderTable(){
  const tb = $('#tbody'); tb.innerHTML='';
  const conflicts = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();
  const rows = JOBS.filter(passFilters);
  $('#emptyTable').style.display = rows.length? 'none':'block';
  
  // Setup scroll sync after a short delay to ensure table is rendered
  setTimeout(() => {
    setupTableScrollSync();
  }, 100);
  
  // Sort rows based on current sort state
  rows.sort((a,b)=> {
    let valA, valB;
    switch(sortState.column) {
      case 'title':
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'factory':
        valA = (a.factory || '').toLowerCase();
        valB = (b.factory || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'worker':
        valA = (a.worker || '').toLowerCase();
        valB = (b.worker || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'factoryManager':
        valA = (a.factoryManager || '').toLowerCase();
        valB = (b.factoryManager || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'maintenanceManager':
        valA = (a.maintenanceManager || '').toLowerCase();
        valB = (b.maintenanceManager || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'priority':
        valA = (a.priority || '').toLowerCase();
        valB = (b.priority || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'equipmentNumber':
        valA = (a.equipmentNumber || '').toLowerCase();
        valB = (b.equipmentNumber || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'serviceCall':
        valA = (a.serviceCall || '').toLowerCase();
        valB = (b.serviceCall || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'department':
        valA = (a.department || '').toLowerCase();
        valB = (b.department || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'start':
        valA = dayjs(a.start).valueOf();
        valB = dayjs(b.start).valueOf();
        return sortState.ascending ? valA - valB : valB - valA;
      case 'end':
        valA = dayjs(a.end).valueOf();
        valB = dayjs(b.end).valueOf();
        return sortState.ascending ? valA - valB : valB - valA;
      case 'duration':
        valA = dayjs(a.end).diff(dayjs(a.start), 'minute');
        valB = dayjs(b.end).diff(dayjs(b.start), 'minute');
        return sortState.ascending ? valA - valB : valB - valA;
      case 'notes':
        valA = (a.notes || '').toLowerCase();
        valB = (b.notes || '').toLowerCase();
        return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
      default:
        return 0;
    }
  });
  
  // Update header sort indicators
  $$('thead th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if(th.dataset.sort === sortState.column) {
      th.classList.add(sortState.ascending ? 'sort-asc' : 'sort-desc');
    }
  });
  
  rows.forEach((j, idx)=>{
    const isBad = conflicts.has(j.id);
    const isDepIssue = depIssues.has(j.id);
    const isShab = jobTouchesShabbat(j);
    const isFinished = j.finished;
    const tr = document.createElement('tr');
    if(isBad) tr.classList.add('row-bad');
    if(isDepIssue) tr.classList.add('row-dep-issue');
    if(isShab) tr.classList.add('row-shabbat');
    if(isFinished) tr.classList.add('row-finished');
    const dur = durationStr(j.start, j.end);
    
    const depInfo = j.dependsOn ? JOBS.find(dj=>dj.id===j.dependsOn) : null;
    const depBadge = depInfo ? `<span class="badge dep" title="תלוי ב: ${escapeHtml(depInfo.title||'ללא כותרת')}">🔗 ${escapeHtml(depInfo.title||'תל')}</span>` : '';
    
    const flags = [ 
      isFinished?'<span class="badge good">✓ הושלם</span>':'',
      isBad?'<span class="badge bad">קונפליקט</span>':'' , 
      isDepIssue?'<span class="badge bad">בעיית תלות</span>':'',
      isShab?'<span class="badge warn">ליל שישי/שבת</span>':'',
      depBadge
    ].filter(Boolean).join(' ');
    
    const finishIcon = isFinished ? '↶' : '✓';
    const finishTitle = isFinished ? 'סמן כלא הושלם' : 'סמן כהושלם';
    const finishClass = isFinished ? 'btn-icon' : 'btn-icon btn-icon-success';
    
    // Format workers - handle both old string format and new array format
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    const workersDisplay = workers.length > 0 ? workers.join(', ') : '';
    
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td data-column="title">${isFinished ? '<s>'+escapeHtml(j.title||'')+'</s>' : escapeHtml(j.title||'')}</td>
      <td data-column="factory">${escapeHtml(j.factory||'')}</td>
      <td data-column="worker">${escapeHtml(workersDisplay)}</td>
      <td data-column="factoryManager">${escapeHtml(j.factoryManager||'')}</td>
      <td data-column="maintenanceManager">${escapeHtml(j.maintenanceManager||'')}</td>
      <td data-column="priority">${escapeHtml(j.priority||'')}</td>
      <td data-column="equipmentNumber">${escapeHtml(j.equipmentNumber||'')}</td>
      <td data-column="serviceCall">${escapeHtml(j.serviceCall||'')}</td>
      <td data-column="department">${escapeHtml(j.department||'')}</td>
      <td data-column="start">${escapeHtml(fmt(j.start))}</td>
      <td data-column="end">${escapeHtml(fmt(j.end))}</td>
      <td data-column="duration">${escapeHtml(dur)}</td>
      <td data-column="notes">${escapeHtml(j.notes||'')}</td>
      <td data-column="flags">${flags}</td>
      <td class="actions" data-column="actions">
        <button class="${finishClass}" data-act="finish" data-id="${j.id}" title="${finishTitle}">${finishIcon}</button>
        <button class="btn-icon" data-act="edit" data-id="${j.id}" title="ערוך משימה">✎</button>
        <button class="btn-icon btn-icon-danger" data-act="del" data-id="${j.id}" title="מחק משימה">✕</button>
      </td>`;
    tb.appendChild(tr);
  });
}

// Global drag state
let dragState = {
  isDragging: false,
  job: null,
  startX: 0,
  startLeft: 0,
  originalWorker: null,
  currentWorker: null,
  offsetX: 0
};

// Sort state
let sortState = {
  column: 'start', // default sort by start time
  ascending: true
};

function renderTimeline(){
  const day = $('#tl-date').value || dayjs().format('YYYY-MM-DD');
  const startDay = dayjs(day).startOf('day');
  const endDay = dayjs(day).endOf('day');
  
  // Get all jobs for the day first
  let jobs = JOBS.filter(j=> {
    // Skip jobs with invalid or empty dates
    if(!j.start || !j.end) return false;
    const startDate = dayjs(j.start);
    const endDate = dayjs(j.end);
    if(!startDate.isValid() || !endDate.isValid()) return false;
    return endDate.isAfter(startDay) && startDate.isBefore(endDay);
  });
  
  // Check if we're filtering by conflicts or dependency issues
  const onlyConf = $('#fltConflictsOnly').checked;
  const onlyDepIssues = $('#fltDependencyIssuesOnly').checked;
  const showBoth = $('#fltShowBoth').checked;
  
  if(onlyConf || onlyDepIssues || showBoth) {
    // Find workers with issues
    const conflicted = recomputeConflicts();
    const depIssues = recomputeDependencyIssues();
    const workersWithIssues = new Set();
    
    // Collect workers who have conflicts or dependency issues
    JOBS.forEach(job => {
      if(conflicted.has(job.id) || depIssues.has(job.id)) {
        const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
        workers.forEach(w => workersWithIssues.add(w));
      }
    });
    
    // Filter to show ALL tasks for workers with issues
    jobs = jobs.filter(job => {
      const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
      return workers.some(w => workersWithIssues.has(w));
    });
    
    // Apply other filters (factory, worker, etc.) but skip the conflict/dependency filters
    // since we already handled them above
    const ff = $('#fltFactory').value.trim();
    const fw = $('#fltWorker').value.trim();
    const ffm = $('#fltFactoryManager').value.trim();
    const fmm = $('#fltMaintenanceManager').value.trim();
    const fp = $('#fltPriority').value.trim();
    const fe = $('#fltEquipmentNumber').value.trim();
    const fs = $('#fltServiceCall').value.trim();
    const fd = $('#fltDepartment').value.trim();
    const fstatus = $('#fltStatus').value.trim();
    const q = $('#fltSearch').value.toLowerCase().trim();
    const from = $('#fltFrom').value; 
    const to = $('#fltTo').value;
    
    jobs = jobs.filter(j => {
      if(ff && j.factory!==ff) return false;
      if(fw && j.worker!==fw) return false;
      if(ffm && j.factoryManager!==ffm) return false;
      if(fmm && j.maintenanceManager!==fmm) return false;
      if(fp && j.priority!==fp) return false;
      if(fe && !(j.equipmentNumber||'').toLowerCase().includes(fe.toLowerCase())) return false;
      if(fs && !(j.serviceCall||'').toLowerCase().includes(fs.toLowerCase())) return false;
      if(fd && j.department!==fd) return false;
      if(fstatus === 'finished' && !j.finished) return false;
      if(fstatus === 'unfinished' && j.finished) return false;
      if(from && j.end){ 
        const endDate = dayjs(j.end);
        if(endDate.isValid() && endDate.isBefore(dayjs(from))) return false; 
      }
      if(to && j.start){ 
        const startDate = dayjs(j.start);
        if(startDate.isValid() && startDate.isAfter(dayjs(to).endOf('day'))) return false; 
      }
      if(q){ const blob = `${j.title} ${j.notes||''} ${j.priority||''} ${j.equipmentNumber||''} ${j.serviceCall||''} ${j.department||''}`.toLowerCase(); if(!blob.includes(q)) return false; }
      return true;
    });
  } else {
    // Apply normal filters for other cases
    jobs = jobs.filter(passFilters);
  }
  
  const host = $('#timeline'); host.innerHTML='';
  $('#emptyTimeline').style.display = jobs.length? 'none':'block';

  // Group jobs by worker - handle multiple workers per job
  const byWorker = new Map();
  jobs.forEach(j=>{
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    if(workers.length === 0) {
      // If no workers, add to a special "(ללא עובד מבצע)" lane
      if(!byWorker.has('')) byWorker.set('', []);
      byWorker.get('').push(j);
    } else {
      // Add job to each worker's lane
      workers.forEach(worker => {
        if(!byWorker.has(worker)) byWorker.set(worker, []);
        byWorker.get(worker).push(j);
      });
    }
  });
  const conflicts = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();

  // time ticks (every hour)
  function xPos(dt){ const mins = dayjs(dt).diff(startDay, 'minute'); return (mins/60)*88; } // 88px per hour (matches grid bg)
  
  // Convert position to time
  function posToTime(px){ 
    const hours = px / 88;
    return startDay.add(hours, 'hour');
  }

  // Create hour labels header
  const headerLane = document.createElement('div'); 
  headerLane.className='lane hour-header';
  headerLane.innerHTML = `<div class="label">זמן →</div><div class="grid"></div>`;
  const headerGrid = headerLane.querySelector('.grid');
  const hourLabels = document.createElement('div'); 
  hourLabels.className='hour-labels';
  for(let h=0; h<24; h++){
    const label = document.createElement('div'); 
    label.className='hour-label'; 
    label.style.left = `${h*88}px`;
    label.textContent = `${h}:00`;
    hourLabels.appendChild(label);
  }
  headerGrid.appendChild(hourLabels);
  host.appendChild(headerLane);

  // Color palette for overlapping jobs (different shades)
  const jobColors = [
    { bg: 'linear-gradient(180deg,#1d2b4d,#16213a)', border: '#31476f' }, // Original blue
    { bg: 'linear-gradient(180deg,#2d4d3a,#1e3a28)', border: '#4f7658' }, // Green
    { bg: 'linear-gradient(180deg,#4d3a1d,#3a2a16)', border: '#76624f' }, // Brown
    { bg: 'linear-gradient(180deg,#4d1d3a,#3a1628)', border: '#764f6f' }, // Purple
    { bg: 'linear-gradient(180deg,#1d3a4d,#16283a)', border: '#4f6276' }, // Teal
  ];

  for(const [worker, arr] of Array.from(byWorker.entries()).sort((a,b)=> a[0].localeCompare(b[0]))){
    const lane = document.createElement('div'); lane.className='lane';
    lane.innerHTML = `<div class="label">${escapeHtml(worker||'(ללא עובד מבצע)')}</div><div class="grid"></div>`;
    const grid = lane.querySelector('.grid');

    // ticks 0..24
    const tickbar = document.createElement('div'); tickbar.className='tickbar';
    for(let h=0; h<=24; h++){
      const t = document.createElement('div'); t.className='tick'; t.style.left = `${h*88}px`; tickbar.appendChild(t);
    }
    grid.appendChild(tickbar);

    arr.sort((a,b)=> dayjs(a.start)-dayjs(b.start));
    
    // Detect overlaps within this worker's jobs and assign colors
    const jobsWithOverlaps = arr.map((j, idx) => {
      let overlapGroup = 0;
      for(let i=0; i<idx; i++){
        if(isOverlap(arr[i].start, arr[i].end, j.start, j.end)){
          overlapGroup = (overlapGroup + 1) % jobColors.length;
        }
      }
      return { job: j, colorIdx: overlapGroup };
    });

    jobsWithOverlaps.forEach(({job: j, colorIdx})=>{
      const s = dayjs.max(dayjs(j.start), startDay);
      const e = dayjs.min(dayjs(j.end), endDay);
      const left = xPos(s);
      const width = Math.max(6, xPos(e)-xPos(s));
      const div = document.createElement('div');
      div.className = 'jobbar';
      
      const isConflict = conflicts.has(j.id);
      const isDepIssue = depIssues.has(j.id);
      const isFinished = j.finished;
      
      if(isFinished) {
        div.classList.add('finished');
        // Use different shades of green for finished jobs
        const finishedColors = [
          { bg: 'linear-gradient(180deg,#1d4d2a,#163a20)', border: '#2f7648' }, // Original green
          { bg: 'linear-gradient(180deg,#1d5d2a,#164a20)', border: '#2f8648' }, // Lighter green
          { bg: 'linear-gradient(180deg,#1d3d2a,#162a20)', border: '#2f6648' }, // Darker green
          { bg: 'linear-gradient(180deg,#2a4d1d,#203a16)', border: '#487648' }, // Yellow-green
          { bg: 'linear-gradient(180deg,#1d4d3a,#163a2a)', border: '#2f7658' }, // Teal-green
        ];
        const color = finishedColors[colorIdx % finishedColors.length];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      } else if(isDepIssue) {
        div.classList.add('dep-issue');
        // Use different shades of orange for dependency issues
        const depIssueColors = [
          { bg: 'linear-gradient(180deg,#4d3a1d,#3a2a16)', border: '#76624f' }, // Original orange
          { bg: 'linear-gradient(180deg,#5d4a1d,#4a3a16)', border: '#86724f' }, // Lighter orange
          { bg: 'linear-gradient(180deg,#3d2a1d,#2a1a16)', border: '#66524f' }, // Darker orange
          { bg: 'linear-gradient(180deg,#4d4a1d,#3a3a16)', border: '#76724f' }, // Yellow-orange
          { bg: 'linear-gradient(180deg,#4d2a1d,#3a1a16)', border: '#76524f' }, // Red-orange
        ];
        const color = depIssueColors[colorIdx % depIssueColors.length];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      } else if(isConflict) {
        div.classList.add('conflict');
        // Use different shades of red for conflicting overlaps
        const conflictColors = [
          { bg: 'linear-gradient(180deg,#4d1d1d,#3a1616)', border: '#6f3131' }, // Original red
          { bg: 'linear-gradient(180deg,#5d1d1d,#4a1616)', border: '#7f3131' }, // Lighter red
          { bg: 'linear-gradient(180deg,#3d1d1d,#2a1616)', border: '#5f3131' }, // Darker red
          { bg: 'linear-gradient(180deg,#4d2d1d,#3a2216)', border: '#6f4131' }, // Red-orange
          { bg: 'linear-gradient(180deg,#4d1d2d,#3a1622)', border: '#6f3141' }, // Red-purple
        ];
        const color = conflictColors[colorIdx % conflictColors.length];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      } else {
        // Use different colors for non-conflicting overlaps (different workers or same worker non-overlap)
        const color = jobColors[colorIdx];
        div.style.background = color.bg;
        div.style.borderColor = color.border;
      }
      
      if(jobTouchesShabbat(j)) div.classList.add('shabbat');
      div.style.left = left+'px';
      div.style.width = width+'px';
      
      const depInfo = j.dependsOn ? JOBS.find(dj=>dj.id===j.dependsOn) : null;
      const depText = depInfo ? ` → ${depInfo.title||'תל'}` : '';
      div.title = `${j.title||''} | ${fmt(j.start)} → ${fmt(j.end)} | ${j.factory}${depText}`;
      
      // Add resize handles and label
      div.innerHTML = `
        <div class="timeline-resize-handle timeline-resize-left" data-edge="start"></div>
        <span class="jobbar-label">${escapeHtml(j.title || '(ללא כותרת)')}</span>
        <div class="timeline-resize-handle timeline-resize-right" data-edge="end"></div>
      `;
      
      // Make draggable
      div.draggable = true;
      div.style.cursor = 'grab';
      div.dataset.jobId = j.id;
      div.dataset.worker = worker;
      
      let dragStartTime = 0;
      let dragMoved = false;
      
      div.addEventListener('mousedown', (e) => {
        // Don't start drag if clicking on resize handles
        if (e.target.classList.contains('timeline-resize-handle')) {
          e.stopPropagation();
          div.draggable = false;
          return;
        }
        dragStartTime = Date.now();
        dragMoved = false;
        div.draggable = true;
      });
      
      div.addEventListener('mousemove', (e) => {
        if (dragStartTime > 0) {
          dragMoved = true;
        }
      });
      
      div.addEventListener('click', (e) => {
        // Don't open modal if clicking on resize handles
        if (e.target.classList.contains('timeline-resize-handle')) {
          return;
        }
        const clickDuration = Date.now() - dragStartTime;
        // If it was a quick click (not a drag), open edit modal
        if (clickDuration < 300 && !dragMoved) {
          e.preventDefault();
          e.stopPropagation();
          openJobModal(j);
        }
      });
      
      div.addEventListener('dragstart', (e) => {
        // Prevent drag if clicking on resize handles
        if (e.target.classList.contains('timeline-resize-handle')) {
          e.preventDefault();
          return;
        }
        dragMoved = true; // Mark as drag
        div.style.cursor = 'grabbing';
        div.style.opacity = '0.5';
        const rect = div.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        dragState.isDragging = true;
        dragState.job = j;
        dragState.originalWorker = worker;
        dragState.currentWorker = worker;
        dragState.offsetX = e.clientX - rect.left;
        dragState.startLeft = rect.left - gridRect.left;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', div.innerHTML);
      });
      
      div.addEventListener('dragend', (e) => {
        div.style.cursor = 'grab';
        div.style.opacity = '1';
        dragState.isDragging = false;
        dragStartTime = 0;
        dragMoved = false;
      });
      
      // Add resize functionality
      const leftHandle = div.querySelector('.timeline-resize-left');
      const rightHandle = div.querySelector('.timeline-resize-right');
      
      if (leftHandle) {
        leftHandle.addEventListener('mousedown', (e) => startTimelineResize(e, div, j, 'start', grid));
      }
      
      if (rightHandle) {
        rightHandle.addEventListener('mousedown', (e) => startTimelineResize(e, div, j, 'end', grid));
      }
      
      grid.appendChild(div);
    });
    
    // Make grid a drop zone
    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.classList.add('drag-over');
    });
    
    grid.addEventListener('dragleave', (e) => {
      grid.classList.remove('drag-over');
    });
    
    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      grid.classList.remove('drag-over');
      
      if(!dragState.job) return;
      
      const gridRect = grid.getBoundingClientRect();
      const dropX = e.clientX - gridRect.left - dragState.offsetX;
      
      // Calculate new time based on drop position
      const newStartTime = posToTime(Math.max(0, dropX));
      const duration = dayjs(dragState.job.end).diff(dayjs(dragState.job.start), 'minute');
      const newEndTime = newStartTime.add(duration, 'minute');
      
      // Round to 15 minutes
      const roundedStart = roundTo15(newStartTime.format('YYYY-MM-DDTHH:mm'));
      const roundedEnd = roundTo15(newEndTime.format('YYYY-MM-DDTHH:mm'));
      
      // Update job in JOBS array
      const jobIndex = JOBS.findIndex(job => job.id === dragState.job.id);
      if(jobIndex >= 0) {
        JOBS[jobIndex].start = roundedStart;
        JOBS[jobIndex].end = roundedEnd;
        JOBS[jobIndex].worker = worker;
        refreshAll();
      }
      
      dragState.job = null;
    });

    host.appendChild(lane);
  }

  if(byWorker.size===0){ host.innerHTML=''; }
  
  // Setup scroll sync after a short delay to ensure timeline is rendered
  setTimeout(() => {
    setupTimelineScrollSync();
  }, 100);
}

// Timeline resize functionality
let timelineResizeState = {
  isResizing: false,
  jobId: null,
  edge: null,
  startX: 0,
  originalStart: null,
  originalEnd: null,
  grid: null,
  bar: null
};

function startTimelineResize(e, bar, job, edge, grid) {
  e.preventDefault();
  e.stopPropagation();
  
  // Ensure drag is disabled
  bar.draggable = false;
  
  timelineResizeState = {
    isResizing: true,
    jobId: job.id,
    edge: edge,
    startX: e.clientX,
    originalStart: dayjs(job.start),
    originalEnd: dayjs(job.end),
    grid: grid,
    bar: bar
  };
  
  bar.classList.add('resizing');
  document.body.style.cursor = 'ew-resize';
  
  // Add global mouse move and mouse up listeners
  document.addEventListener('mousemove', handleTimelineResize);
  document.addEventListener('mouseup', stopTimelineResize);
}

function handleTimelineResize(e) {
  if (!timelineResizeState.isResizing) return;
  
  const job = JOBS.find(j => j.id === timelineResizeState.jobId);
  if (!job) return;
  
  // Calculate pixel difference
  const dx = e.clientX - timelineResizeState.startX;
  
  // Convert pixels to minutes (88px per hour = 44px per 30min)
  const minutesPerPixel = 60 / 88; // 88px = 1 hour
  const minutesDiff = Math.round(dx * minutesPerPixel / 15) * 15; // Round to 15 minutes
  
  if (timelineResizeState.edge === 'start') {
    // Resize from the left (change start time)
    const newStart = timelineResizeState.originalStart.clone().add(minutesDiff, 'minutes');
    // Ensure start doesn't go past end (minimum 15 minutes duration)
    if (newStart.isBefore(timelineResizeState.originalEnd.clone().subtract(15, 'minutes'))) {
      job.start = newStart.format();
    }
  } else if (timelineResizeState.edge === 'end') {
    // Resize from the right (change end time)
    const newEnd = timelineResizeState.originalEnd.clone().add(minutesDiff, 'minutes');
    // Ensure end doesn't go before start (minimum 15 minutes duration)
    if (newEnd.isAfter(timelineResizeState.originalStart.clone().add(15, 'minutes'))) {
      job.end = newEnd.format();
    }
  }
  
  // Update the display
  renderTimeline();
}

function stopTimelineResize(e) {
  if (!timelineResizeState.isResizing) return;
  
  // Use the stored bar reference
  if (timelineResizeState.bar) {
    timelineResizeState.bar.classList.remove('resizing');
    // Re-enable drag after a short delay to prevent immediate drag
    setTimeout(() => {
      if (timelineResizeState.bar) {
        timelineResizeState.bar.draggable = true;
      }
    }, 100);
  }
  
  document.body.style.cursor = '';
  
  // Remove global listeners
  document.removeEventListener('mousemove', handleTimelineResize);
  document.removeEventListener('mouseup', stopTimelineResize);
  
  // Save changes and refresh all views
  if (timelineResizeState.isResizing) {
    refreshAll();
  }
  
  timelineResizeState = {
    isResizing: false,
    jobId: null,
    edge: null,
    startX: 0,
    originalStart: null,
    originalEnd: null,
    grid: null,
    bar: null
  };
}

function saveToLocalStorage(){
  const data = {
    jobs: JOBS,
    factories: Array.from(FACTORIES),
    workers: Array.from(WORKERS),
    factoryManagers: Array.from(FACTORY_MANAGERS),
    maintenanceManagers: Array.from(MAINTENANCE_MANAGERS),
    departments: Array.from(DEPARTMENTS)
  };
  localStorage.setItem('jobs.v1', JSON.stringify(data));
}

function refreshAll(){
  refreshFilters();
  renderTable();
  renderTimeline();
  updateColumnVisibility();
  // Update Gantt chart if it exists
  if (typeof updateGantt === 'function') {
    updateGantt();
  }
  saveToLocalStorage(); // Auto-save on every change
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// Helper functions for multi-select worker component
function getSelectedWorkers() {
  const options = $('#f-worker-options');
  if (!options) return [];
  const checkboxes = $$('#f-worker-options input[type="checkbox"]:checked');
  return checkboxes.map(cb => cb.value);
}

function updateWorkerDisplay() {
  const selected = getSelectedWorkers();
  const display = $('#f-worker-selected');
  if (!display) return;
  
  if (selected.length === 0) {
    display.innerHTML = '<span class="placeholder">בחר עובדים מבצעים...</span>';
  } else {
    display.innerHTML = selected.map(worker => 
      `<span class="worker-tag">${escapeHtml(worker)} <span class="remove" data-worker="${escapeHtml(worker)}">×</span></span>`
    ).join('');
  }
  
  // Add click handlers for remove buttons
  $$('#f-worker-selected .remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const worker = btn.dataset.worker;
      // Find checkbox by value instead of ID (safer with special characters)
      const checkboxes = $$('#f-worker-options input[type="checkbox"]');
      const checkbox = checkboxes.find(cb => cb.value === worker);
      if (checkbox) {
        checkbox.checked = false;
        updateWorkerDisplay();
      }
    });
  });
}

function toggleWorkerDropdown() {
  const dropdown = $('#f-worker-dropdown');
  const isVisible = dropdown.style.display !== 'none';
  dropdown.style.display = isVisible ? 'none' : 'block';
}

function closeWorkerDropdown() {
  $('#f-worker-dropdown').style.display = 'none';
}

// Add / Edit / Delete
function getForm(){
  const title = $('#f-title').value.trim();
  const factory = $('#f-factory').value;
  // Get selected workers from checkboxes
  const workers = getSelectedWorkers();
  const factoryManager = $('#f-factoryManager').value;
  const maintenanceManager = $('#f-maintenanceManager').value;
  const priority = $('#f-priority').value;
  const equipmentNumber = $('#f-equipmentNumber').value.trim();
  const serviceCall = $('#f-serviceCall').value.trim();
  const department = $('#f-department').value;
  const start = roundTo15($('#f-start').value);
  const end = roundTo15($('#f-end').value);
  const dependsOn = $('#f-dependsOn').value;
  const notes = $('#f-notes').value.trim();
  return { title, factory, workers, factoryManager, maintenanceManager, priority, equipmentNumber, serviceCall, department, start, end, dependsOn, notes };
}

function setForm(j){
  $('#f-title').value = j?.title||'';
  $('#f-factory').value = j?.factory||'';
  
  // Set selected workers in checkboxes
  const workers = j?.workers ? (Array.isArray(j.workers) ? j.workers : [j.workers]) : (j?.worker ? [j.worker] : []);
  // First uncheck all
  $$('#f-worker-options input[type="checkbox"]').forEach(cb => cb.checked = false);
  // Then check the selected ones
  workers.forEach(worker => {
    const checkbox = $(`#f-worker-options input[value="${worker}"]`);
    if (checkbox) checkbox.checked = true;
  });
  updateWorkerDisplay();
  
  $('#f-factoryManager').value = j?.factoryManager||'';
  $('#f-maintenanceManager').value = j?.maintenanceManager||'';
  $('#f-priority').value = j?.priority||'';
  $('#f-equipmentNumber').value = j?.equipmentNumber||'';
  $('#f-serviceCall').value = j?.serviceCall||'';
  $('#f-department').value = j?.department||'';
  $('#f-start').value = j?.start ? dayjs(j.start).format('YYYY-MM-DDTHH:mm') : '';
  $('#f-end').value = j?.end ? dayjs(j.end).format('YYYY-MM-DDTHH:mm') : '';
  $('#f-dependsOn').value = j?.dependsOn||'';
  $('#f-notes').value = j?.notes||'';
}

function validateRange(start, end){
  if(!start || !end) return {ok:false, msg:'התחלה וסיום הם שדות חובה'};
  if(dayjs(end).isSameOrBefore(dayjs(start))) return {ok:false, msg:'הסיום חייב להיות אחרי ההתחלה'};
  return {ok:true};
}

let editingId = null;

function openJobModal(job = null) {
  const modal = $('#jobModal');
  const modalTitle = $('#modalTitle');
  const deleteBtn = $('#btnDeleteModal');
  
  // Make sure dropdowns are populated
  updateFormDropdowns();
  
  if (job) {
    modalTitle.textContent = 'ערוך משימה';
    editingId = job.id;
    setForm(job);
    deleteBtn.style.display = 'block'; // Show delete button when editing
  } else {
    modalTitle.textContent = 'צור משימה';
    editingId = null;
    setForm({});
    deleteBtn.style.display = 'none'; // Hide delete button when creating
  }
  
  modal.showModal();
}

function closeJobModal() {
  const modal = $('#jobModal');
  modal.close();
  setForm({});
  editingId = null;
}

function setupTableScrollSync() {
  const topScroll = document.querySelector('.table-scroll-top');
  const bottomScroll = document.querySelector('.table-container');
  const topInner = document.querySelector('.table-scroll-top-inner');
  const table = document.querySelector('#main-table');
  
  if (!topScroll || !bottomScroll || !topInner || !table) return;
  
  // Set the width of the inner div to match the table width
  const syncWidth = () => {
    topInner.style.width = table.scrollWidth + 'px';
  };
  
  syncWidth();
  
  // Sync scroll positions
  let isScrolling = false;
  
  topScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      bottomScroll.scrollLeft = topScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  bottomScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      topScroll.scrollLeft = bottomScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  // Update width on window resize
  window.addEventListener('resize', syncWidth);
}

function setupTimelineScrollSync() {
  const topScroll = document.querySelector('.timeline-scroll-top');
  const bottomScroll = document.querySelector('.timeline');
  const topInner = document.querySelector('.timeline-scroll-top-inner');
  
  if (!topScroll || !bottomScroll || !topInner) return;
  
  // Set the width of the inner div to match the timeline width
  const syncWidth = () => {
    topInner.style.width = bottomScroll.scrollWidth + 'px';
  };
  
  syncWidth();
  
  // Sync scroll positions
  let isScrolling = false;
  
  topScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      bottomScroll.scrollLeft = topScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  bottomScroll.addEventListener('scroll', () => {
    if (!isScrolling) {
      isScrolling = true;
      topScroll.scrollLeft = bottomScroll.scrollLeft;
      setTimeout(() => { isScrolling = false; }, 10);
    }
  });
  
  // Update width on window resize
  window.addEventListener('resize', syncWidth);
}

function initEventListeners(){
  // Open modal to create job
  $('#btnOpenJobModal').addEventListener('click', () => {
    openJobModal();
  });

  // Close modal
  $('#btnCloseModal').addEventListener('click', () => {
    closeJobModal();
  });

  // Save job from modal
  $('#btnSaveJob').addEventListener('click', ()=>{
    const data = getForm();
    const vr = validateRange(data.start, data.end);
    if(!vr.ok){ alert(vr.msg); return; }
    if(editingId){
      const i = JOBS.findIndex(x=>x.id===editingId);
      if(i>=0) JOBS[i] = { ...JOBS[i], ...data };
      editingId = null;
    } else {
      JOBS.push({ id: uid(), ...data });
    }
    closeJobModal();
    refreshAll();
  });

  // Reset form in modal
  $('#btnResetModal').addEventListener('click', ()=>{ 
    setForm({});
    updateWorkerDisplay();
  });

  // Delete job from modal
  $('#btnDeleteModal').addEventListener('click', ()=>{
    if(editingId && confirm('למחוק משימה זו?')){
      JOBS = JOBS.filter(j => j.id !== editingId);
      closeJobModal();
      refreshAll();
    }
  });

  // Sort by column header click
  $$('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if(sortState.column === column) {
        sortState.ascending = !sortState.ascending;
      } else {
        sortState.column = column;
        sortState.ascending = true;
      }
      renderTable();
      updateColumnVisibility();
    });
  });

  // Toggle filter top panel
  $('#btnToggleTopFilters').addEventListener('click', () => {
    $('#filterTopPanel').classList.toggle('collapsed');
  });
  
  // Also allow clicking the header to toggle
  $('#filterTopPanel .filter-top-header').addEventListener('click', () => {
    $('#filterTopPanel').classList.toggle('collapsed');
  });

  // Toggle column controls visibility
  $('#btnToggleColumnControls').addEventListener('click', () => {
    const columnControls = $('#columnControls');
    const toggleBtn = $('#btnToggleColumnControls');
    
    if (columnControls.style.display === 'none') {
      columnControls.style.display = 'block';
      toggleBtn.title = 'הסתר בקרות עמודות';
    } else {
      columnControls.style.display = 'none';
      toggleBtn.title = 'הצג בקרות עמודות';
    }
  });

  $('#tbody').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const job = JOBS.find(j=>j.id===id);
    if(!job) return;
    if(act==='finish'){
      job.finished = !job.finished;
      refreshAll();
    } else if(act==='edit'){
      openJobModal(job);
    } else if(act==='del'){
      if(confirm('למחוק משימה זו?')){ JOBS = JOBS.filter(j=>j.id!==id); refreshAll(); }
    }
  });

  // Filters
  ['fltFactory','fltWorker','fltFactoryManager','fltMaintenanceManager','fltFrom','fltTo','fltSearch','fltPriority','fltEquipmentNumber','fltServiceCall','fltDepartment','fltStatus','fltConflictsOnly','fltDependencyIssuesOnly','fltShowBoth'].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>{ renderTable(); renderTimeline(); updateColumnVisibility(); });
  });

  $('#btnClearFilters').addEventListener('click', ()=>{
    $('#fltFactory').value=''; 
    $('#fltWorker').value=''; 
    $('#fltFactoryManager').value=''; 
    $('#fltMaintenanceManager').value=''; 
    $('#fltFrom').value=''; 
    $('#fltTo').value=''; 
    $('#fltSearch').value=''; 
    $('#fltPriority').value='';
    $('#fltEquipmentNumber').value='';
    $('#fltServiceCall').value='';
    $('#fltDepartment').value='';
    $('#fltStatus').value='';
    $('#fltConflictsOnly').checked=false; 
    $('#fltDependencyIssuesOnly').checked=false;
    $('#fltShowBoth').checked=false;
    renderTable(); 
    renderTimeline();
    updateColumnVisibility();
  });

  // Tabs
  $$('.tab').forEach(tab=> tab.addEventListener('click', ()=>{
    $$('.tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active');
    const name = tab.getAttribute('data-tab');
    $('#view-table').style.display = name==='table'? 'block':'none';
    $('#view-timeline').style.display = name==='timeline'? 'block':'none';
    $('#view-gantt').style.display = name==='gantt'? 'block':'none';
    if(name==='timeline') renderTimeline();
    if(name==='gantt') {
      // Initialize Gantt if not already done
      if (typeof initGantt === 'function') {
        initGantt();
      }
    }
  }));

  // Timeline date default = today
  const todayStr = dayjs().format('YYYY-MM-DD'); $('#tl-date').value = todayStr;
  $('#tl-date').addEventListener('input', renderTimeline);

  // Import/Export
  $('#btnImport').addEventListener('click', ()=> $('#fileInput').click());
  $('#fileInput').addEventListener('change', handleFile, false);
  $('#btnExport').addEventListener('click', exportExcel);

  // Auto-fill end time when start time is set
  $('#f-start').addEventListener('change', ()=>{
    const startVal = $('#f-start').value;
    const endVal = $('#f-end').value;
    if(startVal && !endVal) {
      // Set end time to 1 hour after start time
      const startTime = dayjs(startVal);
      const endTime = startTime.add(1, 'hour');
      $('#f-end').value = endTime.format('YYYY-MM-DDTHH:mm');
    }
  });

  // Handle "Add new factory" option
  $('#f-factory').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newFactory = prompt('הזן שם מפעל חדש:');
      if(newFactory && newFactory.trim()) {
        FACTORIES.add(newFactory.trim());
        updateFormDropdowns();
        $('#f-factory').value = newFactory.trim();
      } else {
        $('#f-factory').value = '';
      }
    }
  });

  // Handle multi-select worker component
  $('#f-worker-selected').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWorkerDropdown();
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const container = $('#f-worker-container');
    if (container && !container.contains(e.target)) {
      closeWorkerDropdown();
    }
  });
  
  // Handle checkbox changes
  document.addEventListener('change', (e) => {
    if (e.target.matches('#f-worker-options input[type="checkbox"]')) {
      updateWorkerDisplay();
    }
  });
  
  // Handle "Add new worker" button
  $('#btn-add-worker').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const newWorker = prompt('הזן שם עובד מבצע חדש:');
    if(newWorker && newWorker.trim()) {
      WORKERS.add(newWorker.trim());
      updateFormDropdowns();
      // Auto-select the new worker
      const checkbox = $(`#f-worker-options input[value="${newWorker.trim()}"]`);
      if (checkbox) {
        checkbox.checked = true;
        updateWorkerDisplay();
      }
    }
  });

  // Handle "Add new factory manager" option
  $('#f-factoryManager').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newFactoryManager = prompt('הזן שם מפקח עבודה חדש:');
      if(newFactoryManager && newFactoryManager.trim()) {
        FACTORY_MANAGERS.add(newFactoryManager.trim());
        updateFormDropdowns();
        $('#f-factoryManager').value = newFactoryManager.trim();
      } else {
        $('#f-factoryManager').value = '';
      }
    }
  });

  // Handle "Add new maintenance manager" option
  $('#f-maintenanceManager').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newMaintenanceManager = prompt('הזן שם מנהל עבודה חדש:');
      if(newMaintenanceManager && newMaintenanceManager.trim()) {
        MAINTENANCE_MANAGERS.add(newMaintenanceManager.trim());
        updateFormDropdowns();
        $('#f-maintenanceManager').value = newMaintenanceManager.trim();
      } else {
        $('#f-maintenanceManager').value = '';
      }
    }
  });

  // Handle "Add new department" option
  $('#f-department').addEventListener('change', (e)=>{
    if(e.target.value === '__add_new__') {
      const newDepartment = prompt('הזן שם מחלקה חדשה:');
      if(newDepartment && newDepartment.trim()) {
        DEPARTMENTS.add(newDepartment.trim());
        updateFormDropdowns();
        $('#f-department').value = newDepartment.trim();
      } else {
        $('#f-department').value = '';
      }
    }
  });

  // Handle column visibility controls
  $$('.column-controls input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const column = e.target.dataset.column;
      COLUMN_VISIBILITY[column] = e.target.checked;
      updateColumnVisibility();
      saveColumnVisibility();
    });
  });

  // Handle theme toggle
  $('#themeToggle').addEventListener('click', toggleTheme);
}

async function handleFile(evt){
  const file = evt.target.files[0]; if(!file) return;
  
  if(typeof XLSX === 'undefined') {
    alert('ספריית ייבוא Excel לא נטענה. אנא רענן את הדף ונסה שוב.');
    evt.target.value = '';
    return;
  }
  
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:'array' });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const json = XLSX.utils.sheet_to_json(ws, { defval:'' });
  if(!json.length){ alert('הגיליון ריק'); return; }

  // Column mapping UI (basic prompt-based to keep single-file)
  const headers = Object.keys(json[0]);
  const ask = (label, fallback)=>{
    const choice = prompt(`שם עמודה עבור ${label}?\nזמינות: ${headers.join(', ')}`, fallback);
    return choice && headers.includes(choice) ? choice : fallback;
  };
  
  // Map all available fields with improved pattern matching
  const colTitle = ask('משימה', headers.find(h=>/title|job|task|משימה|name|שם/i.test(h))||headers[0]);
  const colFactory = ask('מפעל', headers.find(h=>/factory|מפעל|plant|facility/i.test(h))||'');
  const colWorker = ask('עובד מבצע', headers.find(h=>/worker|עובד|employee|staff|מבצע|executor/i.test(h))||'');
  const colFactoryManager = ask('מפקח עבודה', headers.find(h=>/factory.*manager|מפקח|supervisor|supervise|מנהל.*מפעל/i.test(h))||'');
  const colMaintenanceManager = ask('מנהל עבודה', headers.find(h=>/maintenance.*manager|מנהל.*עבודה|maintenance|אחזקה/i.test(h))||'');
  const colPriority = ask('עדיפות', headers.find(h=>/priority|עדיפות|urgent|importance/i.test(h))||'');
  const colEquipmentNumber = ask('מספר ציוד', headers.find(h=>/equipment|ציוד|number|מספר|machine|device|מכונה/i.test(h))||'');
  const colServiceCall = ask('קריאת שירות', headers.find(h=>/service.*call|קריאת.*שירות|service|ticket|call|שירות/i.test(h))||'');
  const colDepartment = ask('מחלקה מבצעת', headers.find(h=>/department|מחלקה|dept|unit|יחידה/i.test(h))||'');
  const colStart = ask('התחלה', headers.find(h=>/start|begin|התחלה|from|start.*time|start.*date/i.test(h))||'');
  const colEnd = ask('סיום', headers.find(h=>/end|finish|סיום|to|end.*time|end.*date|due/i.test(h))||'');
  const colDependsOn = ask('תלוי ב', headers.find(h=>/depend|תלוי|dependency|prerequisite|קודם/i.test(h))||'');
  const colNotes = ask('הערות', headers.find(h=>/note|remark|remarks|הערה|comment|comments|הערות|תיאור|description|desc|details|פרטים/i.test(h))||'');

  // Import all mapped fields
  const imported = json.map(row=>{
    const factory = String(row[colFactory]||'').trim();
    // Handle multiple workers - split by comma or semicolon
    const workerStr = String(row[colWorker]||'').trim();
    const workers = workerStr ? workerStr.split(/[,;]/).map(w => w.trim()).filter(Boolean) : [];
    const factoryManager = String(row[colFactoryManager]||'').trim();
    const maintenanceManager = String(row[colMaintenanceManager]||'').trim();
    const department = String(row[colDepartment]||'').trim();
    
    // Add to sets
    if(factory) FACTORIES.add(factory);
    workers.forEach(w => { if(w) WORKERS.add(w); });
    if(factoryManager) FACTORY_MANAGERS.add(factoryManager);
    if(maintenanceManager) MAINTENANCE_MANAGERS.add(maintenanceManager);
    if(department) DEPARTMENTS.add(department);
    
    // Parse dates if available
    let startDate = '';
    let endDate = '';
    if(colStart && row[colStart]) {
      const start = dayjs(row[colStart]);
      startDate = start.isValid() ? start.format() : '';
    }
    if(colEnd && row[colEnd]) {
      const end = dayjs(row[colEnd]);
      endDate = end.isValid() ? end.format() : '';
    }
    
    return {
      id: uid(),
      title: String(row[colTitle]||'').trim(),
      factory: factory,
      workers: workers,
      factoryManager: factoryManager,
      maintenanceManager: maintenanceManager,
      priority: String(row[colPriority]||'').trim(),
      equipmentNumber: String(row[colEquipmentNumber]||'').trim(),
      serviceCall: String(row[colServiceCall]||'').trim(),
      department: department,
      start: startDate,
      end: endDate,
      dependsOn: String(row[colDependsOn]||'').trim(),
      notes: String(row[colNotes]||'').trim(),
      finished: false
    };
  });
  // Clear existing data before importing new data
  JOBS = [];
  FACTORIES.clear();
  WORKERS.clear();
  FACTORY_MANAGERS.clear();
  MAINTENANCE_MANAGERS.clear();
  DEPARTMENTS.clear();
  nextId = 1;
  
  // Import new data
  JOBS = imported;
  refreshAll();
  alert(`יובאו ${imported.length} שורות מ-"${wsName}". כעת הגדר התחלה/סיום לכל משימה.`);
  evt.target.value = '';
}

function exportExcel(){
  if(typeof XLSX === 'undefined') {
    alert('ספריית ייצוא Excel לא נטענה. אנא רענן את הדף ונסה שוב.');
    return;
  }
  
  const rows = JOBS.map(j=>{
    const depInfo = j.dependsOn ? JOBS.find(dj=>dj.id===j.dependsOn) : null;
    const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
    const workersStr = workers.join(', ');
    return {
      'משימה': j.title, 
      'מפעל': j.factory, 
      'עובד מבצע': workersStr,
      'מפקח עבודה': j.factoryManager,
      'מנהל עבודה': j.maintenanceManager,
      'עדיפות': j.priority,
      'מספר ציוד': j.equipmentNumber,
      'קריאת שירות': j.serviceCall,
      'מחלקה מבצעת': j.department,
      'התחלה': fmt(j.start), 
      'סיום': fmt(j.end), 
      'משך': durationStr(j.start, j.end),
      'תלוי ב': depInfo ? depInfo.title : '',
      'הערות': j.notes
    };
  });
  
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'משימות');
  XLSX.writeFile(wb, 'factory-jobs.xlsx');
}

// Initialize empty data
function seed(){
  // Add some sample data for testing
  const now = dayjs();
  JOBS = [
    {
      id: '1',
      title: 'תחזוקת קו A',
      factory: 'מפעל צפון',
      workers: ['יוסי כהן'],
      factoryManager: 'דוד לוי',
      maintenanceManager: 'שרה גולד',
      priority: 'גבוהה',
      equipmentNumber: 'EQ-001',
      serviceCall: 'SC-2024-001',
      department: 'אחזקה',
      start: now.hour(8).minute(0).format(),
      end: now.hour(12).minute(0).format(),
      dependsOn: '',
      notes: 'תחזוקה תקופתית',
      finished: false
    },
    {
      id: '2',
      title: 'החלפת חלק בקו B',
      factory: 'מפעל דרום',
      workers: ['מיכל אברהם', 'יוסי כהן'],
      factoryManager: 'רונן שטרן',
      maintenanceManager: 'שרה גולד',
      priority: 'דחופה',
      equipmentNumber: 'EQ-002',
      serviceCall: 'SC-2024-002',
      department: 'אחזקה',
      start: now.hour(10).minute(0).format(),
      end: now.hour(14).minute(0).format(),
      dependsOn: '1',
      notes: 'החלפת מנוע - דורש שני עובדים',
      finished: false
    },
    {
      id: '3',
      title: 'בדיקת בטיחות',
      factory: 'מפעל צפון',
      workers: ['יוסי כהן'],
      factoryManager: 'דוד לוי',
      maintenanceManager: 'שרה גולד',
      priority: 'בינונית',
      equipmentNumber: 'EQ-003',
      serviceCall: 'SC-2024-003',
      department: 'בטיחות',
      start: now.add(1, 'day').hour(9).minute(0).format(),
      end: now.add(1, 'day').hour(11).minute(0).format(),
      dependsOn: '',
      notes: 'בדיקה חודשית',
      finished: true
    },
    {
      id: '4',
      title: 'תחזוקת קו C',
      factory: 'מפעל דרום',
      workers: ['מיכל אברהם', 'דני לוי'],
      factoryManager: 'רונן שטרן',
      maintenanceManager: 'שרה גולד',
      priority: 'נמוכה',
      equipmentNumber: 'EQ-004',
      serviceCall: 'SC-2024-004',
      department: 'אחזקה',
      start: now.add(2, 'day').hour(14).minute(0).format(),
      end: now.add(2, 'day').hour(18).minute(0).format(),
      dependsOn: '',
      notes: 'תחזוקה שבועית - דורש צוות',
      finished: false
    }
  ];
  
  // Update sets
  JOBS.forEach(job => {
    if (job.factory) FACTORIES.add(job.factory);
    const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
    workers.forEach(w => { if(w) WORKERS.add(w); });
    if (job.factoryManager) FACTORY_MANAGERS.add(job.factoryManager);
    if (job.maintenanceManager) MAINTENANCE_MANAGERS.add(job.maintenanceManager);
    if (job.department) DEPARTMENTS.add(job.department);
  });
  
  nextId = 5;
}

function loadFromLocalStorage(){
  const raw = localStorage.getItem('jobs.v1');
  if(!raw) return false; // No saved data
  
  const data = JSON.parse(raw);
  // Handle both old format (just array) and new format (object with jobs, factories, workers)
  if(Array.isArray(data)) {
    JOBS = data;
    // Rebuild factories, workers, managers, and departments from jobs
    FACTORIES.clear();
    WORKERS.clear();
    FACTORY_MANAGERS.clear();
    MAINTENANCE_MANAGERS.clear();
    DEPARTMENTS.clear();
    JOBS.forEach(j=>{
      // Migrate old worker string format to new workers array format
      if(j.worker && !j.workers) {
        j.workers = [j.worker];
        delete j.worker;
      }
      if(j.factory) FACTORIES.add(j.factory);
      const workers = Array.isArray(j.workers) ? j.workers : [];
      workers.forEach(w => { if(w) WORKERS.add(w); });
      if(j.factoryManager) FACTORY_MANAGERS.add(j.factoryManager);
      if(j.maintenanceManager) MAINTENANCE_MANAGERS.add(j.maintenanceManager);
      if(j.department) DEPARTMENTS.add(j.department);
    });
  } else {
    JOBS = data.jobs || [];
    // Migrate old worker string format to new workers array format
    JOBS.forEach(j=>{
      if(j.worker && !j.workers) {
        j.workers = [j.worker];
        delete j.worker;
      }
    });
    FACTORIES = new Set(data.factories || []);
    WORKERS = new Set(data.workers || []);
    FACTORY_MANAGERS = new Set(data.factoryManagers || []);
    MAINTENANCE_MANAGERS = new Set(data.maintenanceManagers || []);
    DEPARTMENTS = new Set(data.departments || []);
  }
  nextId = 1 + Math.max(0, ...JOBS.map(j=>+j.id||0));
  return true;
}

// Theme management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeIcon = $('#themeIcon');
  if(themeIcon) {
    themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
  }
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

// Auto-load db.xlsx if it exists
async function autoLoadDatabase() {
  try {
    const response = await fetch('db.xlsx');
    if (!response.ok) {
      return false;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (!json.length) {
      console.log('db.xlsx is empty');
      return false;
    }
    
    // Column mapping - auto-detect common patterns
    const headers = Object.keys(json[0]);
    const findCol = (patterns) => headers.find(h => patterns.some(p => p.test(h))) || '';
    
    const colTitle = findCol([/title|job|task|משימה|name|שם/i]);
    const colFactory = findCol([/factory|מפעל|plant|facility/i]);
    const colWorker = findCol([/worker|עובד|employee|staff|מבצע|executor/i]);
    const colFactoryManager = findCol([/factory.*manager|מפקח|supervisor|supervise|מנהל.*מפעל/i]);
    const colMaintenanceManager = findCol([/maintenance.*manager|מנהל.*עבודה|maintenance|אחזקה/i]);
    const colPriority = findCol([/priority|עדיפות|urgent|importance/i]);
    const colEquipmentNumber = findCol([/equipment|ציוד|number|מספר|machine|device|מכונה/i]);
    const colServiceCall = findCol([/service.*call|קריאת.*שירות|service|ticket|call|שירות/i]);
    const colDepartment = findCol([/department|מחלקה|dept|unit|יחידה/i]);
    const colStart = findCol([/start|begin|התחלה|from|start.*time|start.*date/i]);
    const colEnd = findCol([/end|finish|סיום|to|end.*time|end.*date|due/i]);
    const colDependsOn = findCol([/depend|תלוי|dependency|prerequisite|קודם/i]);
    const colNotes = findCol([/note|remark|remarks|הערה|comment|comments|הערות|תיאור|description|desc|details|פרטים/i]);
    
    // Clear existing data before importing
    JOBS = [];
    FACTORIES.clear();
    WORKERS.clear();
    FACTORY_MANAGERS.clear();
    MAINTENANCE_MANAGERS.clear();
    DEPARTMENTS.clear();
    nextId = 1;
    
    // Import data
    const imported = json.map(row => {
      const factory = String(row[colFactory] || '').trim();
      const workerStr = String(row[colWorker] || '').trim();
      const workers = workerStr ? workerStr.split(/[,;]/).map(w => w.trim()).filter(Boolean) : [];
      const factoryManager = String(row[colFactoryManager] || '').trim();
      const maintenanceManager = String(row[colMaintenanceManager] || '').trim();
      const department = String(row[colDepartment] || '').trim();
      
      // Add to sets
      if (factory) FACTORIES.add(factory);
      workers.forEach(w => { if (w) WORKERS.add(w); });
      if (factoryManager) FACTORY_MANAGERS.add(factoryManager);
      if (maintenanceManager) MAINTENANCE_MANAGERS.add(maintenanceManager);
      if (department) DEPARTMENTS.add(department);
      
      // Parse dates
      let startDate = '';
      let endDate = '';
      if (colStart && row[colStart]) {
        const start = dayjs(row[colStart]);
        startDate = start.isValid() ? start.format() : '';
      }
      if (colEnd && row[colEnd]) {
        const end = dayjs(row[colEnd]);
        endDate = end.isValid() ? end.format() : '';
      }
      
      return {
        id: uid(),
        title: String(row[colTitle] || '').trim(),
        factory: factory,
        workers: workers,
        factoryManager: factoryManager,
        maintenanceManager: maintenanceManager,
        priority: String(row[colPriority] || '').trim(),
        equipmentNumber: String(row[colEquipmentNumber] || '').trim(),
        serviceCall: String(row[colServiceCall] || '').trim(),
        department: department,
        start: startDate,
        end: endDate,
        dependsOn: String(row[colDependsOn] || '').trim(),
        notes: String(row[colNotes] || '').trim(),
        finished: false
      };
    });
    
    JOBS = imported;
    console.log(`Loaded ${imported.length} jobs from db.xlsx`);
    return true;
  } catch (error) {
    console.log('db.xlsx not found or error loading:', error.message);
    return false;
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async ()=>{
  // Initialize theme
  initTheme();
  
  // Load column visibility settings
  loadColumnVisibility();
  
  // Try to load from db.xlsx first, then localStorage, then seed with demo data
  const dbLoaded = await autoLoadDatabase();
  if (!dbLoaded) {
    const localStorageLoaded = loadFromLocalStorage();
    if (!localStorageLoaded) {
      seed();
    }
  }
  
  initEventListeners();
  refreshAll();
});

