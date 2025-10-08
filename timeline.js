// Timeline View - Gantt Chart Implementation
// Separate JS file for timeline functionality

let timelineState = {
  startDate: null,
  endDate: null,
  timeScale: 'hours', // 'hours' or 'days'
  zoomLevel: 1,
  scrollPosition: 0
};

// Timeline configuration
const TIMELINE_CONFIG = {
  hourWidth: 20, // pixels per hour
  dayHeight: 30, // height of day header
  taskHeight: 25, // height of each task row
  headerHeight: 60, // height of time header
  leftPanelWidth: 300, // width of task names panel
  minZoom: 0.5,
  maxZoom: 3,
  defaultZoom: 1
};

// Initialize timeline view
function initTimeline() {
  createTimelineHTML();
  setupTimelineEventListeners();
  updateTimelineDateRange();
  renderTimeline();
}

// Initialize Gantt chart view
function initGantt() {
  console.log('Initializing Gantt chart...');
  createGanttHTML();
  setupGanttEventListeners();
  updateGanttDateRange();
  renderGantt();
  console.log('Gantt chart initialized');
}

// Create Gantt chart HTML structure
function createGanttHTML() {
  const ganttTab = document.getElementById('gantt-tab');
  if (!ganttTab) return;

  ganttTab.innerHTML = `
    <div class="gantt-container">
      <!-- Gantt Controls -->
      <div class="gantt-controls">
        <div class="date-range-controls">
          <label>מתאריך:</label>
          <input type="date" id="gantt-start-date" />
          <label>עד תאריך:</label>
          <input type="date" id="gantt-end-date" />
          <button id="gantt-apply-dates" class="btn primary">החל</button>
        </div>
        <div class="gantt-zoom-controls">
          <button id="gantt-zoom-out" class="btn">-</button>
          <button id="gantt-zoom-in" class="btn">+</button>
        </div>
      </div>

      <!-- Gantt Chart -->
      <div class="gantt-chart" id="gantt-chart">
        <!-- Tasks will be rendered here -->
      </div>
    </div>
  `;
}

// Create timeline HTML structure
function createTimelineHTML() {
  const timelineTab = document.getElementById('timeline-tab');
  if (!timelineTab) return;

  timelineTab.innerHTML = `
    <div class="timeline-container">
      <!-- Timeline Controls -->
      <div class="timeline-controls">
        <div class="date-range-controls">
          <label>מתאריך:</label>
          <input type="date" id="timeline-start-date" />
          <label>עד תאריך:</label>
          <input type="date" id="timeline-end-date" />
          <button id="timeline-apply-dates" class="btn primary">החל</button>
        </div>
        <div class="timeline-zoom-controls">
          <button id="timeline-zoom-out" class="btn">-</button>
          <span id="timeline-zoom-level">100%</span>
          <button id="timeline-zoom-in" class="btn">+</button>
        </div>
        <div class="timeline-scale-controls">
          <label class="switch">
            <input type="checkbox" id="timeline-show-hours" checked />
            הצג שעות
          </label>
        </div>
      </div>

      <!-- Timeline Header -->
      <div class="timeline-header">
        <div class="timeline-left-panel">
          <div class="timeline-task-header">משימה</div>
        </div>
        <div class="timeline-right-panel">
          <div class="timeline-time-header" id="timeline-time-header"></div>
        </div>
      </div>

      <!-- Timeline Content -->
      <div class="timeline-content">
        <div class="timeline-left-panel" id="timeline-task-names"></div>
        <div class="timeline-right-panel">
          <div class="timeline-grid" id="timeline-grid"></div>
        </div>
      </div>
    </div>
  `;
}

// Setup Gantt event listeners
function setupGanttEventListeners() {
  // Date range controls
  document.getElementById('gantt-apply-dates')?.addEventListener('click', updateGanttDateRange);
  
  // Zoom controls
  document.getElementById('gantt-zoom-in')?.addEventListener('click', () => zoomGantt(1.2));
  document.getElementById('gantt-zoom-out')?.addEventListener('click', () => zoomGantt(0.8));
}

// Setup timeline event listeners
function setupTimelineEventListeners() {
  // Date range controls
  document.getElementById('timeline-apply-dates')?.addEventListener('click', updateTimelineDateRange);
  
  // Zoom controls
  document.getElementById('timeline-zoom-in')?.addEventListener('click', () => zoomTimeline(1.2));
  document.getElementById('timeline-zoom-out')?.addEventListener('click', () => zoomTimeline(0.8));
  
  // Scale controls
  document.getElementById('timeline-show-hours')?.addEventListener('change', (e) => {
    timelineState.timeScale = e.target.checked ? 'hours' : 'days';
    renderTimeline();
  });
}

// Update timeline date range
function updateTimelineDateRange() {
  const startDateInput = document.getElementById('timeline-start-date');
  const endDateInput = document.getElementById('timeline-end-date');
  
  if (startDateInput?.value) {
    timelineState.startDate = dayjs(startDateInput.value);
  } else {
    timelineState.startDate = dayjs().startOf('day');
  }
  
  if (endDateInput?.value) {
    timelineState.endDate = dayjs(endDateInput.value).endOf('day');
  } else {
    timelineState.endDate = timelineState.startDate.clone().add(7, 'days');
  }
  
  // Set default values if not set
  if (!startDateInput?.value) {
    startDateInput.value = timelineState.startDate.format('YYYY-MM-DD');
  }
  if (!endDateInput?.value) {
    endDateInput.value = timelineState.endDate.format('YYYY-MM-DD');
  }
  
  renderTimeline();
}

// Zoom timeline
function zoomTimeline(factor) {
  timelineState.zoomLevel = Math.max(
    TIMELINE_CONFIG.minZoom,
    Math.min(TIMELINE_CONFIG.maxZoom, timelineState.zoomLevel * factor)
  );
  
  document.getElementById('timeline-zoom-level').textContent = 
    Math.round(timelineState.zoomLevel * 100) + '%';
  
  renderTimeline();
}

// Render timeline
function renderTimeline() {
  if (!timelineState.startDate || !timelineState.endDate) {
    updateTimelineDateRange();
  }
  
  renderTimelineHeader();
  renderTimelineTasks();
}

// Render timeline header with time scale
function renderTimelineHeader() {
  const header = document.getElementById('timeline-time-header');
  if (!header) return;
  
  const startDate = timelineState.startDate;
  const endDate = timelineState.endDate;
  const timeScale = timelineState.timeScale;
  
  let headerHTML = '';
  
  if (timeScale === 'hours') {
    // Two-line header: days on top, hours below
    const days = [];
    const hours = [];
    
    let current = startDate.clone();
    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
      const dayName = current.format('ddd DD/MM');
      days.push(`<div class="timeline-day-header">${dayName}</div>`);
      
      // Add hours for this day
      const dayHours = [];
      for (let h = 0; h < 24; h++) {
        const hour = current.clone().hour(h);
        if (hour.isAfter(endDate)) break;
        if (hour.isBefore(startDate)) continue;
        
        dayHours.push(`<div class="timeline-hour-header">${h}</div>`);
      }
      hours.push(`<div class="timeline-day-hours">${dayHours.join('')}</div>`);
      
      current = current.add(1, 'day');
    }
    
    headerHTML = `
      <div class="timeline-days-row">${days.join('')}</div>
      <div class="timeline-hours-row">${hours.join('')}</div>
    `;
  } else {
    // Single line for days only
    const days = [];
    let current = startDate.clone();
    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
      const dayName = current.format('ddd DD/MM');
      days.push(`<div class="timeline-day-header">${dayName}</div>`);
      current = current.add(1, 'day');
    }
    
    headerHTML = `<div class="timeline-days-row">${days.join('')}</div>`;
  }
  
  header.innerHTML = headerHTML;
}

// Render timeline tasks
function renderTimelineTasks() {
  const taskNames = document.getElementById('timeline-task-names');
  const grid = document.getElementById('timeline-grid');
  
  if (!taskNames || !grid) return;
  
  // Get filtered and sorted jobs
  const jobs = getTimelineJobs();
  
  let taskNamesHTML = '';
  let gridHTML = '';
  
  jobs.forEach((job, index) => {
    const taskName = job.title || 'ללא כותרת';
    const worker = job.worker || '';
    const factory = job.factory || '';
    
    // Task name panel
    taskNamesHTML += `
      <div class="timeline-task-row" style="height: ${TIMELINE_CONFIG.taskHeight}px;">
        <div class="timeline-task-name">${escapeHtml(taskName)}</div>
        <div class="timeline-task-details">${escapeHtml(worker)} - ${escapeHtml(factory)}</div>
      </div>
    `;
    
    // Task bar
    const taskBar = createTaskBar(job, index);
    gridHTML += taskBar;
  });
  
  taskNames.innerHTML = taskNamesHTML;
  grid.innerHTML = gridHTML;
}

// Get jobs for timeline (filtered and sorted)
function getTimelineJobs() {
  // Apply the same filters as the main view
  let jobs = JOBS.filter(passFilters);
  
  // Sort by start date
  jobs.sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return 1;
    if (!b.start) return -1;
    return dayjs(a.start).valueOf() - dayjs(b.start).valueOf();
  });
  
  return jobs;
}

// Create task bar for timeline
function createTaskBar(job, index) {
  if (!job.start || !job.end) {
    return `<div class="timeline-task-row" style="height: ${TIMELINE_CONFIG.taskHeight}px;"></div>`;
  }
  
  const startTime = dayjs(job.start);
  const endTime = dayjs(job.end);
  
  if (!startTime.isValid() || !endTime.isValid()) {
    return `<div class="timeline-task-row" style="height: ${TIMELINE_CONFIG.taskHeight}px;"></div>`;
  }
  
  // Calculate position and width
  const position = calculateTaskPosition(startTime);
  const width = calculateTaskWidth(startTime, endTime);
  
  // Determine task color based on priority or other factors
  const color = getTaskColor(job);
  
  // Check if task is in the visible time range
  if (position < 0 || position > getTimelineWidth()) {
    return `<div class="timeline-task-row" style="height: ${TIMELINE_CONFIG.taskHeight}px;"></div>`;
  }
  
  return `
    <div class="timeline-task-row" style="height: ${TIMELINE_CONFIG.taskHeight}px;">
      <div 
        class="timeline-task-bar ${job.finished ? 'finished' : ''}" 
        style="
          left: ${position}px; 
          width: ${width}px; 
          background-color: ${color};
          top: 2px;
        "
        title="${escapeHtml(job.title || '')} (${fmt(job.start)} - ${fmt(job.end)})"
      >
        <span class="timeline-task-label">${escapeHtml(job.title || '')}</span>
      </div>
    </div>
  `;
}

// Calculate task position on timeline
function calculateTaskPosition(startTime) {
  const timelineStart = timelineState.startDate;
  const diff = startTime.diff(timelineStart, 'hours', true);
  return diff * TIMELINE_CONFIG.hourWidth * timelineState.zoomLevel;
}

// Calculate task width on timeline
function calculateTaskWidth(startTime, endTime) {
  const duration = endTime.diff(startTime, 'hours', true);
  return Math.max(20, duration * TIMELINE_CONFIG.hourWidth * timelineState.zoomLevel);
}

// Get task color based on job properties
function getTaskColor(job) {
  // Color based on priority
  const priorityColors = {
    'high': '#ff6b6b',
    'medium': '#4ecdc4',
    'low': '#45b7d1',
    'urgent': '#ff9f43'
  };
  
  if (job.priority && priorityColors[job.priority.toLowerCase()]) {
    return priorityColors[job.priority.toLowerCase()];
  }
  
  // Default color based on factory
  const factoryColors = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
    '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43'
  ];
  
  if (job.factory) {
    const hash = job.factory.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return factoryColors[Math.abs(hash) % factoryColors.length];
  }
  
  return '#95a5a6'; // Default gray
}

// Get timeline width
function getTimelineWidth() {
  const duration = timelineState.endDate.diff(timelineState.startDate, 'hours', true);
  return duration * TIMELINE_CONFIG.hourWidth * timelineState.zoomLevel;
}

// Update Gantt date range
function updateGanttDateRange() {
  const startDateInput = document.getElementById('gantt-start-date');
  const endDateInput = document.getElementById('gantt-end-date');
  
  if (startDateInput?.value) {
    timelineState.startDate = dayjs(startDateInput.value);
  } else {
    timelineState.startDate = dayjs().startOf('day');
  }
  
  if (endDateInput?.value) {
    timelineState.endDate = dayjs(endDateInput.value).endOf('day');
  } else {
    timelineState.endDate = timelineState.startDate.clone().add(7, 'days');
  }
  
  // Set default values if not set
  if (!startDateInput?.value) {
    startDateInput.value = timelineState.startDate.format('YYYY-MM-DD');
  }
  if (!endDateInput?.value) {
    endDateInput.value = timelineState.endDate.format('YYYY-MM-DD');
  }
  
  renderGantt();
}

// Zoom Gantt
function zoomGantt(factor) {
  timelineState.zoomLevel = Math.max(
    TIMELINE_CONFIG.minZoom,
    Math.min(TIMELINE_CONFIG.maxZoom, timelineState.zoomLevel * factor)
  );
  
  // Zoom level display removed
  
  renderGantt();
}

// Render Gantt chart
function renderGantt() {
  console.log('Rendering Gantt chart...');
  if (!timelineState.startDate || !timelineState.endDate) {
    updateGanttDateRange();
  }
  
  const chart = document.getElementById('gantt-chart');
  if (!chart) {
    console.log('Gantt chart element not found');
    return;
  }
  
  // Get filtered and sorted jobs
  const jobs = getTimelineJobs();
  console.log(`Found ${jobs.length} jobs for Gantt chart`);
  
  let chartHTML = '';
  
  jobs.forEach((job, index) => {
    const taskName = job.title || 'ללא כותרת';
    const worker = job.worker || '';
    const factory = job.factory || '';
    
    if (!job.start || !job.end) {
      chartHTML += `
        <div class="gantt-task-row">
          <div class="gantt-task-info">
            <div class="gantt-task-name">${escapeHtml(taskName)}</div>
            <div class="gantt-task-details">${escapeHtml(worker)} - ${escapeHtml(factory)}</div>
          </div>
          <div class="gantt-task-time">ללא זמן</div>
          <div class="gantt-task-bar-container">
            <div class="gantt-task-bar no-time"></div>
          </div>
        </div>
      `;
      return;
    }
    
    const startTime = dayjs(job.start);
    const endTime = dayjs(job.end);
    
    if (!startTime.isValid() || !endTime.isValid()) {
      chartHTML += `
        <div class="gantt-task-row">
          <div class="gantt-task-info">
            <div class="gantt-task-name">${escapeHtml(taskName)}</div>
            <div class="gantt-task-details">${escapeHtml(worker)} - ${escapeHtml(factory)}</div>
          </div>
          <div class="gantt-task-time">זמן לא תקין</div>
          <div class="gantt-task-bar-container">
            <div class="gantt-task-bar no-time"></div>
          </div>
        </div>
      `;
      return;
    }
    
    const startTimeStr = startTime.format('HH:mm');
    const endTimeStr = endTime.format('HH:mm');
    const duration = endTime.diff(startTime, 'hours', true);
    
    // Calculate position and width
    const position = calculateTaskPosition(startTime);
    const width = calculateTaskWidth(startTime, endTime);
    
    // Determine task color
    const color = getTaskColor(job);
    
    chartHTML += `
      <div class="gantt-task-row">
        <div class="gantt-task-info">
          <div class="gantt-task-name">${escapeHtml(taskName)}</div>
          <div class="gantt-task-details">${escapeHtml(worker)} - ${escapeHtml(factory)}</div>
        </div>
        <div class="gantt-task-time">${startTimeStr} - ${endTimeStr}</div>
        <div class="gantt-task-bar-container">
          <div 
            class="gantt-task-bar ${job.finished ? 'finished' : ''}" 
            style="
              left: ${position}px; 
              width: ${width}px; 
              background-color: ${color};
            "
            title="${escapeHtml(taskName)} (${startTimeStr} - ${endTimeStr}, ${duration.toFixed(1)}h)"
          >
            <span class="gantt-task-label">${escapeHtml(taskName)}</span>
          </div>
        </div>
      </div>
    `;
  });
  
  chart.innerHTML = chartHTML;
}

// Update timeline when data changes
function updateTimeline() {
  if (document.getElementById('timeline-tab')?.style.display !== 'none') {
    renderTimeline();
  }
}

// Update Gantt when data changes
function updateGantt() {
  if (document.getElementById('gantt-tab')?.style.display !== 'none') {
    renderGantt();
  }
}

// Initialize timeline when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize timeline after a short delay to ensure main app is loaded
  setTimeout(() => {
    // Don't auto-initialize timeline, let the tab switching handle it
    console.log('Timeline.js loaded');
  }, 100);
});
