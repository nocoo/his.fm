const menu = document.querySelector('.menu-toggle');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.textContent = open ? '关闭 −' : '菜单 +';
  menu.closest('.site-header').classList.toggle('menu-open', open);
});

const filters = [...document.querySelectorAll('[data-filter]')];
const search = document.querySelector('input[type="search"]');
const cards = [...document.querySelectorAll('.episode-card')];
let selected = 'all';
function filterEpisodes() {
  const query = (search?.value || '').trim().toLocaleLowerCase();
  for (const card of cards) card.hidden = !(selected === 'all' || card.dataset.category === selected) || !card.dataset.title.toLocaleLowerCase().includes(query);
  const empty = document.querySelector('.empty-state');
  if (empty) empty.hidden = cards.some(card => !card.hidden);
}
for (const filter of filters) {
  filter.addEventListener('click', () => {
    selected = filter.dataset.filter;
    for (const item of filters) item.setAttribute('aria-pressed', String(item === filter));
    filterEpisodes();
  });
}
search?.addEventListener('input', filterEpisodes);

const requested = new URLSearchParams(location.search).get('episode') || '01';
const episodes = [...document.querySelectorAll('[data-episode]')];
const active = episodes.find(episode => episode.dataset.episode === requested) || episodes[0];
for (const episode of episodes) episode.hidden = episode !== active;
if (active) document.title = `${active.querySelector('h1').textContent} · his.fm`;
