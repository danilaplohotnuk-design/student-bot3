// web/main.js

// Ініціалізація Telegram WebApp (якщо відкрито всередині Telegram)
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

// Формат дати YYYY-MM-DD для сьогодні
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dateInput = document.getElementById('date-input');
const dateLabel = document.getElementById('date-label');
const scheduleContainer = document.getElementById('schedule');

async function loadSchedule(date) {
  scheduleContainer.innerHTML = '<p class="loading">Завантаження розкладу...</p>';
  try {
    const res = await fetch(`/api/schedule?date=${encodeURIComponent(date)}`);
    if (!res.ok) {
      throw new Error('Помилка завантаження');
    }
    const data = await res.json();
    renderSchedule(data.date, data.lessons || []);
  } catch (err) {
    scheduleContainer.innerHTML = `<p class="error">Не вдалося завантажити розклад</p>`;
    console.error(err);
  }
}

function renderSchedule(date, lessons) {
  const niceDate = new Date(date);
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
  dateLabel.textContent = `Дата: ${niceDate.toLocaleDateString('uk-UA', options)}`;

  if (!lessons.length) {
    scheduleContainer.innerHTML = '<p class="empty">На цю дату пар немає 🎉</p>';
    return;
  }

  scheduleContainer.innerHTML = '';
  for (const lesson of lessons) {
    const card = document.createElement('div');
    card.className = 'lesson-card';

    const title = document.createElement('h2');
    title.textContent = lesson.title;

    const time = document.createElement('p');
    time.className = 'time';
    time.textContent = `${lesson.startTime} — ${lesson.endTime}`;

    const place = document.createElement('p');
    place.className = 'place';
    place.textContent = `Корпус ${lesson.building}, ауд. ${lesson.room}`;

    card.appendChild(title);
    card.appendChild(time);

    if (lesson.teacher) {
      const teacher = document.createElement('p');
      teacher.className = 'teacher';
      teacher.textContent = lesson.teacher;
      card.appendChild(teacher);
    }

    card.appendChild(place);
    scheduleContainer.appendChild(card);
  }
}

// Обробка вибору дати
dateInput.addEventListener('change', () => {
  if (dateInput.value) {
    loadSchedule(dateInput.value);
  }
});

// Початкове завантаження (сьогодні)
const initialDate = todayISO();
dateInput.value = initialDate;
loadSchedule(initialDate);