// Простий вхід по паролю і додавання пар

const passwordInput = document.getElementById('admin-password');
const loginBtn = document.getElementById('admin-login-btn');
const statusEl = document.getElementById('admin-status');
const adminForm = document.getElementById('admin-form');
const msgEl = document.getElementById('admin-message');

let adminPassword = '';

loginBtn.addEventListener('click', () => {
  const value = passwordInput.value.trim();
  if (!value) {
    statusEl.textContent = 'Введи пароль.';
    statusEl.style.color = '#f97373';
    return;
  }
  adminPassword = value;
  statusEl.textContent = 'Пароль прийнято. Можна редагувати.';
  statusEl.style.color = '#22c55e';
  adminForm.style.display = 'block';
});

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
    msgEl.textContent = 'Спочатку введи адмін-пароль вище.';
    msgEl.style.color = '#f97373';
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
    msgEl.textContent = 'Заповни всі обовʼязкові поля.';
    msgEl.style.color = '#f97373';
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
      msgEl.style.color = '#f97373';
    } else {
      msgEl.textContent = 'Пару додано.';
      msgEl.style.color = '#22c55e';
    }
  } catch (e) {
    msgEl.textContent = 'Помилка мережі.';
    msgEl.style.color = '#f97373';
  }
});

