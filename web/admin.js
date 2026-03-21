// Простий вхід по паролю і додавання пар

const passwordInput = document.getElementById('admin-password');
const loginBtn = document.getElementById('admin-login-btn');
const statusEl = document.getElementById('admin-status');
const adminForm = document.getElementById('admin-form');
const adminStatsSection = document.getElementById('admin-stats');
const msgEl = document.getElementById('admin-message');
const statPageVisits = document.getElementById('stat-page-visits');
const statUnique = document.getElementById('stat-unique');
const statCron = document.getElementById('stat-cron');
const statsRefreshBtn = document.getElementById('admin-stats-refresh');

let adminPassword = '';

async function loadAdminStats() {
  if (!adminPassword) return;
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'x-admin-password': adminPassword },
    });
    if (!res.ok) {
      statPageVisits.textContent = '—';
      statUnique.textContent = '—';
      statCron.textContent = '—';
      return;
    }
    const data = await res.json();
    statPageVisits.textContent = String(data.pageVisits ?? 0);
    statUnique.textContent = String(data.uniqueVisitors ?? 0);
    statCron.textContent = String(data.healthPingsCron ?? 0);
  } catch (_) {
    statPageVisits.textContent = '—';
    statUnique.textContent = '—';
    statCron.textContent = '—';
  }
}

loginBtn.addEventListener('click', async () => {
  const value = passwordInput.value.trim();
  if (!value) {
    statusEl.textContent = 'Введіть пароль.';
    statusEl.className = 'admin-status error';
    return;
  }
  try {
    const check = await fetch('/api/admin/check', {
      headers: { 'x-admin-password': value },
    });
    if (!check.ok) {
      statusEl.textContent = 'Невірний пароль.';
      statusEl.className = 'admin-status error';
      adminStatsSection.style.display = 'none';
      adminForm.style.display = 'none';
      return;
    }
  } catch (_) {
    statusEl.textContent = 'Помилка зʼєднання.';
    statusEl.className = 'admin-status error';
    return;
  }
  adminPassword = value;
  statusEl.textContent = 'Успішно. Можна додавати пари.';
  statusEl.className = 'admin-status success';
  adminStatsSection.style.display = 'block';
  adminForm.style.display = 'block';
  await loadAdminStats();
});

statsRefreshBtn.addEventListener('click', () => loadAdminStats());

const dateInput = document.getElementById('date');
const startInput = document.getElementById('startTime');
const endInput = document.getElementById('endTime');
const titleInput = document.getElementById('title');
const teacherInput = document.getElementById('teacher');
const buildingInput = document.getElementById('building');
const roomInput = document.getElementById('room');
const addBtn = document.getElementById('add-lesson-btn');

addBtn.addEventListener('click', async () => {
  msgEl.textContent = '';
  if (!adminPassword) {
    msgEl.textContent = 'Спочатку введіть адмін-пароль вище.';
    msgEl.className = 'admin-message error';
    return;
  }

  const body = {
    date: dateInput.value,
    startTime: startInput.value,
    endTime: endInput.value,
    title: titleInput.value.trim(),
    teacher: teacherInput.value.trim() || null,
    building: buildingInput.value.trim(),
    room: roomInput.value.trim(),
    password: adminPassword,
  };

  if (!body.date || !body.startTime || !body.endTime || !body.title || !body.building || !body.room) {
    msgEl.textContent = 'Заповніть усі обовʼязкові поля.';
    msgEl.className = 'admin-message error';
    return;
  }

  try {
    const res = await fetch('/api/admin/schedule/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      msgEl.textContent = data.error || 'Помилка збереження.';
      msgEl.className = 'admin-message error';
    } else {
      msgEl.textContent = 'Пару додано.';
      msgEl.className = 'admin-message success';
    }
  } catch (e) {
    msgEl.textContent = 'Помилка мережі.';
    msgEl.className = 'admin-message error';
  }
});

