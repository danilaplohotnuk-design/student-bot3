const tg = window.Telegram?.WebApp;

if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dateInput = document.getElementById('date-input');
const dateLabel = document.getElementById('date-label');
const todayBtn = document.getElementById('today-btn');
const scheduleContainer = document.getElementById('schedule');

function setDateLabel(dateStr) {
  const d = new Date(dateStr);
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  dateLabel.textContent = d.toLocaleDateString('uk-UA', options);
}

async function loadSchedule(date) {
  scheduleContainer.innerHTML = `
    <div class="state-message">
      Завантаження
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  try {
    const res = await fetch(`/api/schedule?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error('Помилка завантаження');
    const data = await res.json();
    renderSchedule(data.date, data.lessons || []);
  } catch (err) {
    scheduleContainer.innerHTML = '<p class="state-message error">Не вдалося завантажити розклад</p>';
    console.error(err);
  }
}

function renderSchedule(date, lessons) {
  setDateLabel(date);

  if (!lessons.length) {
    scheduleContainer.innerHTML = '<p class="state-message empty">На цю дату пар немає</p>';
    return;
  }

  scheduleContainer.innerHTML = '';
  lessons.forEach((lesson) => {
    const card = document.createElement('div');
    card.className = 'lesson-card';

    const title = document.createElement('h2');
    title.className = 'lesson-title';
    title.textContent = lesson.title;

    const meta = document.createElement('div');
    meta.className = 'lesson-meta';

    const time = document.createElement('div');
    time.className = 'lesson-time';
    time.textContent = `${lesson.startTime} — ${lesson.endTime}`;
    meta.appendChild(time);

    if (lesson.teacher) {
      const teacher = document.createElement('div');
      teacher.className = 'lesson-teacher';
      teacher.textContent = lesson.teacher;
      meta.appendChild(teacher);
    }

    const place = document.createElement('div');
    place.className = 'lesson-place';
    place.textContent = `Корпус ${lesson.building}, ауд. ${lesson.room}`;
    meta.appendChild(place);

    card.appendChild(title);
    card.appendChild(meta);
    scheduleContainer.appendChild(card);
  });
}

dateInput.addEventListener('change', () => {
  if (dateInput.value) loadSchedule(dateInput.value);
});

todayBtn.addEventListener('click', () => {
  const today = todayISO();
  dateInput.value = today;
  loadSchedule(today);
});

const initialDate = todayISO();
dateInput.value = initialDate;
loadSchedule(initialDate);
