const menu = document.querySelector('.menu-button');
menu?.addEventListener('click', () => {
  const nav = document.querySelector('.main-nav');
  const open = !nav.classList.contains('is-open');
  nav.classList.toggle('is-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? '收起导航' : '打开导航');
});
const search = document.querySelector('input');
const cards = [...document.querySelectorAll('.episode-card')];
const filterButtons = [...document.querySelectorAll('.filter-tabs button')];
let category = '全部';
function update() {
  const query = (search?.value || '').trim().toLowerCase();
  for (const card of cards) {
    const wrapper = card.parentElement;
    const match = (category === '全部' || card.querySelector('.episode-meta')?.textContent.includes(category)) && card.textContent.toLowerCase().includes(query);
    wrapper.hidden = !match;
    wrapper.style.display = match ? '' : 'none';
  }
}
search?.addEventListener('input', update);
for (const button of filterButtons) button.addEventListener('click', () => {
  category = button.textContent.trim().replace(/\d+$/, '').trim();
  for (const item of filterButtons) item.classList.toggle('active', item === button);
  update();
});
