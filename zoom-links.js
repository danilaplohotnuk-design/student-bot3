// Відповідність предметів (за ключовими словами) і посилань Zoom. Узгоджено з bot.py (ZOOM_SMART_INFO).
const ZOOM_LINKS = [
  { keys: ['актор', 'майстерність актора'], url: 'https://kuk-edu-ua.zoom.us/j/82148990272?pwd=ZGlMUGs2cWdSRXdVdU02aVB1YXRzQT09' },
  { keys: ['ритмік', 'пластика', 'танець'], url: 'https://kuk-edu-ua.zoom.us/j/83864551621?pwd=RFR1MFJRRDRYNWEvN2NGOHNRYndWUT09' },
  { keys: ['ярмонік'], url: 'https://kuk-edu-ua.zoom.us/j/83980227068?pwd=3RQNLta5y9eWjq8gZazdyqBlm4COxh.1' },
  { keys: ['швець'], url: 'https://kuk-edu-ua.zoom.us/j/88129672456?pwd=b1dVYkoxT0k0VCtSeUlrM0RMNDJ1Zz0' },
  { keys: ['барба'], url: 'https://kuk-edu-ua.zoom.us/j/85796084215?pwd=VnhGSlpQcE1xNFFwQXMzS05aaEx3QT09' },
  { keys: ['екран', 'мовлення'], url: 'https://kuk-edu-ua.zoom.us/j/81718626689?pwd=RmRkeFBDNjUvemV5QjZPeUQ0OFZpdz09' },
  { keys: ['тележурнал', 'журнал'], url: 'https://kuk-edu-ua.zoom.us/j/83165232983?pwd=V6kwEW8ZpdHAzZWsK5mSzZYNBafU0d.1' },
  { keys: ['монтаж', 'цифрового'], url: 'https://kuk-edu-ua.zoom.us/j/83810971431?pwd=OURMZzlDd2hHTTZGVkE3N2hITkh4QT09' },
  { keys: ['телеведуч'], url: 'https://kuk-edu-ua.zoom.us/j/83724851987?pwd=a09xckk3aVhMcmwxMmwyc1VsOFhRZz09' },
  { keys: ['ділов', 'українська мова'], url: 'https://kuk-edu-ua.zoom.us/j/82032948131?pwd=N1o5cGVQeURvOXJVRms3Wm5pN25PZz09' },
  { keys: ['мистецтв'], url: 'https://kuk-edu-ua.zoom.us/j/86579693886?pwd=aFI0Y25rK3ZyTFkvdGlVaTZLbHpMZz09' },
  { keys: ['історія україни', 'істор'], url: 'https://kuk-edu-ua.zoom.us/j/84385147484?pwd=QmRDLzBUN3hYa1RmSUpnajhwQWljdz09' },
];

function getZoomLink(title, teacher = '') {
  if (!title || typeof title !== 'string') return null;
  const search = `${title} ${teacher}`.toLowerCase();
  for (const { keys, url } of ZOOM_LINKS) {
    if (keys.some((k) => search.includes(k))) return url;
  }
  return null;
}

export { getZoomLink };
