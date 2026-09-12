let allOrdersCache = [];

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadSettings();

  // Auto refresh dashboard and logs every 10 seconds
  setInterval(() => {
    const activeTab = document.querySelector('.tab-section.active');
    if (activeTab && activeTab.id === 'tab-dashboard') {
      loadDashboard(false);
    } else if (activeTab && activeTab.id === 'tab-logs') {
      loadLogs(false);
    }
  }, 8000);
});

function showTab(tabName, el) {
  document.querySelectorAll('.tab-section').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

  document.getElementById(`tab-${tabName}`).classList.add('active');
  if (el) el.classList.add('active');

  const titles = {
    dashboard: 'Dashboard',
    orders: 'Orders & Transactions',
    logs: 'Response & Error Logs',
    settings: 'QR & Account Settings',
    generator: 'Payment Link Generator'
  };
  document.getElementById('page-heading').textContent = titles[tabName] || 'Dashboard';

  if (tabName === 'dashboard') loadDashboard();
  if (tabName === 'orders') loadOrders();
  if (tabName === 'logs') loadLogs();
  if (tabName === 'settings') loadSettings();
}

// 1. Dashboard
async function loadDashboard(showLoading = true) {
  try {
    const [statsRes, ordersRes] = await Promise.all([
      fetch('/api/admin/stats').then(r => r.json()),
      fetch('/api/admin/orders?limit=6').then(r => r.json())
    ]);

    if (statsRes.code === '000000') {
      const s = statsRes.data;
      document.getElementById('stat-total-volume').textContent = `PKR ${s.totalVolume.toLocaleString()}`;
      document.getElementById('stat-total-count').textContent = `${s.totalCount} total orders`;

      document.getElementById('stat-success-volume').textContent = `PKR ${s.successVolume.toLocaleString()}`;
      document.getElementById('stat-success-count').textContent = `${s.successCount} approved`;

      document.getElementById('stat-pending-volume').textContent = `PKR ${s.pendingVolume.toLocaleString()}`;
      document.getElementById('stat-pending-count').textContent = `${s.pendingCount} waiting`;

      document.getElementById('stat-failed-count').textContent = s.failedCount;
    }

    if (ordersRes.code === '000000') {
      renderRecentOrders(ordersRes.data);
    }
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

function renderRecentOrders(orders) {
  const tbody = document.getElementById('recent-orders-table');
  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No transactions yet</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td style="font-family: monospace; font-weight: 600;">${o.order_no}</td>
      <td>
        <span class="badge ${o.pay_product_code === 'PAKJAZZCASH' ? 'badge-jc' : 'badge-ep'}">
          ${o.pay_product_code === 'PAKJAZZCASH' ? 'JazzCash' : 'EasyPaisa'}
        </span>
      </td>
      <td style="font-weight: 700;">PKR ${o.amount}</td>
      <td>${o.mobile || '<span style="color: var(--text-muted);">Not entered</span>'}</td>
      <td>
        ${o.trx_id ? `<span class="badge" style="background: #e0f2fe; color: #0369a1; font-weight: 700; font-family: monospace;">TID: ${o.trx_id}</span>` : '<span style="color: var(--text-muted); font-size: 11px;">None</span>'}
      </td>
      <td><span class="badge ${getStatusBadgeClass(o.status)}">${o.status}</span></td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(o.created_at)}</td>
      <td>
        ${o.status === 'PENDING' || o.status === 'PROCESSING' ? `
          <button class="btn-action btn-approve" onclick="updateOrderStatus('${o.order_no}', 'SUCCESS')">Approve</button>
          <button class="btn-action btn-reject" onclick="updateOrderStatus('${o.order_no}', 'REJECTED')">Reject</button>
        ` : `
          <button class="btn-action" style="background: var(--border); color: white;" onclick="updateOrderStatus('${o.order_no}', 'PENDING')">Reset</button>
        `}
      </td>
    </tr>
  `).join('');
}

// 2. Orders Tab
async function loadOrders() {
  try {
    const res = await fetch('/api/admin/orders?limit=150');
    const result = await res.json();
    if (result.code === '000000') {
      allOrdersCache = result.data;
      renderAllOrders(result.data);
    }
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

function renderAllOrders(orders) {
  const tbody = document.getElementById('all-orders-table');
  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No orders found</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td style="font-family: monospace; font-weight: 600;">${o.order_no}</td>
      <td>
        <span class="badge ${o.pay_product_code === 'PAKJAZZCASH' ? 'badge-jc' : 'badge-ep'}">
          ${o.pay_product_code === 'PAKJAZZCASH' ? 'JazzCash' : 'EasyPaisa'}
        </span>
      </td>
      <td style="font-weight: 700;">PKR ${o.amount}</td>
      <td><strong>${o.mobile || '---'}</strong></td>
      <td>
        ${o.trx_id ? `<span class="badge" style="background: #e0f2fe; color: #0369a1; font-weight: 700; font-family: monospace;">${o.trx_id}</span>` : '<span style="color: var(--text-muted); font-size: 11px;">Not submitted</span>'}
      </td>
      <td><span class="badge ${getStatusBadgeClass(o.status)}">${o.status}</span></td>
      <td style="font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${o.response_message || '---'}
      </td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(o.created_at)}</td>
      <td>
        <button class="btn-action btn-approve" onclick="updateOrderStatus('${o.order_no}', 'SUCCESS')">Approve</button>
        <button class="btn-action btn-reject" onclick="updateOrderStatus('${o.order_no}', 'REJECTED')">Reject</button>
      </td>
    </tr>
  `).join('');
}

function filterOrdersTable() {
  const query = document.getElementById('order-search-input').value.toLowerCase().trim();
  if (!query) {
    renderAllOrders(allOrdersCache);
    return;
  }
  const filtered = allOrdersCache.filter(o =>
    (o.order_no && o.order_no.toLowerCase().includes(query)) ||
    (o.mobile && o.mobile.includes(query)) ||
    (o.trx_id && o.trx_id.toLowerCase().includes(query))
  );
  renderAllOrders(filtered);
}

async function updateOrderStatus(orderNo, status) {
  try {
    const res = await fetch('/api/admin/order/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNo, status })
    });
    const result = await res.json();
    if (result.code === '000000') {
      loadDashboard(false);
      loadOrders();
    } else {
      alert('Error updating order: ' + result.message);
    }
  } catch (err) {
    alert('Failed to update status');
  }
}

// 3. Categorized Response & Error Logs
let currentLogCategory = 'ALL';

function filterLogsCategory(cat, el) {
  currentLogCategory = cat;
  document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  loadLogs();
}

async function loadLogs() {
  try {
    const url = currentLogCategory && currentLogCategory !== 'ALL'
      ? `/api/admin/logs?category=${currentLogCategory}&limit=120`
      : '/api/admin/logs?limit=120';

    const res = await fetch(url);
    const result = await res.json();
    const container = document.getElementById('logs-container');

    if (result.code === '000000') {
      const logs = result.data;
      if (logs.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 24px;">No logs found for category <strong>${currentLogCategory}</strong></div>`;
        return;
      }

      container.innerHTML = logs.map(l => `
        <div class="log-item ${l.status}">
          <div class="log-header">
            <div>
              <span class="badge ${getCategoryBadgeClass(l.category)}">${l.category || 'SYSTEM'}</span>
              <strong style="margin-left: 6px;">[${l.action}]</strong> 
              ${l.order_no ? `<span style="color: var(--text-main);">Order: ${l.order_no}</span>` : ''} 
              ${l.mobile ? `<span style="color: #60a5fa;">| Phone: ${l.mobile}</span>` : ''}
            </div>
            <span>${formatDate(l.created_at)}</span>
          </div>
          <div class="log-body">${formatLogDetails(l.details)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

function getCategoryBadgeClass(cat) {
  switch (cat) {
    case 'API_BRIDGE_ERROR': return 'badge-failed';
    case 'CUSTOMER_ERROR': return 'badge-pending';
    case 'MERCHANT_WEBHOOK': return 'badge-processing';
    case 'PAYMENT_SUCCESS': return 'badge-success';
    case 'INTENT_QR': return 'badge-jc';
    default: return 'badge-pending';
  }
}

function formatLogDetails(details) {
  if (!details) return '';
  try {
    const parsed = JSON.parse(details);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return details;
  }
}

// 4. Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const result = await res.json();
    if (result.code === '000000') {
      const s = result.data;
      document.getElementById('setting-jc-account').value = s.jazzcash_account || '';
      document.getElementById('setting-jc-title').value = s.jazzcash_title || '';
      document.getElementById('setting-jc-till').value = s.jazzcash_till_id || '';

      document.getElementById('setting-ep-account').value = s.easypaisa_account || '';
      document.getElementById('setting-ep-title').value = s.easypaisa_title || '';
      document.getElementById('setting-ep-till').value = s.easypaisa_till_id || '';

      document.getElementById('setting-auto-approve').value = s.auto_approve_seconds || '12';
      document.getElementById('setting-preset-amounts').value = s.preset_amounts || '';

      updateQRPreviews(s.jazzcash_qr_url, s.easypaisa_qr_url);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function updateQRPreviews(jcUrl, epUrl) {
  const jcBox = document.getElementById('preview-jc-box');
  const epBox = document.getElementById('preview-ep-box');

  if (jcUrl) {
    jcBox.innerHTML = `<img src="${jcUrl}" alt="JazzCash QR" />`;
  } else {
    jcBox.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">No QR Uploaded</span>`;
  }

  if (epUrl) {
    epBox.innerHTML = `<img src="${epUrl}" alt="EasyPaisa QR" />`;
  } else {
    epBox.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">No QR Uploaded</span>`;
  }
}

async function saveSettings() {
  const payload = {
    jazzcash_account: document.getElementById('setting-jc-account').value.trim(),
    jazzcash_title: document.getElementById('setting-jc-title').value.trim(),
    jazzcash_till_id: document.getElementById('setting-jc-till').value.trim(),

    easypaisa_account: document.getElementById('setting-ep-account').value.trim(),
    easypaisa_title: document.getElementById('setting-ep-title').value.trim(),
    easypaisa_till_id: document.getElementById('setting-ep-till').value.trim(),

    active_mode: 'dynamic_qr',
    auto_approve_seconds: document.getElementById('setting-auto-approve').value,
    preset_amounts: document.getElementById('setting-preset-amounts').value.trim()
  };

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.code === '000000') {
      alert('Settings saved successfully!');
    } else {
      alert('Error saving settings: ' + result.message);
    }
  } catch (err) {
    alert('Failed to save settings');
  }
}

async function uploadQR(channel) {
  const input = document.getElementById(`file-${channel === 'jazzcash' ? 'jc' : 'ep'}-qr`);
  if (!input.files || !input.files[0]) return;

  const formData = new FormData();
  formData.append('qrImage', input.files[0]);
  formData.append('channel', channel);

  try {
    const res = await fetch('/api/admin/upload-qr', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.code === '000000') {
      alert(`${channel === 'jazzcash' ? 'JazzCash' : 'EasyPaisa'} QR Code uploaded!`);
      loadSettings();
    } else {
      alert('Upload failed: ' + result.message);
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  }
}

// 5. Payment Link Generator
async function generatePaymentLink() {
  const amount = document.getElementById('gen-amount').value || 100;
  const channel = document.getElementById('gen-channel').value;

  try {
    const res = await fetch('/api/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, payProductCode: channel })
    });
    const result = await res.json();
    if (result.code === '000000') {
      const order = result.data;
      const fullUrl = `${window.location.origin}/next?orderNo=${order.orderNo}&payProductCode=${order.payProductCode}&amount=${order.payAmount}`;

      document.getElementById('gen-url-input').value = fullUrl;
      document.getElementById('gen-open-link').href = fullUrl;
      document.getElementById('gen-result').style.display = 'block';
    }
  } catch (err) {
    alert('Failed to generate link: ' + err.message);
  }
}

function copyGeneratedLink() {
  const input = document.getElementById('gen-url-input');
  navigator.clipboard.writeText(input.value).then(() => {
    alert('Payment link copied to clipboard!');
  });
}

// Helpers
function getStatusBadgeClass(status) {
  switch (status) {
    case 'SUCCESS': return 'badge-success';
    case 'PROCESSING': return 'badge-processing';
    case 'FAILED':
    case 'REJECTED': return 'badge-failed';
    default: return 'badge-pending';
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
