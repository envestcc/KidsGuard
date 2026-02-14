/* ══════════════════════════════════════════════════════════════
   KidsGuard — Frontend Logic
   Handles all Trio API interactions via the Flask backend
   ══════════════════════════════════════════════════════════════ */

// ─── State ───
let currentStreamUrl = '';
let checkCount = 0;
let pollingInterval = null;
let webhookSiteToken = null;
let webhookPollingInterval = null;
let seenWebhookEventIds = new Set();

// ══════════════════════════════════════════════════════════════
//  Init
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  loadPresets();
  loadAlertHistory();
  refreshJobs();
  loadWebhookSiteToken();

  // Keyboard shortcut: Enter in stream URL → validate
  document.getElementById('streamUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') validateStream();
  });
  document.getElementById('customCondition').addEventListener('keydown', e => {
    if (e.key === 'Enter') runCustomCheck();
  });
});

// Load existing webhook.site token on page load
async function loadWebhookSiteToken() {
  try {
    const res = await fetch('/api/webhook-site/token');
    const data = await res.json();
    if (data.uuid) {
      webhookSiteToken = data;
      const urlRow = document.getElementById('webhookUrlRow');
      const urlEl = document.getElementById('webhookSiteUrl');
      if (urlRow) urlRow.classList.remove('hidden');
      if (urlEl) urlEl.textContent = data.url;
      const linkEl = document.getElementById('webhookSiteLink');
      if (linkEl) linkEl.href = `https://webhook.site/#!/view/${data.uuid}`;
      startWebhookSitePolling();
    }
  } catch (e) { /* no token yet */ }
}

// ══════════════════════════════════════════════════════════════
//  Theme Toggle
// ══════════════════════════════════════════════════════════════
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
}

// ══════════════════════════════════════════════════════════════
//  Toast Notifications
// ══════════════════════════════════════════════════════════════
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ══════════════════════════════════════════════════════════════
//  Stream Validation
// ══════════════════════════════════════════════════════════════
async function validateStream() {
  const urlInput = document.getElementById('streamUrl');
  const url = urlInput.value.trim();
  if (!url) { showToast('Please enter a stream URL', 'warning'); return; }

  const btn = document.getElementById('btnValidate');
  const statusDiv = document.getElementById('streamStatus');
  const connStatus = document.getElementById('connectionStatus');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  connStatus.innerHTML = '<span class="status-dot checking"></span><span>Testing…</span>';
  statusDiv.classList.remove('hidden', 'valid', 'invalid');

  try {
    const res = await fetch('/api/validate-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_url: url }),
    });
    const data = await res.json();

    if (data.valid) {
      currentStreamUrl = url;
      statusDiv.className = 'stream-status valid';
      statusDiv.innerHTML = '✅ Stream is live and accessible';
      connStatus.innerHTML = '<span class="status-dot online"></span><span>Connected</span>';
      showToast('Stream validated successfully!', 'success');
      embedStreamPreview(url);
    } else {
      statusDiv.className = 'stream-status invalid';
      statusDiv.innerHTML = `❌ ${data.message}${data.remediation ? '<br><small>' + data.remediation + '</small>' : ''}`;
      connStatus.innerHTML = '<span class="status-dot offline"></span><span>Failed</span>';
      showToast('Stream validation failed', 'error');
    }
  } catch (err) {
    statusDiv.className = 'stream-status invalid';
    statusDiv.innerHTML = `❌ Connection error: ${err.message}`;
    connStatus.innerHTML = '<span class="status-dot offline"></span><span>Error</span>';
    showToast('Network error', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}

function embedStreamPreview(url) {
  const preview = document.getElementById('streamPreview');
  let embedUrl = '';

  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) {
    embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`;
  }
  // Twitch
  const twitchMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
  if (twitchMatch) {
    embedUrl = `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${location.hostname}&muted=true`;
  }

  if (embedUrl) {
    preview.innerHTML = `<iframe src="${embedUrl}" allowfullscreen allow="autoplay"></iframe>`;
  } else {
    preview.innerHTML = `<div class="preview-placeholder"><span class="preview-icon">📺</span><p>Stream connected (no embed available)</p></div>`;
  }
}

// ══════════════════════════════════════════════════════════════
//  Safety Check Presets
// ══════════════════════════════════════════════════════════════
async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    const presets = await res.json();
    const grid = document.getElementById('presetGrid');
    grid.innerHTML = '';

    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.setAttribute('data-condition', p.condition);
      btn.setAttribute('data-id', p.id);
      btn.style.setProperty('--preset-color', p.color);
      btn.innerHTML = `
        <span class="preset-icon">${p.icon}</span>
        <span class="preset-label">${p.label}</span>
      `;
      btn.addEventListener('click', () => runPresetCheck(p, btn));
      grid.appendChild(btn);
    });
  } catch (err) {
    console.error('Failed to load presets:', err);
  }
}

async function runPresetCheck(preset, btnEl) {
  if (!getStreamUrl()) return;
  btnEl.classList.add('loading');
  await runSafetyCheck(preset.condition);
  btnEl.classList.remove('loading');
}

function runCustomCheck() {
  const condition = document.getElementById('customCondition').value.trim();
  if (!condition) { showToast('Enter a safety question', 'warning'); return; }
  if (!getStreamUrl()) return;
  runSafetyCheck(condition);
}

function getStreamUrl() {
  const url = document.getElementById('streamUrl').value.trim();
  if (!url) {
    showToast('Please enter and validate a stream URL first', 'warning');
    return null;
  }
  return url;
}

async function runSafetyCheck(condition) {
  const streamUrl = getStreamUrl();
  if (!streamUrl) return;

  showToast('Running AI safety analysis…', 'info', 8000);

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_url: streamUrl, condition }),
    });
    const data = await res.json();

    if (data.error) {
      showToast(`Error: ${data.error}`, 'error');
      return;
    }

    checkCount++;
    document.getElementById('checkCount').textContent = `${checkCount} checks`;
    displayResult(data);
    addToHistory(data);

    // Alert sounds / visual for danger
    if (data.danger_level === 'high') {
      showToast('⚠️ HIGH DANGER DETECTED!', 'error', 6000);
      document.getElementById('latestResult').classList.add('pulse-danger');
      setTimeout(() => document.getElementById('latestResult').classList.remove('pulse-danger'), 4500);
    } else if (data.danger_level === 'medium') {
      showToast('⚠ Warning detected', 'warning');
    } else {
      showToast('✅ Area appears safe', 'success');
    }
  } catch (err) {
    showToast(`Check failed: ${err.message}`, 'error');
  }
}

function displayResult(data) {
  const card = document.getElementById('latestResult');
  card.classList.remove('hidden', 'danger-high', 'danger-medium', 'danger-safe');
  card.classList.add(`danger-${data.danger_level}`);

  const levelLabels = { high: '🔴 HIGH DANGER', medium: '🟡 WARNING', safe: '🟢 SAFE' };
  const levelClass = data.danger_level;

  card.innerHTML = `
    <div class="result-header">
      <span class="result-badge ${levelClass}">${levelLabels[data.danger_level] || 'UNKNOWN'}</span>
      <span class="result-triggered ${data.triggered ? 'yes' : 'no'}">
        ${data.triggered ? '⚠ TRIGGERED' : '✓ NOT TRIGGERED'}
      </span>
    </div>
    <p class="result-explanation">${escapeHtml(data.explanation || 'No explanation provided')}</p>
    <div class="result-meta">
      <span>📋 ${escapeHtml(data.condition)}</span>
      <span>⏱ ${data.latency_ms}ms</span>
      <span>🕐 ${formatTime(data.timestamp)}</span>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
//  Webhook.site Integration
// ══════════════════════════════════════════════════════════════
async function createWebhookSite() {
  const btn = document.querySelector('.webhook-site-section .btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'; }

  try {
    const res = await fetch('/api/webhook-site/create', { method: 'POST' });
    const data = await res.json();

    if (data.error) { showToast(`Webhook.site error: ${data.error}`, 'error'); return; }

    webhookSiteToken = data;
    const urlRow = document.getElementById('webhookUrlRow');
    const urlEl = document.getElementById('webhookSiteUrl');
    if (urlRow) urlRow.classList.remove('hidden');
    if (urlEl) urlEl.textContent = data.url;

    const linkEl = document.getElementById('webhookSiteLink');
    if (linkEl) linkEl.href = `https://webhook.site/#!/view/${data.uuid}`;

    showToast('Webhook URL created! It will be auto-used when you start monitoring.', 'success');

    // Start polling for events
    startWebhookSitePolling();
  } catch (err) {
    showToast(`Failed to create webhook: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Create Webhook URL'; }
  }
}

function copyWebhookUrl() {
  const urlEl = document.getElementById('webhookSiteUrl');
  if (!urlEl) return;
  navigator.clipboard.writeText(urlEl.textContent).then(() => {
    showToast('Webhook URL copied!', 'success', 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = urlEl.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Webhook URL copied!', 'success', 2000);
  });
}

function startWebhookSitePolling() {
  if (webhookPollingInterval) return;
  pollWebhookSiteEvents(); // immediate first poll
  webhookPollingInterval = setInterval(pollWebhookSiteEvents, 6000);
}

function stopWebhookSitePolling() {
  if (webhookPollingInterval) { clearInterval(webhookPollingInterval); webhookPollingInterval = null; }
}

async function pollWebhookSiteEvents() {
  try {
    const res = await fetch('/api/webhook-site/events');
    const data = await res.json();

    if (data.error) return;

    const events = data.events || [];
    const container = document.getElementById('webhookEventsList');
    const countBadge = document.getElementById('webhookEventCount');
    if (!container) return;

    if (countBadge) countBadge.textContent = `${events.length} event${events.length !== 1 ? 's' : ''}`;

    if (events.length === 0) {
      container.innerHTML = '<p class="muted" style="text-align:center;padding:1.5rem;">No events yet. Start monitoring to receive webhook events.</p>';
      return;
    }

    // Only update if we have new events
    const latestIds = events.map(e => e.id);
    const hasNewEvents = latestIds.some(id => !seenWebhookEventIds.has(id));
    if (!hasNewEvents && container.children.length > 0 && !container.querySelector('.muted')) return;

    latestIds.forEach(id => seenWebhookEventIds.add(id));

    container.innerHTML = events.map(ev => {
      const typeClass = ev.triggered ? 'event-triggered' :
                        ev.danger_level === 'safe' ? 'event-checked' : 'event-status';
      const typeIcon = ev.triggered ? '🚨' :
                       ev.danger_level === 'safe' ? '✅' : 'ℹ️';
      const typeLabel = ev.triggered ? 'TRIGGERED' :
                        ev.danger_level === 'safe' ? 'SAFE' : ev.type || 'EVENT';

      const time = ev.timestamp ? formatTime(ev.timestamp) : '—';

      let frameHtml = '';
      if (ev.frame_url) {
        frameHtml = `<div class="webhook-event-frame"><img src="${escapeHtml(ev.frame_url)}" alt="Captured frame" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
      }

      return `
        <div class="webhook-event-card ${typeClass}">
          <div class="webhook-event-header">
            <span class="webhook-event-type">${typeIcon} ${typeLabel}</span>
            <span style="color:var(--text-dim);font-size:0.75rem">${time}</span>
          </div>
          <p style="margin:0.5rem 0 0;font-size:0.85rem;line-height:1.4">${escapeHtml(ev.explanation || ev.summary || 'No details')}</p>
          ${ev.condition ? `<p style="margin:0.3rem 0 0;font-size:0.75rem;color:var(--text-dim)">📋 ${escapeHtml(ev.condition)}</p>` : ''}
          ${frameHtml}
        </div>
      `;
    }).join('');

    // Alert for new triggered events
    events.forEach(ev => {
      if (ev.triggered && !seenWebhookEventIds.has('alerted_' + ev.id)) {
        seenWebhookEventIds.add('alerted_' + ev.id);
        showToast(`🚨 ALERT: ${ev.explanation?.slice(0, 80) || 'Condition triggered!'}`, 'error', 8000);
      }
    });

  } catch (e) { /* silent */ }
}

function refreshWebhookEvents() {
  seenWebhookEventIds.clear();
  pollWebhookSiteEvents();
}

// ══════════════════════════════════════════════════════════════
//  Continuous Monitoring
// ══════════════════════════════════════════════════════════════
async function startMonitor() {
  const streamUrl = getStreamUrl();
  if (!streamUrl) return;

  const condition = document.getElementById('monitorCondition').value.trim();
  if (!condition) { showToast('Enter a monitoring condition', 'warning'); return; }

  // Webhook URL is auto-managed via webhook.site (backend handles it)
  const btn = document.getElementById('btnStartMonitor');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Starting…';

  try {
    const res = await fetch('/api/monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_url: streamUrl, condition }),
    });
    const data = await res.json();

    if (data.error) {
      showToast(`Error: ${data.error}`, 'error');
      return;
    }

    showToast(`Monitoring started! Job: ${data.job_id}`, 'success');
    document.getElementById('btnStopMonitor').disabled = false;
    refreshJobs();

    // Ensure webhook.site polling is running
    if (webhookSiteToken) startWebhookSitePolling();
    startWebhookPolling();
  } catch (err) {
    showToast(`Failed to start monitoring: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶ Start Monitoring';
  }
}

async function stopAllMonitors() {
  if (!confirm('Stop all active monitoring jobs?')) return;
  try {
    const res = await fetch('/api/monitor/jobs');
    const data = await res.json();
    const runningJobs = (data.jobs || []).filter(j => j.status === 'running');

    for (const job of runningJobs) {
      await fetch('/api/monitor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id }),
      });
    }
    showToast(`Stopped ${runningJobs.length} job(s)`, 'info');
    stopWebhookPolling();
    stopWebhookSitePolling();
    refreshJobs();
    document.getElementById('btnStopMonitor').disabled = true;
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function cancelJob(jobId) {
  try {
    await fetch('/api/monitor/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    showToast(`Job ${jobId.slice(0, 8)} cancelled`, 'info');
    refreshJobs();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function refreshJobs() {
  const container = document.getElementById('jobsList');
  try {
    const res = await fetch('/api/monitor/jobs');
    const data = await res.json();
    const jobs = data.jobs || [];

    if (jobs.length === 0) {
      container.innerHTML = '<p class="muted">No jobs found</p>';
      document.getElementById('btnStopMonitor').disabled = true;
      return;
    }

    const hasRunning = jobs.some(j => j.status === 'running');
    document.getElementById('btnStopMonitor').disabled = !hasRunning;

    container.innerHTML = jobs.map(job => `
      <div class="job-card">
        <div>
          <span class="job-status ${job.status}">
            ${job.status === 'running' ? '🟢' : '⚪'} ${job.status}
          </span>
          <span style="margin-left: 0.5rem; color: var(--text-dim)">
            ${job.job_type || 'monitor'} · ${job.job_id.slice(0, 8)}…
          </span>
        </div>
        <div class="job-actions">
          ${job.details ? `<span style="color:var(--text-dim);font-size:0.75rem">
            ${job.details.checks_performed || 0} checks · ${job.details.triggers_fired || 0} triggers
          </span>` : ''}
          ${job.status === 'running' ? `<button class="btn btn-sm btn-danger" onclick="cancelJob('${job.job_id}')">Stop</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="muted">Could not load jobs</p>`;
  }
}

// Webhook event polling
function startWebhookPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/webhook/events');
      const events = await res.json();
      // Process any new triggered events
      events.forEach(ev => {
        if (ev.type === 'watch_triggered' && ev.data && !ev._shown) {
          const danger = ev.data.triggered ? 'high' : 'safe';
          showToast(`🚨 ALERT: ${ev.data.explanation?.slice(0, 80) || 'Condition triggered!'}`, 'error', 8000);
          ev._shown = true;
        }
      });
    } catch (e) { /* silent */ }
    // Also refresh jobs
    refreshJobs();
  }, 10000);
}

function stopWebhookPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

// ══════════════════════════════════════════════════════════════
//  Live Digest
// ══════════════════════════════════════════════════════════════
async function startDigest() {
  const streamUrl = getStreamUrl();
  if (!streamUrl) return;

  const output = document.getElementById('digestOutput');
  output.innerHTML = '<span class="spinner"></span> Generating activity summary…\n\n';

  try {
    const evtSource = new EventSource(
      `/api/digest/start-sse?stream_url=${encodeURIComponent(streamUrl)}`
    );

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'summary') {
          output.innerHTML += `\n📝 [Summary]\n${data.summary || data.text || JSON.stringify(data)}\n\n`;
        } else if (data.type === 'progress') {
          output.innerHTML += `⏳ ${data.message || 'Processing…'}\n`;
        } else if (data.type === 'error') {
          output.innerHTML += `\n❌ Error: ${data.message}\n`;
          evtSource.close();
        } else if (data.type === 'started') {
          output.innerHTML += `✅ Digest job started (ID: ${data.job_id || 'N/A'})\n`;
        } else if (data.type === 'stopped') {
          output.innerHTML += `\n🛑 Digest completed.\n`;
          evtSource.close();
        } else {
          output.innerHTML += `${JSON.stringify(data)}\n`;
        }
      } catch (e) {
        output.innerHTML += event.data + '\n';
      }
      output.scrollTop = output.scrollHeight;
    };

    evtSource.onerror = () => {
      output.innerHTML += '\n⚠ Stream ended or connection lost.\n';
      evtSource.close();
    };
  } catch (err) {
    output.innerHTML = `❌ Failed: ${err.message}`;
    showToast('Digest failed', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  Alert History
// ══════════════════════════════════════════════════════════════
async function loadAlertHistory() {
  try {
    const res = await fetch('/api/alerts');
    const alerts = await res.json();
    renderHistory(alerts);
  } catch (e) { /* ignore */ }
}

function addToHistory(record) {
  const tbody = document.getElementById('historyBody');
  // Remove "no checks" placeholder
  if (tbody.querySelector('.muted')) tbody.innerHTML = '';

  const row = createHistoryRow(record);
  tbody.insertBefore(row, tbody.firstChild);
}

function createHistoryRow(record) {
  const tr = document.createElement('tr');
  tr.style.animation = 'fadeIn 0.3s ease';
  tr.innerHTML = `
    <td>${formatTime(record.timestamp)}</td>
    <td><span class="level-badge ${record.danger_level}">${record.danger_level.toUpperCase()}</span></td>
    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(record.condition)}">${escapeHtml(record.condition)}</td>
    <td>${record.triggered ? '<span style="color:var(--danger)">⚠ Yes</span>' : '<span style="color:var(--success)">✓ No</span>'}</td>
    <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(record.explanation)}">${escapeHtml(record.explanation)}</td>
    <td>${record.latency_ms}ms</td>
  `;
  return tr;
}

function renderHistory(alerts) {
  const tbody = document.getElementById('historyBody');
  if (!alerts || alerts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No checks yet. Run a safety check above.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  alerts.forEach(a => tbody.appendChild(createHistoryRow(a)));
}

async function filterHistory() {
  const level = document.getElementById('historyFilter').value;
  try {
    const url = level ? `/api/alerts?level=${level}` : '/api/alerts';
    const res = await fetch(url);
    const alerts = await res.json();
    renderHistory(alerts);
  } catch (e) { showToast('Failed to filter', 'error'); }
}

async function exportAlerts() {
  window.open('/api/alerts/export', '_blank');
  showToast('Exporting alerts…', 'info');
}

async function clearAlerts() {
  if (!confirm('Clear all alert history?')) return;
  try {
    await fetch('/api/alerts/clear', { method: 'POST' });
    document.getElementById('historyBody').innerHTML = '<tr><td colspan="6" class="muted">History cleared.</td></tr>';
    showToast('History cleared', 'info');
  } catch (e) { showToast('Failed to clear', 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  Utility
// ══════════════════════════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return isoStr; }
}
